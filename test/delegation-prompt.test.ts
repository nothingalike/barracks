import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {CodexWorker} from '../server/codex-worker.ts';
import {projectSchema,prepare} from '../server/projects.ts';
import {Store} from '../server/store.ts';

test('the actual Lead prompt explains project coordination while retaining ticket and publication boundaries',async()=>{
  const root=resolve('.state/delegation-prompt-tests',randomUUID()),source=join(root,'source');mkdirSync(source,{recursive:true});writeFileSync(join(source,'source.rs'),'// scoped source\n');
  const project=projectSchema.parse({id:'delegation-prompt',name:'Delegation prompt',path:source,kind:'fixture',reviewChecklist:'Independent review remains required.',instructions:'Work from rust-refactor. Leave main untouched.',delivery:{leadDelegation:'project',requirePathGrants:true}}),file=join(root,'projects.json');writeFileSync(file,JSON.stringify({codexExecutable:process.execPath,projects:[project]}));
  const previous=process.env.BARRACKS_PROJECTS_PATH;process.env.BARRACKS_PROJECTS_PATH=file;const store=new Store(':memory:');
  try{const task=store.create({projectId:project.id,title:'macOS startup',execution:'codex'});prepare({...task,projectSnapshot:projectSchema.parse({...project,delivery:{...project.delivery,leadDelegation:'listed'}})});task.projectSnapshot=project;assert.throws(()=>prepare({...task,projectSnapshot:{...project,ref:'main'}}),/Pinned project identity/);
    const worker=new CodexWorker(async command=>{assert.match(command.input!,/Lead may approve the smallest requested relative project paths necessary for this approved ticket/);assert.match(command.input!,/without operator approval/);assert.match(command.input!,/protected files, source ownership locks, independent reviews and saved branch\/publication authority/);assert.match(command.input!,/Leave main untouched/);assert.match(command.input!,/Publish no branches or commits/);assert.match(command.input!,/lead assignment: return interfaceRequest:null/);
      writeFileSync(command.args[command.args.indexOf('--output-last-message')+1]!,JSON.stringify({action:'refine',summary:'BA should refine the existing ticket.',blockerKind:'none',interfaceRequest:null,grantedPaths:[],ownedPaths:[],requirements:[]}));return {stdout:JSON.stringify({type:'thread.started',thread_id:'delegation-fixture'})+'\n',stderr:''};});
    const result=await worker.run({id:randomUUID(),taskId:task.id,stage:'queued',role:'lead',worker:'lead',candidate:null,status:'running',startedAt:new Date().toISOString()},task,new AbortController().signal);assert.equal(result.kind,'triaged');
  }finally{store.close();if(previous===undefined)delete process.env.BARRACKS_PROJECTS_PATH;else process.env.BARRACKS_PROJECTS_PATH=previous;}
});
