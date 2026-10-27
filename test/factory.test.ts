import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {Pmt} from '../server/pmt.ts';
import {projectSchema,projectsSchema,prepare,candidate} from '../server/projects.ts';
import {Store} from '../server/store.ts';
import {Runner,SimulatedWorker} from '../server/runner.ts';
import {Factory} from '../server/factory.ts';
import {DiscoveryAgent,type DiscoveryReply} from '../server/discovery-agent.ts';
import {configSchema} from '../shared/workflow.ts';
import type {WorkflowRun} from '../shared/factory.ts';
import {waitFor} from '../scripts/test-server.ts';
const config=configSchema.parse(JSON.parse(readFileSync('config/workflow.json','utf8')));
test('discovery hands off personas, waits for decisions and publishes editable canonical PMT tickets',async()=>{
  const root=resolve('.state/factory-tests',randomUUID());mkdirSync(root,{recursive:true});
  const project=projectSchema.parse({id:'factorytest',name:'Factory test',kind:'fixture',path:root,reviewChecklist:'Check scope.'});
  const parentBefore=readFileSync('project/Epics.md','utf8');assert.throws(()=>new Pmt(project).ensure(project),/own initialized Git/);assert.equal(readFileSync('project/Epics.md','utf8'),parentBefore);
  execFileSync('git',['init','--initial-branch=main',root],{windowsHide:true,stdio:'pipe'});
  const settings=join(root,'projects.json');writeFileSync(settings,JSON.stringify(projectsSchema.parse({codexExecutable:process.execPath,attemptTimeoutMs:1000,projects:[project]})));
  const previous=process.env.BARRACKS_PROJECTS_PATH;process.env.BARRACKS_PROJECTS_PATH=settings;
  const store=new Store(join(root,'runs.db')),runner=new Runner(store,config,new SimulatedWorker(10));
  const phases:string[]=[];
  class Agent extends DiscoveryAgent {
    override async run(run:WorkflowRun):Promise<DiscoveryReply>{const persona=run.definition.states[run.phase]!.persona!;phases.push(persona);if(persona==='product-owner')return {event:'brief_ready',document:'Brief and confirmed user requirements.',questions:[],plan:null};if(run.phase==='challenge'&&!run.turns.some(turn=>turn.role==='user'))return {event:'needs_user',document:'One product decision remains.',questions:['Should this work offline?'],plan:null};if(run.phase==='challenge')return {event:'brief_agreed',document:'Agreed technical decisions.',questions:[],plan:null};if(run.phase==='specify')return {event:'specification_ready',document:'Confirmed architecture and verification.',questions:[],plan:null};return {event:'tickets_ready',document:'One epic and two tickets.',questions:[],plan:{epic:{title:'Test epic',description:'Deliver the confirmed behavior.'},tickets:[{title:'First behavior',description:'Build first.',acceptanceCriteria:['First behavior passes.'],dependsOn:[]},{title:'Second behavior',description:'Extend first.',acceptanceCriteria:['Both behaviors pass.'],dependsOn:[0]}]}};}
    override async reconcile(){}
  }
  const factory=new Factory(store,runner,new Agent());factory.start();
  try{
    const run=factory.create({projectId:project.id,workflowId:'grilling',title:'Define the product'});
    await waitFor(()=>store.run(run.id),run=>run.status==='waiting',10000);assert.deepEqual(store.run(run.id).questions,['Should this work offline?']);assert.equal(store.tasks().length,0);
    await factory.resume(run.id,'Yes, offline.');await waitFor(()=>store.run(run.id),run=>run.phase==='review_specification',10000);
    assert.equal(new Pmt(project).list().length,0);
    await factory.resume(run.id,'Clarify offline verification.','changes');await waitFor(()=>store.run(run.id),run=>run.phase==='review_specification',10000);
    await factory.resume(run.id,'Approve specification and test seams.');await waitFor(()=>store.run(run.id),run=>run.phase==='review_tickets',10000);
    assert.equal(new Pmt(project).list().length,0);
    await assert.rejects(()=>factory.resume(run.id,'Invent a route.','publish_now'),/not configured/);
    await factory.resume(run.id,'Keep these slices.');const finished=await waitFor(()=>store.run(run.id),run=>run.status==='complete'||run.recovery,30000);assert.equal(finished.status,'complete',finished.message);
    const completed=store.run(run.id);assert.deepEqual(phases,['product-owner','architect','architect','architect','architect','project-manager']);assert.equal(completed.outputTickets?.length,2);assert.equal(store.tasks().length,0);
    const pmt=new Pmt(project),items=pmt.list(),second=items.find(item=>item.id===completed.outputTickets![1])!;assert.deepEqual(second.dependsOn,[completed.outputTickets![0]]);
    assert.match(items.find(item=>item.id===completed.outputEpicId)!.body,/Confirmed architecture/);
    pmt.edit(second.id,{title:'Revised ticket',body:second.body+'\nAdditional user requirement.\n',revision:second.revision});assert.throws(()=>pmt.edit(second.id,{title:'Stale edit',body:second.body,revision:second.revision}),/changed since/);
    const count=pmt.list().length;pmt.publish(project,completed,{epic:{title:'Test epic',description:'Deliver the confirmed behavior.'},tickets:[{title:'First behavior',description:'Build first.',acceptanceCriteria:['First behavior passes.'],dependsOn:[]},{title:'Second behavior',description:'Extend first.',acceptanceCriteria:['Both behaviors pass.'],dependsOn:[0]}]},()=>store.saveRun(completed));assert.equal(pmt.list().length,count);
    pmt.move(completed.outputTickets![0]!,'in-progress');pmt.move(completed.outputTickets![0]!,'complete');pmt.move(completed.outputTickets![0]!,'complete');assert.equal(pmt.list().find(item=>item.id===completed.outputTickets![0])!.status,'complete');
  }finally{factory.stop();await factory.drained();store.close();if(previous===undefined)delete process.env.BARRACKS_PROJECTS_PATH;else process.env.BARRACKS_PROJECTS_PATH=previous;}
});
test('epic ticket children always pass BA and copy only the accepted predecessor source',()=>{
  const root=resolve('.state/factory-baselines',randomUUID());mkdirSync(root,{recursive:true});writeFileSync(join(root,'source.mjs'),'export const value=1;');
  const project=projectSchema.parse({id:'baseline',name:'Baseline',kind:'fixture',path:root,reviewChecklist:'Preserve source.'});const settings=projectsSchema.parse({codexExecutable:process.execPath,attemptTimeoutMs:1000,projects:[project]});
  const base=prepare({id:randomUUID(),projectId:project.id},settings),tree=candidate(base.root),store=new Store(':memory:');
  try{const child=store.create({projectId:project.id,title:'Next ticket',execution:'codex'},{baseTaskId:base.root.replaceAll('\\','/').split('/').at(-1)!,baseCandidate:tree});
    const lead=store.claim(child.id,config)!;store.finish(lead.id,{kind:'triaged',specificationReady:true},config);assert.equal(store.task(child.id).state,'refining');
    const copy=prepare(child,{...settings,projects:[{...project,kind:'repository'}]});assert.equal(readFileSync(join(copy.workspace,'source.mjs'),'utf8'),'export const value=1;');writeFileSync(join(base.workspace,'source.mjs'),'unexpected change');
    assert.throws(()=>prepare({id:randomUUID(),projectId:project.id,baseTaskId:child.baseTaskId,baseCandidate:tree},settings),/baseline changed/);
  }finally{store.close();}
});
test('workflow cancellation ignores late replies and restart holds an interrupted persona for reconciliation',async()=>{
  const root=resolve('.state/factory-lifecycle',randomUUID());mkdirSync(root,{recursive:true});const settings=join(root,'projects.json');writeFileSync(settings,JSON.stringify({codexExecutable:process.execPath,attemptTimeoutMs:1000,projects:[{id:'lifecycle',name:'Lifecycle',kind:'fixture',path:root,reviewChecklist:'Check scope.'}]}));
  const previous=process.env.BARRACKS_PROJECTS_PATH;process.env.BARRACKS_PROJECTS_PATH=settings;const file=join(root,'runs.db');let store=new Store(file),runner=new Runner(store,config,new SimulatedWorker(10));let calls=0;
  class Blocking extends DiscoveryAgent {
    override async run(_run:WorkflowRun,signal:AbortSignal):Promise<DiscoveryReply>{calls++;await new Promise<void>(accept=>signal.addEventListener('abort',()=>accept(),{once:true}));return {event:'brief_ready',document:'Late reply',questions:[],plan:null};}
    override async reconcile(){}
  }
  let factory=new Factory(store,runner,new Blocking());factory.start();
  try{
    store.pause(true);const cancelled=factory.create({projectId:'lifecycle',workflowId:'grilling',title:'Cancelled task'});assert.equal(store.run(cancelled.id).status,'queued');store.pause(false);factory.tick();await factory.cancel(cancelled.id);assert.equal(store.run(cancelled.id).status,'cancelled');assert.deepEqual(store.run(cancelled.id).turns,[]);
    const interrupted=factory.create({projectId:'lifecycle',workflowId:'grilling',title:'Interrupted task'});factory.stop();await factory.drained();store.close();store=new Store(file);runner=new Runner(store,config,new SimulatedWorker(10));factory=new Factory(store,runner,new Blocking());const before=calls;factory.start();assert.equal(store.run(interrupted.id).status,'waiting');assert.equal(store.run(interrupted.id).recovery,true);assert.equal(calls,before);
  }finally{factory.stop();await factory.drained();store.close();if(previous===undefined)delete process.env.BARRACKS_PROJECTS_PATH;else process.env.BARRACKS_PROJECTS_PATH=previous;}
});
