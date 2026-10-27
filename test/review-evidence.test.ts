import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync,readFileSync,existsSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {CodexWorker} from '../server/codex-worker.ts';
import {prepare,candidate,projectSchema,inventory} from '../server/projects.ts';
import {reviewGit} from '../server/review-evidence.ts';
import {Store} from '../server/store.ts';
import {configSchema} from '../shared/workflow.ts';
import {CommandFailedError} from '../server/process.ts';

for(const mode of ['pass','verification-failure','verification-edit','stale-candidate','model-edit'] as const)test('review evidence: '+mode,async()=>{
  const directory=resolve('.state/review evidence tests',randomUUID()),source=join(directory,'source');mkdirSync(source,{recursive:true});
  writeFileSync(join(source,'.gitignore'),'dist/\n');writeFileSync(join(source,'baseline.mjs'),'export const baseline=true;');
  const project=projectSchema.parse({id:'review-evidence',name:'Review evidence',kind:'fixture',path:source,reviewChecklist:'Preserve baseline.',verify:[{executable:process.execPath,args:['-e','console.log("independent check passed")'],sandbox:'workspace-write'}]});
  const settings=join(directory,'projects.json');writeFileSync(settings,JSON.stringify({codexExecutable:process.execPath,projects:[project]}));
  const previous=process.env.BARRACKS_PROJECTS_PATH;process.env.BARRACKS_PROJECTS_PATH=settings;
  const store=new Store(':memory:'),config=configSchema.parse(JSON.parse(readFileSync('config/workflow.json','utf8')));
  try{
    const task=store.create({title:'Review a resolvable candidate',projectId:project.id,execution:'codex',specificationReady:true,requestChangesOnce:false});
    const context=prepare(task);writeFileSync(join(context.workspace,'implementation.mjs'),'export const added=true;');const tree=candidate(context.root);
    store.finish(store.claim(task.id,config)!.id,{kind:'triaged',specificationReady:true},config);store.finish(store.claim(task.id,config)!.id,{kind:'built',candidate:tree,verified:true},config);
    const assignment=store.claim(task.id,config)!,events:string[]=[],canonicalBefore=inventory(context.workspace);
    const worker=new CodexWorker(async command=>{
      if(command.args[0]==='sandbox'){
        events.push('verification');assert.equal(events.length,1);
        if(mode==='verification-failure')throw new CommandFailedError('fixture verification refused');
        if(mode==='verification-edit')writeFileSync(join(command.cwd,'implementation.mjs'),'tampered');
        if(mode==='stale-candidate')writeFileSync(join(context.workspace,'implementation.mjs'),'new candidate during check');
        mkdirSync(join(command.cwd,'dist'),{recursive:true});writeFileSync(join(command.cwd,'dist','app.js'),'generated');
        return {stdout:'independent check passed',stderr:''};
      }
      events.push('reviewer');assert.deepEqual(events,['verification','reviewer']);
      const schema=JSON.parse(readFileSync(command.args[command.args.indexOf('--output-schema')+1]!,'utf8'));assert.deepEqual(schema.properties.interfaceRequest,{type:'null'});assert.match(command.input!,/reviewer assignment: return interfaceRequest:null/);
      assert.match(command.input!,/Runner-owned review evidence/);assert.match(command.input!,/independent check passed/);
      assert.match(command.input!,/blockerKind technical/);
      const evidence=JSON.parse(readFileSync(join(command.cwd,'.git','barracks-review.json'),'utf8'));
      assert.equal(evidence.candidate,tree);assert.equal(evidence.verification[0].exitCode,0);
      assert.equal(reviewGit(command.cwd,['cat-file','-t',tree]),'tree');assert.equal(reviewGit(command.cwd,['cat-file','-t',evidence.baseline]),'tree');
      assert.match(reviewGit(command.cwd,['diff',evidence.baseline,tree,'--']),/added=true/);
      assert.equal(reviewGit(command.cwd,['rev-parse','--show-toplevel']).toLowerCase(),command.cwd.replaceAll('\\','/').toLowerCase());
      assert.equal(reviewGit(command.cwd,['remote']), '');assert.equal(existsSync(join(command.cwd,'dist/app.js')),true);
      if(mode==='model-edit')writeFileSync(join(command.cwd,'implementation.mjs'),'unauthorized model edit');
      const output=command.args[command.args.indexOf('--output-last-message')+1]!;writeFileSync(output,JSON.stringify({action:'approved',summary:'Standards and Spec pass with supplied independent evidence.',blockerKind:'none'}));
      return {stdout:JSON.stringify({type:'thread.started',thread_id:'fixture-reviewer'})+'\n',stderr:''};
    });
    if(['verification-edit','stale-candidate','model-edit'].includes(mode))await assert.rejects(worker.run(assignment,store.task(task.id),new AbortController().signal),/changed|source/);
    else{
      const result=await worker.run(assignment,store.task(task.id),new AbortController().signal);
      if(mode==='verification-failure'){assert.equal(result.kind,'blocked');assert.deepEqual(events,['verification']);}
      else{assert.equal(result.kind,'reviewed');assert.equal(result.kind==='reviewed'&&result.approved,true);assert.deepEqual(inventory(context.workspace),canonicalBefore);}
    }
  }finally{store.close();if(previous===undefined)delete process.env.BARRACKS_PROJECTS_PATH;else process.env.BARRACKS_PROJECTS_PATH=previous;}
});
