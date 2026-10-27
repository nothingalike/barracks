import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync,readFileSync,existsSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import {Store} from '../server/store.ts';
import {Factory} from '../server/factory.ts';
import {Runner,SimulatedWorker} from '../server/runner.ts';
import {DiscoveryAgent,InvalidWorkerOutput,type DiscoveryReply} from '../server/discovery-agent.ts';
import {Pmt} from '../server/pmt.ts';
import {prepare,candidate,projectSchema} from '../server/projects.ts';
import {configSchema} from '../shared/workflow.ts';
import type {WorkflowRun} from '../shared/factory.ts';
import type {TicketWorker} from '../server/ticket-executors.ts';
import {waitFor} from '../scripts/test-server.ts';

for(const mode of ['interface','invalid-output','project-delegation','adoption-restart'] as const)test('qualified delivery auto-coordination: '+mode,async()=>{
  const root=resolve('.state/coordination-tests',randomUUID()),source=join(root,'source'),tracker=join(root,'tracker');mkdirSync(source,{recursive:true});mkdirSync(tracker);writeFileSync(join(source,'base.mjs'),'export const base=true;');execFileSync('git',['init','--initial-branch=main',tracker],{windowsHide:true,stdio:'pipe'});
  const project=projectSchema.parse({id:'coordination',name:'Coordination',kind:'fixture',path:source,trackerPath:tracker,reviewChecklist:'Scoped modules.',verify:[{executable:'node',args:['--test']}],delivery:{selection:'explicit',requirePathGrants:true,sharedPaths:mode==='project-delegation'?[]:['shared.mjs'],leadDelegation:mode==='project-delegation'?'project':'listed',reviewAxes:['spec','standards']},team:[{id:'lead',name:'Lead',roles:['lead']},{id:'ba',name:'BA',roles:['ba','reviewer'],reviewAxes:['spec']},{id:'session',name:'Session',roles:['builder','reviewer'],reviewAxes:['standards']},{id:'view',name:'View',roles:['builder','reviewer'],reviewAxes:['standards']}]}),pmt=new Pmt(project);
  pmt.ensure(project);pmt.command(['epic','create','--title','Qualified capabilities','--yes']);const epic=pmt.list().find(item=>!item.epic)!;
  for(const title of ['A','B'])pmt.command(['story','create','--title',title,'--epic',epic.id,'--yes']);
  const tickets=pmt.list().filter(item=>item.epic===epic.id);for(const ticket of tickets)pmt.edit(ticket.id,{title:ticket.title,revision:ticket.revision,body:ticket.body.replace('- [Define expected outcomes and restrictions]','- The named capability is available.')+'\n\n## Barracks delivery\n\n```json\n'+JSON.stringify({ownedPaths:[ticket.title+'.mjs']})+'\n```\n'});
  const definitions=JSON.parse(readFileSync('test/fixtures/qualified-workflows.json','utf8'));
  if(mode==='invalid-output'){const parent=definitions.find((item:{id:string})=>item.id==='qualified-delivery');parent.states.check_output={type:'agent',persona:'lead',executor:'conversation',maxOutputRetries:1,inputs:['task'],on:{ready:'dispatch_tickets',invalid_output:'dispatch_tickets'}};parent.initial='check_output';}
  const settings=join(root,'projects.json'),graphs=join(root,'workflows.json'),oldProjects=process.env.BARRACKS_PROJECTS_PATH,oldGraphs=process.env.BARRACKS_WORKFLOWS_PATH;writeFileSync(settings,JSON.stringify({codexExecutable:process.execPath,projects:[project]}));writeFileSync(graphs,JSON.stringify(Array.from(new Map([...JSON.parse(readFileSync('config/workflows.json','utf8')),...definitions].map(item=>[item.id,item])).values())));process.env.BARRACKS_PROJECTS_PATH=settings;process.env.BARRACKS_WORKFLOWS_PATH=graphs;
  const store=new Store(join(root,'state.db')),config=configSchema.parse(JSON.parse(readFileSync('config/workflow.json','utf8'))),active=new Set<string>();let requestCount=0,resolutions=0,baRefinements=0;
  const enter=(id:string)=>{assert.equal(active.has(id),false,'One participant cannot run two assignments.');active.add(id);};
  const worker:TicketWorker={async run(assignment,task){enter(assignment.worker);try{await delay(20);
    if(assignment.stage==='blocked'){resolutions++;assert.equal(assignment.worker,'lead');assert.ok(task.interfaceRequest);return {kind:'resolved',resolution:'Use the agreed shared export; ownership is delegated.',grantedPaths:['shared.mjs']};}
    if(assignment.role==='lead')return {kind:'triaged',specificationReady:true,summary:'Scope and ownership are ready; build directly.'};
    if(assignment.role==='ba'){baRefinements++;return {kind:'refined',summary:'Ready.'};}
    if(assignment.role==='reviewer'){assert.ok(assignment.reviewAxis);return {kind:'reviewed',candidate:assignment.candidate!,approved:true,notes:assignment.reviewAxis+' passed on exact source.'};}
    if(task.title==='A'&&!requestCount++){return {kind:'blocked',blockerKind:'technical',reason:'Need the shared export interface.',interfaceRequest:{question:'Approve the shared export shape.',paths:['shared.mjs']}};}
    const context=prepare(task);writeFileSync(join(context.workspace,task.title+'.mjs'),'export const '+task.title+'=true;');if(task.title==='A'){assert.ok(task.writablePaths!.includes('shared.mjs'));writeFileSync(join(context.workspace,'shared.mjs'),'export const shared=true;');}
    return {kind:'built',candidate:candidate(context.root),verified:true};
  }finally{active.delete(assignment.worker);}},async reconcile(){return {};}};
  class Agent extends DiscoveryAgent {override async run(run:WorkflowRun):Promise<DiscoveryReply>{enter('lead');try{await delay(10);if(run.phase==='check_output')throw new InvalidWorkerOutput('Controlled post-drain invalid response.');if(run.phase==='integrate')return {event:'integrated',document:'Combined scope inspected.',questions:[],plan:null};if(run.phase==='retrospective')return {event:'retrospective_ready',document:'No operator wake-up required.',questions:[],plan:null};assert.equal(run.phase,'acceptance');return {event:'acceptance_passed',document:'Controlled source acceptance.',questions:[],plan:null,criteria:(run.artifacts.acceptance_criteria as {id:string}[]).map(item=>({criterion:item.id,status:'passed',evidence:'Controlled-worker source proof.'}))};}finally{active.delete('lead');}}override async reconcile(){}}
  const runner=new Runner(store,config,new SimulatedWorker(1));let factory=new Factory(store,runner,new Agent(),worker);if(mode==='adoption-restart')store.pause(true);factory.start();
  try{const created=factory.create({projectId:project.id,workflowId:'qualified-delivery',epicId:epic.id,ticketIds:tickets.map(ticket=>ticket.id),title:'Qualified coordination'});
    if(mode==='adoption-restart'){
      const previousEpoch=Number(store.run(created.id).artifacts.coordinator_epoch);factory.stop();await factory.drained();factory=new Factory(store,runner,new Agent(),worker);factory.start();
      const adopted=factory.adoptLeadDelegation(created.id,{mode:'project',reason:'Adopt routine coordination after coordinator replacement.'});
      assert.ok(Number(adopted.run.artifacts.coordinator_epoch)>previousEpoch,'The adoption receipt must retain the renewed coordinator epoch.');assert.equal(store.run(created.id).artifacts.coordinator_epoch,adopted.run.artifacts.coordinator_epoch);
      store.pause(false);factory.tick();
    }
    const done=await waitFor(()=>store.run(created.id),run=>['complete','waiting'].includes(run.status),60000);assert.equal(done.status,'complete',done.message+' '+done.questions.join(' '));assert.equal(resolutions,1);assert.equal(baRefinements,0);assert.equal(done.turns.some(turn=>turn.role==='user'),false);for(const id of Object.values(done.children!)){const task=store.task(id);assert.ok(task.reviewVerdicts?.spec?.approved);assert.ok(task.reviewVerdicts?.standards?.approved);assert.notEqual(task.reviewVerdicts?.standards?.reviewer,task.author);}assert.equal(store.leases().length,0);assert.equal(existsSync(join(source,'shared.mjs')),true);
  }finally{factory.stop();await factory.drained();store.close();if(oldProjects===undefined)delete process.env.BARRACKS_PROJECTS_PATH;else process.env.BARRACKS_PROJECTS_PATH=oldProjects;if(oldGraphs===undefined)delete process.env.BARRACKS_WORKFLOWS_PATH;else process.env.BARRACKS_WORKFLOWS_PATH=oldGraphs;}
});
