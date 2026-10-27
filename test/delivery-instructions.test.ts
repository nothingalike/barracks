import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {Store} from '../server/store.ts';
import {projectSchema} from '../server/projects.ts';
import {configSchema} from '../shared/workflow.ts';
import type {WorkflowRun} from '../shared/factory.ts';
import {TicketExecutors,type TicketWorker} from '../server/ticket-executors.ts';
import {Runner,SimulatedWorker} from '../server/runner.ts';
import {workflows} from '../server/workflow-definitions.ts';

test('every ticket role and technical retry receives the pinned parent delivery instructions',async()=>{
  const root=resolve('.state/delivery-instruction-tests',randomUUID());mkdirSync(root,{recursive:true});
  const project=projectSchema.parse({id:'instructions',name:'Instructions',kind:'fixture',path:root,reviewChecklist:'Preserve scope.'});
  const definitions=workflows(),definition=definitions.find(item=>item.id==='qualified-ticket')!,parentDefinition=definitions.find(item=>item.id==='qualified-delivery')!,config=configSchema.parse(JSON.parse(readFileSync('config/workflow.json','utf8')));
  const operator='Work from rust-refactor. Leave main untouched. Value longevity and maintainability.\n'+'x'.repeat(19000);
  const parent:WorkflowRun={id:randomUUID(),projectId:project.id,workflowId:parentDefinition.id,definition:parentDefinition,phase:parentDefinition.initial,status:'queued',createdAt:'',updatedAt:'',title:'Delivery',description:operator,turns:[],questions:[],message:'',recovery:false,attempts:[],artifacts:{project_snapshot:project},personaInstructions:{},handoffs:[],baseTaskId:randomUUID(),baseCandidate:'a'.repeat(40),parallel:{commit:'b'.repeat(40),initialTree:'a'.repeat(40),initialFiles:{},excludedPrefixes:[],ticketRuns:{},wave:[]},ticketDefinition:definition,ticketPersonaInstructions:Object.fromEntries(definition.participants.map(id=>[id,'Persona '+id]))};
  const store=new Store(':memory:');store.saveRun(parent);const child=store.reserveParallelTicket(parent,{id:'T1',title:'Ticket scope',status:'backlog',path:'T1.md',revision:'one',dependsOn:[],body:'## Acceptance Criteria\n- Preserve the named behavior.'});
  const observed:string[]=[];let builds=0;
  const worker:TicketWorker={async run(assignment,task,signal,instructions){assert.ok(instructions);assert.ok(instructions.assignment.includes(operator),'The actual worker assignment must contain the complete operator instructions.');assert.ok(instructions.assignment.includes('Preserve the named behavior.'),'Ticket scope stays present.');observed.push(assignment.role+(assignment.reviewAxis?':'+assignment.reviewAxis:''));
    if(assignment.role==='lead')return assignment.stage==='blocked'?{kind:'resolved',resolution:'Use the existing interface.'}:{kind:'triaged',specificationReady:false};
    if(assignment.role==='ba')return {kind:'refined',summary:'Scoped readiness.'};
    if(assignment.role==='builder'&&++builds===1)return {kind:'blocked',blockerKind:'technical',reason:'Controlled technical blocker.'};
    if(assignment.role==='builder')return {kind:'built',candidate:'c'.repeat(40),verified:true};
    return {kind:'reviewed',candidate:assignment.candidate!,approved:true,notes:'Independent review.'};
  },async reconcile(){return {};}};
  const executor=new TicketExecutors(store,new Runner(store,config,new SimulatedWorker(1)),worker);
  try{for(const phase of ['triage','refine','build','resolve_technical','build','review','review_spec'])await executor.execute(child,definition.states[phase]!,{task:child.artifacts.task},new AbortController().signal);
    assert.deepEqual(observed,['lead','ba','builder','lead','builder','reviewer:standards','reviewer:spec']);assert.equal(store.task(child.id).state,'complete');assert.equal(store.run(parent.id).description,operator);
  }finally{store.close();}
});

test('reconciling an interrupted Lead resolution retains its blocker and spent resolution budget',async()=>{
  const store=new Store(':memory:'),config=configSchema.parse(JSON.parse(readFileSync('config/workflow.json','utf8'))),definition=workflows().find(item=>item.id==='qualified-ticket')!;
  const task=store.create({title:'Shared interface',execution:'codex'},{baseTaskId:randomUUID(),baseCandidate:'a'.repeat(40),coordinated:true}),request={question:'Operator authority is needed for src/roster.rs.',paths:['src/roster.rs']};
  store.finish(store.claimCoordinated(task.id,'builder',false,config)!.id,{kind:'blocked',blockerKind:'technical',reason:request.question,interfaceRequest:request},config);
  const lead=store.claimCoordinated(task.id,'lead',true,config)!;store.hold(lead.id,'Worker reply carried an invalid field.');
  const run:WorkflowRun={id:task.id,projectId:task.projectId,workflowId:definition.id,definition,phase:'resolve_technical',status:'waiting',createdAt:'',updatedAt:'',title:task.title,description:'',turns:[],questions:[],message:'',recovery:true,attempts:[],artifacts:{},personaInstructions:{},handoffs:[],children:{T1:task.id},completedTickets:[]};
  const worker:TicketWorker={async run(){throw Error('An exhausted resolution must not launch another worker.');},async reconcile(){return {};}};
  const executor=new TicketExecutors(store,new Runner(store,config,new SimulatedWorker(1)),worker);
  try{await executor.reconcile(run,'Load the schema fix; preserve the pending ownership decision.');const recovered=store.task(task.id);assert.equal(recovered.state,'blocked');assert.equal(recovered.resumeState,'implementing');assert.equal(recovered.blocker,request.question);assert.equal(recovered.technicalAttempts,1);assert.equal(recovered.cleanupRequired,false);assert.equal(store.assignments().some(item=>item.status==='interrupted'),false);
    const outcome=await executor.execute(run,definition.states.resolve_technical!,{},new AbortController().signal);assert.equal(outcome?.event,'blocked');assert.deepEqual(outcome?.questions,[request.question]);assert.deepEqual(store.task(task.id).interfaceRequest,request);
  }finally{store.close();}
});
