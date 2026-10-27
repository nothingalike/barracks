import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {Pmt} from '../server/pmt.ts';
import {Store} from '../server/store.ts';
import {Factory} from '../server/factory.ts';
import {Runner,SimulatedWorker} from '../server/runner.ts';
import {DiscoveryAgent,type DiscoveryReply} from '../server/discovery-agent.ts';
import {setupProjectGit} from '../server/project-management.ts';
import {projectSchema} from '../server/projects.ts';
import {configSchema} from '../shared/workflow.ts';
import type {WorkflowRun} from '../shared/factory.ts';
import {waitFor} from '../scripts/test-server.ts';

for(const exhaust of [false,true])test(exhaust?'workflow-level Lead recovery is bounded before user escalation':'acceptance and retrospective loops both visit Lead and resume their own state',async()=>{
  const root=resolve('.state/delivery-supervision-tests',randomUUID()),source=join(root,'source');mkdirSync(source,{recursive:true});execFileSync('git',['init','--initial-branch=main',source],{windowsHide:true,stdio:'pipe'});setupProjectGit({path:source,action:'initial-commit',confirmed:true,files:[],name:'Fixture',email:'fixture@invalid'});
  const project=projectSchema.parse({id:'workflow-supervision',name:'Workflow supervision',kind:'repository',path:source,reviewChecklist:'Preserve the baseline.'}),pmt=new Pmt(project);pmt.ensure(project);pmt.command(['epic','create','--title','Preserve baseline','--summary','A previously completed fixture.','--yes']);const epic=pmt.list().find(item=>!item.epic)!;pmt.command(['story','create','--title','Preserve baseline','--epic',epic.id,'--summary','Keep the accepted baseline.','--yes']);const ticket=pmt.list().find(item=>item.epic===epic.id)!;pmt.edit(ticket.id,{title:ticket.title,revision:ticket.revision,body:ticket.body.replace('- [Define expected outcomes and restrictions]','- The accepted baseline is preserved.')});pmt.move(ticket.id,'in-progress');pmt.move(ticket.id,'complete');
  const file=join(root,'projects.json');writeFileSync(file,JSON.stringify({codexExecutable:process.execPath,projects:[project]}));const previous=process.env.BARRACKS_PROJECTS_PATH;process.env.BARRACKS_PROJECTS_PATH=file;
  const store=new Store(join(root,'runs.db')),config=configSchema.parse(JSON.parse(readFileSync('config/workflow.json','utf8'))),runner=new Runner(store,config,new SimulatedWorker(1));let acceptance=0,retro=0,leads=0;
  class Agent extends DiscoveryAgent {override async run(run:WorkflowRun):Promise<DiscoveryReply>{
    const executor=run.definition.states[run.phase]!.executor;
    if(executor==='resolve-delivery'){leads++;assert.ok(run.artifacts.execution_evidence);return {event:'resolved',document:'Use the retained local diagnostic command.',questions:[],plan:null};}
    if(executor==='acceptance'){
      acceptance++;const blocked=exhaust||acceptance===1;return {event:blocked?'technical_blocker':'acceptance_passed',document:blocked?'Repeated command failure.':'Baseline observed.',questions:blocked?['Resolve the repeated command failure.']:[],plan:null,criteria:(run.artifacts.acceptance_criteria as {id:string}[]).map(item=>({criterion:item.id,status:blocked?'unverified':'passed',evidence:blocked?'The command failed repeatedly.':'Baseline remains unchanged.'}))};
    }
    retro++;return {event:retro===1?'technical_blocker':'retrospective_ready',document:retro===1?'Repeated inspection failure.':'Retrospective recommendations.',questions:retro===1?['Resolve the repeated inspection failure.']:[],plan:null};
  }}
  const factory=new Factory(store,runner,new Agent());factory.start();try{
    const run=factory.create({projectId:project.id,workflowId:'delivery',epicId:epic.id,title:'Observe workflow recovery'});const done=await waitFor(()=>store.run(run.id),run=>run.status==='complete'||run.status==='waiting',30000);
    if(exhaust){assert.equal(done.phase,'await_delivery_resolution',done.message);assert.equal(leads,1);assert.equal(done.recovery,false);}
    else{assert.equal(done.status,'complete',done.message);assert.equal(leads,2);assert.equal(acceptance,2);assert.equal(retro,2);assert.ok(done.handoffs.some(edge=>edge.from==='resolve_delivery'&&edge.to==='acceptance'));assert.ok(done.handoffs.some(edge=>edge.from==='resolve_delivery'&&edge.to==='retrospective'));}
  }finally{factory.stop();await factory.drained();store.close();if(previous===undefined)delete process.env.BARRACKS_PROJECTS_PATH;else process.env.BARRACKS_PROJECTS_PATH=previous;}
});
