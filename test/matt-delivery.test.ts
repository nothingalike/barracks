import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync,readFileSync,existsSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {Factory} from '../server/factory.ts';
import {Store} from '../server/store.ts';
import {Runner,SimulatedWorker} from '../server/runner.ts';
import {DiscoveryAgent,type DiscoveryReply} from '../server/discovery-agent.ts';
import {deliveryCandidate} from '../server/delivery-candidate.ts';
import {Pmt} from '../server/pmt.ts';
import {projectSchema,prepare,candidate} from '../server/projects.ts';
import {setupProjectGit} from '../server/project-management.ts';
import {configSchema,type Assignment,type Task,type WorkerResult} from '../shared/workflow.ts';
import type {WorkflowRun} from '../shared/factory.ts';
import {waitFor} from '../scripts/test-server.ts';

for(const mutate of [false,true])test(mutate?'source mutation during acceptance holds the task instead of completing':'acceptance repairs return through Builder and Reviewer before cumulative acceptance and retro',async()=>{
  const root=resolve('.state/matt-delivery-tests',randomUUID()),source=join(root,'source');mkdirSync(source,{recursive:true});
  execFileSync('git',['init','--initial-branch=main',source],{windowsHide:true,stdio:'pipe'});
  setupProjectGit({path:source,action:'initial-commit',confirmed:true,files:[],name:'Fixture',email:'fixture@invalid'});
  const project=projectSchema.parse({id:'matt-delivery',name:'Matt delivery',kind:'repository',path:source,reviewChecklist:'value.mjs exports value 2.'}),pmt=new Pmt(project);pmt.ensure(project);
  pmt.command(['epic','create','--title','Observed value','--summary','Export value 2.','--yes']);const epic=pmt.list().find(item=>!item.epic)!;
  pmt.command(['story','create','--title','Export a value','--epic',epic.id,'--summary','Export value 2 from value.mjs.','--yes']);
  const ticket=pmt.list().find(item=>item.epic===epic.id)!;pmt.edit(ticket.id,{title:ticket.title,revision:ticket.revision,body:ticket.body.replace('- [Define expected outcomes and restrictions]','- value.mjs exports value equal to 2, verified by observing the named export.')});
  pmt.command(['story','create','--title','Previously completed scope','--epic',epic.id,'--summary','Retain the agreed scope.','--yes']);
  const prior=pmt.list().find(item=>item.epic===epic.id&&item.id!==ticket.id)!;
  pmt.edit(prior.id,{title:prior.title,revision:prior.revision,body:prior.body.replace('- [Define expected outcomes and restrictions]','- The agreed scope remains dependency-free.')});pmt.move(prior.id,'in-progress');pmt.move(prior.id,'complete');
  const file=join(root,'projects.json');writeFileSync(file,JSON.stringify({codexExecutable:process.execPath,attemptTimeoutMs:1000,projects:[project]}));
  const previous=process.env.BARRACKS_PROJECTS_PATH;process.env.BARRACKS_PROJECTS_PATH=file;
  class InterruptedStore extends Store {interrupted=false;override reopenForAcceptance(id:string,findings:string){super.reopenForAcceptance(id,findings);if(!this.interrupted){this.interrupted=true;throw Error('Injected interruption after acceptance child checkpoint');}}}
  const store=new InterruptedStore(join(root,'runs.db')),config=configSchema.parse(JSON.parse(readFileSync('config/workflow.json','utf8'))),runner=new Runner(store,config,new SimulatedWorker(1));
  const roles:string[]=[];let builds=0,acceptances=0,retros=0;
  const worker={async run(assignment:Assignment,task:Task):Promise<WorkerResult>{
    roles.push(assignment.role);
    if(assignment.role==='lead')return {kind:'triaged',specificationReady:true,summary:'Scope ready.'};
    if(assignment.role==='ba')return {kind:'refined',summary:'Verify exported value 2.'};
    if(assignment.role==='builder'){builds++;const context=prepare(task);if(builds===2)assert.match(task.reviewNotes??'',/observed 1/);writeFileSync(join(context.workspace,'value.mjs'),'export const value='+builds+';');return {kind:'built',candidate:candidate(context.root),verified:true};}
    return {kind:'reviewed',candidate:assignment.candidate!,approved:true,notes:'Standards: pass. Spec: fixture review passed.'};
  },async reconcile(){return {};}};
  class Agent extends DiscoveryAgent {override async run(run:WorkflowRun):Promise<DiscoveryReply>{
    const context=deliveryCandidate(run);assert.notEqual(context.root,resolve('.state/tasks',run.id));
    if(run.definition.states[run.phase]!.executor==='retrospective'){
      retros++;const evidence=run.artifacts.execution_evidence as {children:{assignments:unknown[]}[]};assert.equal(evidence.children[0]!.assignments.length,6);
      return {event:'retrospective_ready',document:'Add a check for observed export values.',questions:[],plan:null};
    }
    acceptances++;const contents=readFileSync(join(context.workspace,'value.mjs'),'utf8');
    if(mutate){writeFileSync(join(context.workspace,'value.mjs'),'changed during inspection');return {event:'acceptance_passed',document:'Claimed pass',questions:[],plan:null,criteria:[{criterion:(run.artifacts.acceptance_criteria as {id:string}[])[0]!.id,status:'passed',evidence:'Stale observation'}]};}
    const passed=contents==='export const value=2;';
    return {event:passed?'acceptance_passed':'changes',document:passed?'Observed value 2.':'Expected 2; observed 1.',questions:[],plan:null,criteria:(run.artifacts.acceptance_criteria as {id:string}[]).map(item=>({criterion:item.id,status:passed?'passed':'failed',evidence:contents}))};
  }}
  const factory=new Factory(store,runner,new Agent(),worker);factory.start();
  try{
    const run=factory.create({projectId:project.id,workflowId:'delivery',epicId:epic.id,title:'Deliver value 2'});
    let finished=await waitFor(()=>store.run(run.id),run=>run.status==='complete'||run.recovery,30000);
    if(!mutate){assert.match(finished.message,/Injected interruption/);assert.equal(finished.phase,'reopen_ticket');await factory.resume(run.id,'Reconcile the interrupted child checkpoint.');finished=await waitFor(()=>store.run(run.id),run=>run.status==='complete'||run.recovery,30000);}
    if(mutate){assert.equal(finished.status,'waiting');assert.match(finished.message,/source changed/);assert.equal(retros,0);}
    else{
      assert.equal(finished.status,'complete',finished.message);assert.equal(acceptances,2);assert.equal(retros,1);
      assert.deepEqual(roles,['lead','ba','builder','reviewer','builder','reviewer']);
      assert.equal(finished.artifacts.acceptance_candidate,finished.baseCandidate);assert.match(String(finished.artifacts.retrospective),/observed export/);
      assert.equal(pmt.list().find(item=>item.epic===epic.id)!.status,'complete');
    }
    assert.equal(existsSync(join(source,'value.mjs')),false);
  }finally{factory.stop();await factory.drained();store.close();if(previous===undefined)delete process.env.BARRACKS_PROJECTS_PATH;else process.env.BARRACKS_PROJECTS_PATH=previous;}
});
