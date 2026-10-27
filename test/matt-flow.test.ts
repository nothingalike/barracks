import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {workflowDefinitionSchema,transition,stateInputs} from '../shared/state-machine.ts';
import {validateAcceptance} from '../server/discovery-agent.ts';
import {Store} from '../server/store.ts';
import {configSchema} from '../shared/workflow.ts';

const definitions=()=>JSON.parse(readFileSync('config/workflows.json','utf8')).map((value:unknown)=>workflowDefinitionSchema.parse(value));

test('a new ticket receives no answers or questions from its predecessor',()=>{
  const delivery=definitions().find((value:any)=>value.id==='delivery')!;
  const next=transition(delivery,'select_ticket',{event:'ticket_selected',ticket:{id:'B'}},{answers:'Only ticket A may omit the export.',questions:['Ticket A question'],resolution:'Ticket A resolution'});
  const inputs=stateInputs(delivery.states.build!,{...next.artifacts,task:{},project:{},epic:{},implementation_plan:'Build ticket B'});
  assert.equal(inputs.answers,undefined);assert.equal(next.artifacts.questions,undefined);assert.equal(next.artifacts.resolution,undefined);
});

test('acceptance cannot pass unverified criteria or a different candidate',()=>{
  assert.throws(()=>validateAcceptance({event:'acceptance_passed',document:'Looks good',questions:[],plan:null,criteria:[{criterion:'Browser journey',status:'unverified',evidence:'Browser unavailable'}]}),/every criterion/);
  const delivery=definitions().find((value:any)=>value.id==='delivery')!;
  assert.throws(()=>transition(delivery,'acceptance',{event:'acceptance_passed',document:'Passed',accepted:true,candidate:'old'},{delivery_candidate:'new'}),/exact delivery candidate/);
  assert.throws(()=>transition(delivery,'acceptance',{event:'acceptance_passed',document:'Claim only',candidate:'new'},{delivery_candidate:'new'}),/exact delivery candidate/);
  assert.throws(()=>validateAcceptance({event:'acceptance_passed',document:'Partial',questions:[],plan:null,criteria:[{criterion:'A:1',status:'passed',evidence:'Checked'}]},['A:1','A:2']),/every supplied criterion/);
});

test('replaying an acceptance repair after a checkpoint interruption is idempotent',()=>{
  const store=new Store(':memory:'),config=configSchema.parse(JSON.parse(readFileSync('config/workflow.json','utf8')));
  try{
    const task=store.create({title:'Repair acceptance',projectId:'slug',execution:'simulation',specificationReady:true,requestChangesOnce:false});
    store.finish(store.claim(task.id,config)!.id,{kind:'triaged',specificationReady:true},config);
    store.finish(store.claim(task.id,config)!.id,{kind:'built',candidate:'a'.repeat(40),verified:true},config);
    store.finish(store.claim(task.id,config)!.id,{kind:'reviewed',candidate:'a'.repeat(40),approved:true,notes:'Reviewed'},config);
    store.reopenForAcceptance(task.id,'Expected 2; observed 1.');const count=store.history(task.id).length;
    store.reopenForAcceptance(task.id,'Expected 2; observed 1.');
    assert.equal(store.task(task.id).state,'implementing');assert.equal(store.task(task.id).verified,false);assert.equal(store.history(task.id).length,count);
    assert.throws(()=>store.reopenForAcceptance(task.id,'An unrelated change'),/reviewed candidate/);
  }finally{store.close();}
});

test('discovery questions return to their author and publication waits for both user reviews',()=>{
  const discovery=definitions().find((value:any)=>value.id==='grilling')!;
  for(const state of ['develop_brief','challenge','specify','create_tickets']){
    const next=transition(discovery,state,{event:'needs_user',document:'Decision needed',questions:['Choose behavior']},{});
    const resumed=transition(discovery,next.target,{event:'answered',answer:'Use the existing behavior'},next.artifacts,next.resumeState);
    assert.equal(resumed.target,state);
  }
  let next=transition(discovery,'specify',{event:'specification_ready',document:'Accepted behavior and seams'},{});
  assert.equal(discovery.states[next.target]!.type,'human');
  const gate=next.target;
  next=transition(discovery,gate,{event:'changes',answer:'Cover offline failure'},next.artifacts);
  assert.equal(next.target,'specify');
  next=transition(discovery,gate,{event:'answered',answer:'Approve the specification'},next.artifacts);
  assert.equal(next.target,'create_tickets');
  next=transition(discovery,'create_tickets',{event:'tickets_ready',plan:{epic:{title:'Goal'},tickets:[]},document:'Breakdown'},next.artifacts);
  assert.equal(discovery.states[next.target]!.type,'human');
  next=transition(discovery,next.target,{event:'answered',answer:'Approve the slices and blockers'},next.artifacts);
  assert.equal(next.target,'publish_tickets');
  assert.equal(stateInputs(discovery.states.publish_tickets!,next.artifacts).ticket_approval,'Approve the slices and blockers');
});
