import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {Factory} from '../server/factory.ts';
import {Store} from '../server/store.ts';
import {Runner,SimulatedWorker} from '../server/runner.ts';
import {projectSchema} from '../server/projects.ts';
import {Pmt} from '../server/pmt.ts';
import {configSchema} from '../shared/workflow.ts';

test('epic intake routes a stale generic delivery selection to Lead-coordinated independent reviews',async()=>{
  const root=resolve('.state/workflow-routing-tests',randomUUID());mkdirSync(root,{recursive:true});
  execFileSync('git',['init','--initial-branch=main',root],{windowsHide:true,stdio:'pipe'});
  const project=projectSchema.parse({id:'routing',name:'Routing',kind:'fixture',path:root,reviewChecklist:'Preserve both independent review axes.',delivery:{selection:'epic',reviewAxes:['spec','standards']},team:[{id:'lead',name:'Lead',roles:['lead']},{id:'ba',name:'BA',roles:['ba','reviewer'],reviewAxes:['spec']},{id:'one',name:'One',roles:['builder','reviewer'],reviewAxes:['standards']},{id:'two',name:'Two',roles:['builder','reviewer'],reviewAxes:['standards']}]});
  const pmt=new Pmt(project);pmt.ensure(project);pmt.command(['epic','create','--title','Deliver the epic','--yes']);const epic=pmt.list().find(item=>!item.epic)!;
  pmt.command(['story','create','--epic',epic.id,'--title','One behavior','--yes']);const ticket=pmt.list().find(item=>item.epic===epic.id)!;
  pmt.edit(ticket.id,{title:ticket.title,revision:ticket.revision,body:ticket.body.replace('- [Define expected outcomes and restrictions]','- The named behavior is available.')});
  const settings=join(root,'projects.json');writeFileSync(settings,JSON.stringify({codexExecutable:process.execPath,projects:[project]}));const previous=process.env.BARRACKS_PROJECTS_PATH;process.env.BARRACKS_PROJECTS_PATH=settings;
  const store=new Store(':memory:');store.pause(true);const config=configSchema.parse(JSON.parse(readFileSync('config/workflow.json','utf8'))),factory=new Factory(store,new Runner(store,config,new SimulatedWorker(1)));
  try{
    assert.throws(()=>factory.create({projectId:project.id,workflowId:'missing',title:'Unknown workflow'}),/configured workflow/);
    assert.throws(()=>factory.create({projectId:project.id,workflowId:'qualified-ticket',title:'Internal workflow'}),/only by its parent/);
    writeFileSync(settings,JSON.stringify({codexExecutable:process.execPath,projects:[{...project,delivery:{...project.delivery!,selection:'explicit'}}]}));
    assert.throws(()=>factory.create({projectId:project.id,workflowId:'parallel-delivery',title:'Strict selection',epicId:epic.id,ticketIds:[ticket.id]}),/Choose a ticket workflow with the required spec review stage/);
    assert.equal(store.runs().length,0);
    writeFileSync(settings,JSON.stringify({codexExecutable:process.execPath,projects:[project]}));
    const run=factory.create({projectId:project.id,workflowId:'parallel-delivery',title:'Deliver selected epic',epicId:epic.id,ticketIds:[ticket.id],ticketConcurrency:3});
    assert.equal(run.workflowId,'qualified-delivery');assert.equal(run.definition.id,run.workflowId);assert.equal(run.ticketDefinition?.id,'qualified-ticket');assert.equal(run.definition.maxConcurrentTickets,3);
    for(const axis of ['spec','standards'])assert.ok(Object.values(run.ticketDefinition!.states).some(state=>state.role==='reviewer'&&state.reviewAxis===axis));
    assert.equal(run.ticketDefinition!.states[run.ticketDefinition!.initial]!.role,'lead');
    assert.deepEqual(run.artifacts.workflow_selection,{requestedWorkflowId:'parallel-delivery',workflowId:'qualified-delivery',ticketWorkflowId:'qualified-ticket',reason:'Project delivery policy requires a compatible ticket review workflow.'});
    assert.equal(store.tasks().length,0);assert.equal(store.run(run.id).workflowId,'qualified-delivery');
    await factory.cancel(run.id);
  }finally{factory.stop();await factory.drained();store.close();if(previous===undefined)delete process.env.BARRACKS_PROJECTS_PATH;else process.env.BARRACKS_PROJECTS_PATH=previous;}
});
