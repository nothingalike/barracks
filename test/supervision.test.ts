import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync,appendFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {AgentSupervisor} from '../server/supervision.ts';
import {Store} from '../server/store.ts';
import {configSchema} from '../shared/workflow.ts';
import {readFileSync} from 'node:fs';
import {readActivity} from '../server/process.ts';

test('quiet reasoning raises attention, and observed file changes clear inactivity',()=>{
  const root=resolve('.state/supervision-tests',randomUUID()),workspace=join(root,'workspace');mkdirSync(workspace,{recursive:true});
  const monitor=new AgentSupervisor(root,{workspace,warningAfterMs:100},0);
  const quiet=monitor.sample(101);assert.equal(quiet.reason,'inactivity');assert.equal(quiet.ended,false);
  writeFileSync(join(workspace,'implementation.mjs'),'export const value=1;');
  const changed=monitor.sample(110);assert.equal(changed.attention,false);assert.equal(changed.workspaceChanges,1);assert.equal(changed.idleMs,0);
});

test('only consecutive identical failed commands without observed edits trigger loop attention',()=>{
  const root=resolve('.state/supervision-tests',randomUUID()),workspace=join(root,'workspace');mkdirSync(workspace,{recursive:true});
  const monitor=new AgentSupervisor(root,{workspace,warningAfterMs:10000},0),log=join(root,'stdout.log');
  const event=(code=1)=>JSON.stringify({type:'item.completed',item:{type:'command_execution',command:'node --test',exit_code:code,aggregated_output:code?'Same failing assertion':'Passed'}})+'\n';
  appendFileSync(log,event()+event());assert.equal(monitor.sample(1).repeatedFailures,2);
  writeFileSync(join(workspace,'fix.mjs'),'changed');assert.equal(monitor.sample(2).repeatedFailures,0);
  appendFileSync(log,event()+event());assert.equal(monitor.sample(3).repeatedFailures,2);
  appendFileSync(log,event(0));assert.equal(monitor.sample(4).repeatedFailures,0);
  appendFileSync(log,event()+event()+event());const loop=monitor.sample(5);assert.equal(loop.reason,'repeated-failure');assert.equal(loop.completedCommands,8);
});

test('repeated unchanged review findings become a technical Lead blocker',()=>{
  const store=new Store(':memory:'),config=configSchema.parse(JSON.parse(readFileSync('config/workflow.json','utf8')));
  try{
    const task=store.create({title:'Avoid review loop',specificationReady:true,requestChangesOnce:false});
    store.finish(store.claim(task.id,config)!.id,{kind:'triaged',specificationReady:true},config);
    for(let cycle=0;cycle<3;cycle++){
      const tree=String(cycle).repeat(40);store.finish(store.claim(task.id,config)!.id,{kind:'built',verified:true,candidate:tree},config);
      store.finish(store.claim(task.id,config)!.id,{kind:'reviewed',candidate:tree,approved:false,notes:'The same acceptance criterion is unmet.'},config);
    }
    assert.equal(store.task(task.id).state,'blocked');assert.equal(store.task(task.id).blockerKind,'technical');assert.equal(store.task(task.id).repeatedReviewFindings,3);
    assert.equal(store.claim(task.id,config)!.role,'lead');
  }finally{store.close();}
});

test('a retained running observation is not presented as a live agent after interruption',()=>{
  const root=resolve('.state/supervision-tests',randomUUID()),workspace=join(root,'workspace');mkdirSync(workspace,{recursive:true});
  const monitor=new AgentSupervisor(root,{workspace,warningAfterMs:100},0);monitor.sample(1);
  writeFileSync(join(root,'process.json'),JSON.stringify({status:'running',drained:false}));
  assert.equal(readActivity(root,false)!.lifecycle,'recovery');assert.equal(readActivity(root,true)!.lifecycle,'running');
  writeFileSync(join(root,'process.json'),JSON.stringify({status:'owner-lost',drained:true}));assert.equal(readActivity(root,false)!.lifecycle,'finished');
});

test('paraphrased rejections of an unchanged candidate reach Lead, while new candidates can progress',()=>{
  const store=new Store(':memory:'),config=configSchema.parse(JSON.parse(readFileSync('config/workflow.json','utf8')));
  try{
    const task=store.create({title:'Changing prose is not source progress',specificationReady:true,requestChangesOnce:false});
    store.finish(store.claim(task.id,config)!.id,{kind:'triaged',specificationReady:true},config);
    const notes=['Cannot inspect the candidate or browser evidence.','Please supply browser receipts and a resolvable candidate.','The revision and browser results remain unverified.'];
    for(const note of notes){
      const tree='a'.repeat(40);store.finish(store.claim(task.id,config)!.id,{kind:'built',verified:true,candidate:tree},config);
      store.finish(store.claim(task.id,config)!.id,{kind:'reviewed',candidate:tree,approved:false,notes:note},config);
    }
    assert.equal(store.task(task.id).state,'blocked');assert.equal(store.task(task.id).blockerKind,'technical');
    const lead=store.claim(task.id,config)!;assert.equal(lead.role,'lead');store.finish(lead.id,{kind:'resolved',resolution:'Repair the evidence handoff.'},config);
    for(let cycle=0;cycle<3;cycle++){
      const tree=String(cycle).repeat(40);store.finish(store.claim(task.id,config)!.id,{kind:'built',verified:true,candidate:tree},config);
      store.finish(store.claim(task.id,config)!.id,{kind:'reviewed',candidate:tree,approved:false,notes:'Distinct actionable finding '+cycle},config);
      assert.equal(store.task(task.id).state,'implementing');
    }
  }finally{store.close();}
});
