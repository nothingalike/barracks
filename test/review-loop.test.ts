import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {Store} from '../server/store.ts';
import {Runner,SimulatedWorker} from '../server/runner.ts';
import {Factory} from '../server/factory.ts';
import {Pmt} from '../server/pmt.ts';
import {prepare,candidate,projectSchema} from '../server/projects.ts';
import {setupProjectGit} from '../server/project-management.ts';
import {configSchema,type Assignment,type Task,type WorkerResult} from '../shared/workflow.ts';
import {waitFor} from '../scripts/test-server.ts';

test('unchanged review loops route through Lead and rebuild before reviewing again',async()=>{
  const root=resolve('.state/review-loop-tests',randomUUID()),source=join(root,'source');mkdirSync(source,{recursive:true});execFileSync('git',['init','--initial-branch=main',source],{windowsHide:true,stdio:'pipe'});setupProjectGit({path:source,action:'initial-commit',confirmed:true,files:[],name:'Fixture',email:'fixture@invalid'});
  const project=projectSchema.parse({id:'review-loop',name:'Review loop',kind:'repository',path:source,reviewChecklist:'Inspect acceptance behavior.'}),pmt=new Pmt(project);pmt.ensure(project);pmt.command(['epic','create','--title','Resolve unchanged findings','--summary','One bounded fixture.','--yes']);const epic=pmt.list().find(item=>!item.epic)!;pmt.command(['story','create','--title','Implement the behavior','--epic',epic.id,'--summary','Return the required value.','--yes']);const ticket=pmt.list().find(item=>item.epic===epic.id)!;pmt.edit(ticket.id,{title:ticket.title,revision:ticket.revision,body:ticket.body.replace('- [Define expected outcomes and restrictions]','- The required value is returned and independently reviewed.')});
  const graph=JSON.parse(readFileSync('config/workflows.json','utf8')).find((item:any)=>item.id==='delivery');
  delete graph.states.refine;graph.states.triage.on.ready.target='build';graph.states.triage.on.refine.target='build';graph.states.build.inputs=graph.states.build.inputs.filter((id:string)=>id!=='implementation_plan');
  for(const id of ['acceptance','await_acceptance','reopen_ticket','retrospective','resolve_delivery','await_delivery_resolution'])delete graph.states[id];graph.states.select_ticket.on.all_done='complete';graph.states.complete.requires=[];
  const projects=join(root,'projects.json'),workflows=join(root,'workflows.json');writeFileSync(projects,JSON.stringify({codexExecutable:process.execPath,projects:[project]}));writeFileSync(workflows,JSON.stringify([graph]));
  const oldProject=process.env.BARRACKS_PROJECTS_PATH,oldGraph=process.env.BARRACKS_WORKFLOWS_PATH;process.env.BARRACKS_PROJECTS_PATH=projects;process.env.BARRACKS_WORKFLOWS_PATH=workflows;
  const store=new Store(join(root,'runs.db')),config=configSchema.parse(JSON.parse(readFileSync('config/workflow.json','utf8'))),runner=new Runner(store,config,new SimulatedWorker(1));let builds=0,reviews=0,resolutions=0;
  const worker={async run(assignment:Assignment,task:Task):Promise<WorkerResult>{
    if(assignment.stage==='blocked'){resolutions++;return {kind:'resolved',resolution:'Use the missing behavior check and rebuild.'};}
    if(assignment.role==='lead')return {kind:'triaged',specificationReady:true};
    if(assignment.role==='builder'){builds++;const context=prepare(task);writeFileSync(join(context.workspace,'value.mjs'),'export const value='+builds+';');return {kind:'built',candidate:candidate(context.root),verified:true};}
    reviews++;return {kind:'reviewed',candidate:assignment.candidate!,approved:reviews===4,notes:reviews===4?'Standards and Spec pass.':'The same required behavior is missing.'};
  },async reconcile(){return {};}};
  const factory=new Factory(store,runner,undefined,worker);factory.start();try{
    const run=factory.create({projectId:project.id,workflowId:'delivery',epicId:epic.id,title:'Resolve the loop'});const done=await waitFor(()=>store.run(run.id),run=>run.status==='complete'||run.recovery||run.phase==='await_resolution',30000);
    assert.equal(done.status,'complete',done.message);assert.equal(resolutions,1);assert.equal(builds,4);assert.equal(reviews,4);assert.ok(done.handoffs.some(edge=>edge.event==='source_changed'&&edge.to==='build'));
  }finally{factory.stop();await factory.drained();store.close();if(oldProject===undefined)delete process.env.BARRACKS_PROJECTS_PATH;else process.env.BARRACKS_PROJECTS_PATH=oldProject;if(oldGraph===undefined)delete process.env.BARRACKS_WORKFLOWS_PATH;else process.env.BARRACKS_WORKFLOWS_PATH=oldGraph;}
});
