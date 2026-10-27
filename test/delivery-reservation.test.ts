import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {Factory} from '../server/factory.ts';
import {Store} from '../server/store.ts';
import {Runner,SimulatedWorker} from '../server/runner.ts';
import {DiscoveryAgent} from '../server/discovery-agent.ts';
import {Pmt} from '../server/pmt.ts';
import {projectSchema} from '../server/projects.ts';
import {setupProjectGit} from '../server/project-management.ts';
import {configSchema,type Task,type Assignment,type WorkerResult} from '../shared/workflow.ts';
import {waitFor} from '../scripts/test-server.ts';
import type {WorkflowRun} from '../shared/factory.ts';

for(const scenario of ['large-context','reservation-failure','pmt-failure'] as const)test('delivery reservation: '+scenario,async()=>{
  const root=resolve('.state/delivery-reservation-tests',randomUUID()),source=join(root,'source');mkdirSync(source,{recursive:true});
  execFileSync('git',['init','--initial-branch=main',source],{windowsHide:true,stdio:'pipe'});setupProjectGit({path:source,action:'initial-commit',confirmed:true,files:[],name:'Fixture',email:'fixture@invalid'});
  const project=projectSchema.parse({id:'reservation',name:'Reservation',kind:'repository',path:source,reviewChecklist:'Review the full accepted scope.'}),pmt=new Pmt(project);pmt.ensure(project);
  pmt.command(['epic','create','--title','Realistic accepted specification','--summary','Preserve the complete specification.','--yes']);
  let epic=pmt.list().find(item=>!item.epic)!;
  const specification='Accepted behavior and test seams.\n'.repeat(600)+'END OF APPROVED SPECIFICATION';
  epic=pmt.edit(epic.id,{title:epic.title,revision:epic.revision,body:epic.body+'\n## Architect specification\n'+specification});
  pmt.command(['story','create','--title','First vertical slice','--epic',epic.id,'--summary','Implement the first slice.','--yes']);
  let ticket=pmt.list().find(item=>item.epic===epic.id)!;
  const setCriteria=()=>{ticket=pmt.list().find(item=>item.id===ticket.id)!;ticket=pmt.edit(ticket.id,{title:ticket.title,revision:ticket.revision,body:ticket.body.replace('- [Define expected outcomes and restrictions]','- The first slice preserves the full approved specification.')});};
  if(scenario!=='pmt-failure')setCriteria();
  const settings=join(root,'projects.json');writeFileSync(settings,JSON.stringify({codexExecutable:process.execPath,attemptTimeoutMs:1000,projects:[project]}));
  const previous=process.env.BARRACKS_PROJECTS_PATH;process.env.BARRACKS_PROJECTS_PATH=settings;
  class FailingStore extends Store {fail=scenario==='reservation-failure';override saveRun(run:WorkflowRun){if(this.fail&&Object.keys(run.children??{}).length){this.fail=false;throw Error('Injected reservation failure after child insert');}return super.saveRun(run);}}
  const store=new FailingStore(join(root,'runs.db')),config=configSchema.parse(JSON.parse(readFileSync('config/workflow.json','utf8'))),runner=new Runner(store,config,new SimulatedWorker(1));
  let calls=0;
  const worker={async run(_assignment:Assignment,task:Task,_signal:AbortSignal,instructions?:{persona:string;assignment:string}):Promise<WorkerResult>{
    calls++;assert.ok(task.description.length<=10000);assert.ok(instructions!.assignment.includes(JSON.stringify(epic.body)));assert.ok(instructions!.assignment.includes(JSON.stringify(ticket.body)));
    return {kind:'blocked',blockerKind:'product',reason:'Fixture stop after observing the complete handoff.'};
  },async reconcile(){return {};}};
  const factory=new Factory(store,runner,new DiscoveryAgent(),worker);factory.start();
  try{
    const run=factory.create({projectId:project.id,workflowId:'delivery',epicId:epic.id,title:'Deliver the approved scope'});
    let held=await waitFor(()=>store.run(run.id),run=>run.status==='waiting',20000);
    if(scenario==='reservation-failure'){
      assert.match(held.message,/Injected reservation failure/);assert.equal(pmt.list().find(item=>item.id===ticket.id)!.status,'backlog');assert.equal(store.tasks().length,0);
      await factory.resume(run.id,'Retry the failed reservation.');held=await waitFor(()=>store.run(run.id),run=>run.status==='waiting',20000);
    }else if(scenario==='pmt-failure'){
      assert.equal(calls,0);assert.equal(store.tasks().length,1);assert.ok(held.children?.[ticket.id]);const child=held.children![ticket.id];
      assert.notEqual(pmt.list().find(item=>item.id===ticket.id)!.status,'in-progress');setCriteria();
      await factory.resume(run.id,'The fixture acceptance criterion is now present.');held=await waitFor(()=>store.run(run.id),run=>run.status==='waiting',20000);assert.equal(held.children?.[ticket.id],child);
    }
    assert.equal(held.recovery,false,held.message);assert.equal(held.phase,'await_resolution');assert.equal(calls,1);assert.equal(store.tasks().length,1);assert.equal(pmt.list().find(item=>item.id===ticket.id)!.status,'in-progress');
  }finally{factory.stop();await factory.drained();store.close();if(previous===undefined)delete process.env.BARRACKS_PROJECTS_PATH;else process.env.BARRACKS_PROJECTS_PATH=previous;}
});
