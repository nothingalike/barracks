import test,{mock} from 'node:test';
import fs from 'node:fs';
import {syncBuiltinESMExports} from 'node:module';
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync,readFileSync,existsSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {initializeParallelSource,planParallelIntegration,acceptParallelIntegration,publishParallelSource,IntegrationConflict} from '../server/parallel-source.ts';
import {prepare,candidate,taskRoot,git,projectSchema,projectsSchema} from '../server/projects.ts';
import {inputSchema,type Task} from '../shared/workflow.ts';
import type {WorkflowRun} from '../shared/factory.ts';

for(const mode of ['independent','conflict','project-edit','baseline-edit','learned-checks','baseline-race','pinned-policy'] as const)test('managed worktrees and approved publication: '+mode,()=>{
  const directory=resolve('.state/parallel-source-tests',randomUUID()),source=join(directory,'project with spaces');mkdirSync(source,{recursive:true});
  execFileSync('git',['init','--initial-branch=main',source],{windowsHide:true,stdio:'pipe'});
  writeFileSync(join(source,'base.txt'),'existing uncommitted source\n');writeFileSync(join(source,'.gitignore'),'dist/\n');
  mkdirSync(join(source,'.workspace'));writeFileSync(join(source,'.workspace','pm-toolbox.yml'),'paths:\n  project: project\n');mkdirSync(join(source,'project'));writeFileSync(join(source,'project','ticket.md'),'tracking remains outside code');
  const project=projectSchema.parse({id:'parallel-source',name:'Parallel source',kind:'repository',path:source,reviewChecklist:'Preserve source.',verify:[{executable:'node',args:['--test'],sandbox:'read-only'}]});
  if(mode==='learned-checks')project.verify=[];
  const settings=join(directory,'projects.json');writeFileSync(settings,JSON.stringify(projectsSchema.parse({codexExecutable:process.execPath,projects:[project]})));const previous=process.env.BARRACKS_PROJECTS_PATH;process.env.BARRACKS_PROJECTS_PATH=settings;
  const definition=JSON.parse(readFileSync('config/workflows.json','utf8'))[1];
  const run:WorkflowRun={id:randomUUID(),projectId:project.id,workflowId:definition.id,title:'Parallel source proof',description:'',definition,phase:definition.initial,status:'queued',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),turns:[],questions:[],message:'',recovery:false,attempts:[],artifacts:{},personaInstructions:{},handoffs:[]};
  try{
    initializeParallelSource(run,project);const initial=run.baseCandidate!;
    assert.equal(readFileSync(join(taskRoot(run),'workspace','base.txt'),'utf8'),'existing uncommitted source\n');assert.equal(existsSync(join(taskRoot(run),'workspace','project')),false);
    const tasks=['A','B'].map((ticket,index):Task=>{
      const id=randomUUID(),task:Task={...inputSchema.parse({title:ticket,projectId:project.id,execution:'codex'}),id,state:'complete',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),candidate:null,verified:true,author:'builder',reviewCycles:1,resumeState:null,blocker:null,baseTaskId:run.id,baseCandidate:initial,worktree:{runId:run.id,commit:run.parallel!.commit}};
      const context=prepare(task);assert.match(git(context.root,['rev-parse','--git-common-dir']).replaceAll('\\','/'),new RegExp(run.id+'/git$'));
      if(mode==='learned-checks')writeFileSync(join(context.root,'verification.json'),JSON.stringify([{executable:'node',args:['--test',ticket+'.test.mjs'],sandbox:'read-only'}]));
      writeFileSync(join(context.workspace,mode==='conflict'?'base.txt':ticket+'.txt'),'approved '+index+'\n');task.candidate=candidate(context.root);return task;
    });
    assert.equal(existsSync(join(taskRoot(tasks[0]!), 'workspace','B.txt')),false);run.parallel!.wave=['A','B'];
    if(mode==='conflict'){assert.throws(()=>planParallelIntegration(run,tasks,project),IntegrationConflict);assert.equal(candidate(taskRoot(run)),initial);assert.equal(readFileSync(join(source,'base.txt'),'utf8'),'existing uncommitted source\n');return;}
    if(mode==='pinned-policy')writeFileSync(settings,JSON.stringify({codexExecutable:process.execPath,projects:[{...project,environment:{PROOF:'new runtime policy'},verify:[{executable:'node',args:['-e','throw Error("wrong policy")'],sandbox:'read-only'}]}]}));
    const plan=planParallelIntegration(run,tasks,project);assert.equal(readFileSync(join(taskRoot({id:plan.taskId}),'workspace','A.txt'),'utf8'),'approved 0\n');
    if(mode==='pinned-policy'){const context=prepare({id:plan.taskId,projectId:project.id});assert.deepEqual(context.project.verify,project.verify);assert.equal(context.project.environment,undefined);}
    const persisted=structuredClone(run);acceptParallelIntegration(run);Object.assign(run,persisted);acceptParallelIntegration(run);assert.equal(existsSync(join(source,'A.txt')),false);
    if(mode==='learned-checks'){
      const id=randomUUID(),context=prepare({id,projectId:project.id,baseTaskId:run.id,baseCandidate:run.baseCandidate,worktree:{runId:run.id,commit:run.parallel!.commit}});writeFileSync(join(context.workspace,'C.txt'),'third behavior');writeFileSync(join(context.root,'verification.json'),JSON.stringify([{executable:'node',args:['--test','C.test.mjs'],sandbox:'read-only'}]));
      const task={...tasks[0]!,id,baseCandidate:run.baseCandidate,worktree:{runId:run.id,commit:run.parallel!.commit},candidate:candidate(context.root)};run.parallel!.wave=['C'];const next=planParallelIntegration(run,[task],project);
      const checks=JSON.parse(readFileSync(join(taskRoot({id:next.taskId}),'verification.json'),'utf8'));assert.deepEqual(checks.map((item:{args:string[]})=>item.args[1]),['A.test.mjs','B.test.mjs','C.test.mjs']);acceptParallelIntegration(run);
    }
    assert.throws(()=>publishParallelSource(run,project),/final acceptance/);run.artifacts.acceptance_candidate=run.baseCandidate;
    if(mode==='project-edit')writeFileSync(join(source,'A.txt'),'user edit');
    if(mode==='baseline-edit')writeFileSync(join(source,'base.txt'),'later user edit');
    if(mode==='project-edit'||mode==='baseline-edit'){assert.throws(()=>publishParallelSource(run,project),/without overwriting/);assert.equal(existsSync(join(source,'B.txt')),false);assert.equal(readFileSync(join(source,mode==='project-edit'?'A.txt':'base.txt'),'utf8'),mode==='project-edit'?'user edit':'later user edit');}
    else if(mode==='baseline-race'){
      const original=fs.renameSync,intercept=mock.method(fs,'renameSync',(from:fs.PathLike,to:fs.PathLike)=>{original(from,to);if(String(to)===join(source,'A.txt'))writeFileSync(join(source,'base.txt'),'concurrent user edit');});syncBuiltinESMExports();
      try{assert.throws(()=>publishParallelSource(run,project),/without overwriting/);assert.equal(readFileSync(join(source,'base.txt'),'utf8'),'concurrent user edit');assert.equal(existsSync(join(source,'A.txt')),false);assert.equal(existsSync(join(source,'B.txt')),false);}finally{intercept.mock.restore();syncBuiltinESMExports();}
    }else{publishParallelSource(run,project);publishParallelSource(run,project);assert.equal(readFileSync(join(source,'A.txt'),'utf8'),'approved 0\n');assert.equal(readFileSync(join(source,'B.txt'),'utf8'),'approved 1\n');assert.equal(readFileSync(join(source,'project','ticket.md'),'utf8'),'tracking remains outside code');assert.equal(git(taskRoot(run),['status','--porcelain']),'');}
    assert.throws(()=>execFileSync('git',['-c',`safe.directory=${source.replaceAll('\\','/')}`,'-C',source,'rev-parse','--verify','HEAD'],{windowsHide:true,stdio:'pipe'}));
  }finally{if(previous===undefined)delete process.env.BARRACKS_PROJECTS_PATH;else process.env.BARRACKS_PROJECTS_PATH=previous;}
});
