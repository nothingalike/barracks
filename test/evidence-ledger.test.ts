import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {EvidenceLedger} from '../server/evidence-ledger.ts';
import {readFileSync} from 'node:fs';
import {Store} from '../server/store.ts';
import {ParallelDelivery} from '../server/parallel-delivery.ts';
import type {WorkflowRun} from '../shared/factory.ts';

const candidate='a'.repeat(40),criterion='SW-test:1';
function fixture(){const id=randomUUID(),root=resolve('.state/evidence-tests',id);mkdirSync(root,{recursive:true});return {root,ledger:new EvidenceLedger(id)};}
function command(root:string,code=0){writeFileSync(join(root,'process.json'),JSON.stringify({drained:true,status:'exited',exitCode:code===0?0:1,jobName:'Local\\Barracks-'+randomUUID()}));writeFileSync(join(root,'command-result.json'),JSON.stringify({code}));writeFileSync(join(root,'command.json'),'{}');writeFileSync(join(root,'app.exe'),'controlled-test-build');return {executable:'controlled-test',args:[]};}

test('candidate receipts require actual exited/drained process metadata and immutable artifacts',()=>{
  const {root,ledger}=fixture(),cmd=command(root);const receipt=ledger.command(candidate,cmd,root,[{name:'Build',path:join(root,'app.exe'),role:'build'}],'unit');
  const criteria=[{criterion,status:'passed',evidenceIds:[receipt.id]}];ledger.validate(candidate,criteria,[{criterion,kinds:['command','unit']}]);
  assert.throws(()=>ledger.validate('b'.repeat(40),criteria,[{criterion,kinds:['unit']}]),/stale/);
  assert.throws(()=>ledger.validate(candidate,criteria,[{criterion,kinds:['physical']}]),/physical/);
  writeFileSync(receipt.artifacts[0]!.path,'tampered');assert.throws(()=>ledger.list(candidate),/hash changed/);
});
test('operator waivers and bounded adjudication preserve raw failures and candidate provenance',()=>{
  const {root,ledger}=fixture();const failed=ledger.command(candidate,command(root,101),root,[{name:'Build',path:join(root,'app.exe'),role:'build'}],'native');
  assert.throws(()=>ledger.observe({candidate,criterion,kind:'physical',status:'passed',note:'Works'},candidate,[root]),/build hash/);
  assert.throws(()=>ledger.observe({candidate,criterion,kind:'command',status:'passed',note:'Trust me'},candidate,[root]),/fabricate/);
  const adjudication=ledger.observe({candidate,criterion,kind:'adjudication',status:'passed',note:'Controlled fixture: bounded metric exception',references:[failed.id],covers:['native']},candidate,[root]);
  ledger.validate(candidate,[{criterion,status:'passed',evidenceIds:[adjudication.id]}],[{criterion,kinds:['native']}]);
  assert.equal(ledger.list(candidate).find(item=>item.id===failed.id)!.status,'failed');
  assert.throws(()=>ledger.observe({candidate,criterion,kind:'adjudication',status:'passed',note:'Invented physical result',references:[failed.id],covers:['physical']},candidate,[root]),/invent/);
  const waiver=ledger.observe({candidate,criterion,kind:'waiver',status:'waived',note:'Explicit controlled test waiver'},candidate,[root]);
  ledger.validate(candidate,[{criterion,status:'waived',evidenceIds:[waiver.id]}],[{criterion,kinds:['physical']}]);
  assert.throws(()=>ledger.validate(candidate,[{criterion,status:'waived',evidenceIds:[failed.id]}],[{criterion,kinds:['physical']}]),/operator waiver/);
});
test('observations bind recorded build and helper hashes and do not accept unknown or escaped artifacts',()=>{
  const {root,ledger}=fixture(),receipt=ledger.command(candidate,command(root),root,[{name:'Build',path:join(root,'app.exe'),role:'build'}]);
  const input={candidate,criterion,kind:'physical',status:'passed',note:'Controlled operator observation',platform:'fixture Windows',buildHash:receipt.buildHash};
  const observation=ledger.observe(input,candidate,[root]);ledger.validate(candidate,[{criterion,status:'passed',evidenceIds:[observation.id]}],[{criterion,kinds:['physical']}]);
  assert.throws(()=>ledger.observe({...input,helperHash:'f'.repeat(64)},candidate,[root]),/helperHash/);
  assert.throws(()=>ledger.observe({...input,candidate:'b'.repeat(40)},candidate,[root]),/different source/);
  assert.throws(()=>ledger.observe({...input,artifacts:[{path:resolve('package.json')}]},candidate,[root]),/outside/);
  assert.throws(()=>ledger.validate(candidate,[{criterion,status:'passed',evidenceIds:[randomUUID()]}],[{criterion,kinds:['physical']}]),/missing/);
});

test('passed independent source reviews supply candidate-bound acceptance evidence',()=>{
  const {ledger}=fixture(),proof={candidate,integrationReview:'Lead inspected this exact combined candidate.',tickets:[{ticketId:'SW-test',candidate,author:'builder',reviews:[{candidate,reviewer:'spec',assignmentId:randomUUID(),approved:true as const,notes:'Inspected all assigned source criteria.'},{candidate,reviewer:'standards',assignmentId:randomUUID(),approved:true as const,notes:'Source boundaries preserved.'}]}]};
  const receipt=ledger.sourceReview(candidate,criterion,proof);
  ledger.validate(candidate,[{criterion,status:'passed',evidenceIds:[receipt.id]}],[{criterion,kinds:['source']}]);
  assert.equal(receipt.origin,'runner');assert.equal(receipt.artifacts.length,1);
  assert.throws(()=>ledger.sourceReview('b'.repeat(40),criterion,proof),/candidate/);
  assert.throws(()=>ledger.sourceReview(candidate,criterion,{...proof,tickets:[{...proof.tickets[0]!,reviews:[{...proof.tickets[0]!.reviews[0]!,reviewer:'builder'}]}]}),/independent/);
  assert.throws(()=>ledger.sourceReview(candidate,criterion,{...proof,tickets:[{...proof.tickets[0]!,reviews:[{...proof.tickets[0]!.reviews[0]!,candidate:'c'.repeat(40)}]}]}),/candidate/);
});

test('baseline-only source observations remain usable without inventing child reviews',()=>{
  const id=randomUUID(),ledger=new EvidenceLedger(id),store=new Store(':memory:');
  const definition=JSON.parse(readFileSync('config/workflows.json','utf8')).find((item:{id:string})=>item.id==='qualified-delivery');
  const run:WorkflowRun={id,projectId:'baseline',workflowId:definition.id,title:'Previously accepted baseline',description:'',definition,status:'running',phase:'acceptance',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),turns:[],questions:[],message:'',recovery:false,attempts:[],baseCandidate:candidate,ticketOrder:['SW-test'],completedTickets:['SW-test'],artifacts:{acceptance_requirements:[{criterion,kinds:['source']}]},personaInstructions:{},handoffs:[]};
  const receipt=ledger.observe({candidate,criterion,kind:'source',status:'passed',note:'Actual prior baseline source review.'},candidate,[]);
  try{
    const delivery=new ParallelDelivery(store);assert.doesNotThrow(()=>delivery.recordSourceReviews(run));
    assert.equal(ledger.list(candidate).length,1);assert.equal(ledger.list(candidate)[0]!.id,receipt.id);
    run.baseCandidate='b'.repeat(40);assert.throws(()=>delivery.recordSourceReviews(run),/unchanged Lead-reviewed/);
  }finally{store.close();}
});
