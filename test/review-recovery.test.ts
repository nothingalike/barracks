import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {Factory} from '../server/factory.ts';
import {Store} from '../server/store.ts';
import {Runner,SimulatedWorker} from '../server/runner.ts';
import {DiscoveryAgent,type DiscoveryReply} from '../server/discovery-agent.ts';
import {Pmt} from '../server/pmt.ts';
import {projectSchema,prepare,candidate} from '../server/projects.ts';
import {configSchema,type Assignment,type Task,type WorkerResult} from '../shared/workflow.ts';
import type {WorkflowRun} from '../shared/factory.ts';
import {setupProjectGit} from '../server/project-management.ts';
import {waitFor} from '../scripts/test-server.ts';

test('a coordinated paraphrased-review loop visits Lead then rebuilds before fresh review',async()=>{
  const root=resolve('.state/review-recovery-tests',randomUUID()),source=join(root,'source');mkdirSync(source,{recursive:true});execFileSync('git',['init','--initial-branch=main',source],{windowsHide:true,stdio:'pipe'});
  setupProjectGit({path:source,action:'initial-commit',confirmed:true,files:[],name:'Fixture',email:'fixture@invalid'});
  const project=projectSchema.parse({id:'review-recovery',name:'Review recovery',kind:'repository',path:source,reviewChecklist:'Preserve the accepted source.'}),pmt=new Pmt(project);pmt.ensure(project);
  pmt.command(['epic','create','--title','Repair review evidence','--yes']);const epic=pmt.list().find(item=>!item.epic)!;
  pmt.command(['story','create','--title','Keep verified behavior','--epic',epic.id,'--yes']);const ticket=pmt.list().find(item=>item.epic===epic.id)!;
  pmt.edit(ticket.id,{title:ticket.title,revision:ticket.revision,body:ticket.body.replace('- [Define expected outcomes and restrictions]','- The verified behavior remains available.')});
  const settings=join(root,'projects.json');writeFileSync(settings,JSON.stringify({codexExecutable:process.execPath,projects:[project]}));const previous=process.env.BARRACKS_PROJECTS_PATH;process.env.BARRACKS_PROJECTS_PATH=settings;
  const store=new Store(join(root,'runs.db')),config=configSchema.parse(JSON.parse(readFileSync('config/workflow.json','utf8'))),runner=new Runner(store,config,new SimulatedWorker(1));
  let reviews=0,resolved=false;const roles:string[]=[];
  const worker={async run(assignment:Assignment,task:Task):Promise<WorkerResult>{
    roles.push(assignment.role);
    if(assignment.stage==='blocked'){assert.equal(assignment.role,'lead');assert.match(task.blocker!,/unchanged candidate/);resolved=true;return {kind:'resolved',resolution:'Corrected candidate-bound evidence handoff.'};}
    if(assignment.role==='lead')return {kind:'triaged',specificationReady:false};
    if(assignment.role==='ba')return {kind:'refined',summary:'Scope and verification are ready.'};
    if(assignment.role==='builder'){const context=prepare(task);writeFileSync(join(context.workspace,'source.mjs'),'export const value='+Number(resolved)+';');return {kind:'built',candidate:candidate(context.root),verified:true};}
    reviews++;return {kind:'reviewed',candidate:assignment.candidate!,approved:resolved,notes:resolved?'Evidence and source review pass.':'Evidence unavailable, independent phrasing '+reviews};
  },async reconcile(){return {};}};
  class Agent extends DiscoveryAgent {override async run(run:WorkflowRun):Promise<DiscoveryReply>{return run.phase==='acceptance'?{event:'acceptance_passed',document:'Fixture acceptance.',questions:[],plan:null,criteria:(run.artifacts.acceptance_criteria as {id:string}[]).map(item=>({criterion:item.id,status:'passed',evidence:'Bounded state-routing fixture.'}))}:{event:'retrospective_ready',document:'Fixture retrospective.',questions:[],plan:null};}}
  const factory=new Factory(store,runner,new Agent(),worker);factory.start();
  try{
    const run=factory.create({projectId:project.id,workflowId:'delivery',epicId:epic.id,title:'Recover an unchanged-candidate review loop'});
    const done=await waitFor(()=>store.run(run.id),run=>['complete','waiting'].includes(run.status),30000);assert.equal(done.status,'complete',done.message);
    assert.equal(reviews,4);assert.equal(resolved,true);assert.deepEqual(roles.slice(-3),['lead','builder','reviewer']);
    assert.ok(done.handoffs.some(edge=>edge.from==='review'&&edge.event==='technical_blocker'&&edge.to==='resolve_technical'));
    assert.ok(done.handoffs.some(edge=>edge.from==='review'&&edge.event==='source_changed'&&edge.to==='build'));
    assert.deepEqual(done.completedTickets,[ticket.id]);assert.equal(pmt.list().find(item=>item.id===ticket.id)!.status,'complete');
  }finally{factory.stop();await factory.drained();store.close();if(previous===undefined)delete process.env.BARRACKS_PROJECTS_PATH;else process.env.BARRACKS_PROJECTS_PATH=previous;}
});
