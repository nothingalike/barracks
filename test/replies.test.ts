import test from 'node:test';
import assert from 'node:assert/strict';
import {parseReply} from '../server/codex-worker.ts';
test('worker decisions are constrained to the current role and cannot carry contradictory routing flags',()=>{
  assert.equal(parseReply('queued',{action:'refine',summary:'Needs BA plan.',blockerKind:'none'}).action,'refine');
  assert.throws(()=>parseReply('queued',{action:'implemented',summary:'Skip assignment.',blockerKind:'none'}));
  assert.throws(()=>parseReply('reviewing',{action:'ready',summary:'Unrelated routing.',blockerKind:'none'}));
  assert.throws(()=>parseReply('queued',{action:'refine',summary:'BA needed.',blockerKind:'none',blocked:true}));
});
test('only Builder replies can carry shared-interface requests; Lead can report an authority blocker',()=>{
  const request={question:'A shared file needs its owner.',paths:['src/roster.rs']};
  for(const stage of ['queued','refining','reviewing','blocked'] as const)assert.throws(()=>parseReply(stage,{action:'blocked',summary:'Needs authority.',blockerKind:'authority',interfaceRequest:request}));
  assert.equal(parseReply('blocked',{action:'blocked',summary:'Needs operator authority for src/roster.rs.',blockerKind:'authority',interfaceRequest:null}).blockerKind,'authority');
  assert.deepEqual(parseReply('implementing',{action:'blocked',summary:'Needs shared contract.',blockerKind:'technical',interfaceRequest:request}).interfaceRequest,request);
});
