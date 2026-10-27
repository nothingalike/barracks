import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdirSync,readFileSync,existsSync,cpSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {runOwned,readJson,StoppedError,reconcileProcess,RepeatedFailureError} from '../server/process.ts';
import {runtimeSettings} from '../server/projects.ts';
import {DiscoveryAgent} from '../server/discovery-agent.ts';
async function until(check:()=>boolean){const end=Date.now()+15000;while(!check()&&Date.now()<end)await delay(50);assert.ok(check(),'Expected process state within 15 seconds.');}

test('cancel drains an owned process tree and stops further writes',async()=>{
  const directory=resolve('.state/process-tests',randomUUID());mkdirSync(directory,{recursive:true});
  const controller=new AbortController(),file=join(directory,'heartbeat'),attempt=join(directory,'attempt');
  const pending=runOwned({executable:process.execPath,args:[resolve('test/fixtures/heartbeat.mjs'),'root',file],cwd:process.cwd(),node:process.execPath,directory:attempt,signal:controller.signal});
  await until(()=>existsSync(file)&&readFileSync(file,'utf8').trim().split('\n').length>5);
  controller.abort();await assert.rejects(pending,StoppedError);
  const state=readJson<{drained:boolean;remainingMembers:number[]}>(join(attempt,'process.json'))!;
  assert.equal(state.drained,true);assert.deepEqual(state.remainingMembers,[]);
  const before=readFileSync(file,'utf8');await delay(400);assert.equal(readFileSync(file,'utf8'),before);
});

test('loss of the coordinator stops its owned descendants before reconciliation permits replacement',async()=>{
  const directory=resolve('.state/process-tests',randomUUID());mkdirSync(directory,{recursive:true});
  const owner=spawn(process.execPath,['--experimental-strip-types',resolve('test/fixtures/owned-owner.ts'),directory],{windowsHide:true,stdio:'ignore'});
  const file=join(directory,'heartbeat'),attempt=join(directory,'attempt');
  try {
    await until(()=>existsSync(file)&&readFileSync(file,'utf8').trim().split('\n').length>5);
    owner.kill('SIGKILL');
    await reconcileProcess(attempt);
    const state=readJson<{status:string;drained:boolean}>(join(attempt,'process.json'))!;
    assert.equal(state.status,'owner-lost');assert.equal(state.drained,true);
    const before=readFileSync(file,'utf8');await delay(400);assert.equal(readFileSync(file,'utf8'),before);
  }finally{if(owner.exitCode===null)owner.kill('SIGKILL');}
});

test('verification workspace-write permits local artifacts but refuses writes to a sibling canonical canary',async()=>{
  const directory=resolve('.state/process-tests',randomUUID()),workspace=join(directory,'workspace'),tools=join(directory,'tools');mkdirSync(workspace,{recursive:true});mkdirSync(tools);const node=join(tools,'node.exe');cpSync(process.execPath,node);
  const canary=join(directory,'canonical.txt');writeFileSync(canary,'protected');
  const code=`const fs=require('node:fs');fs.writeFileSync('artifact.txt','generated');try{fs.writeFileSync(${JSON.stringify(canary)},'changed');console.log('unexpected write');}catch{console.log('outside write refused');}`;
  const result=await runOwned({executable:runtimeSettings().codexExecutable,args:['sandbox','-P',':workspace','-C',workspace,'--',node,'-e',code],cwd:workspace,node,directory:join(directory,'verify')});
  assert.equal(readFileSync(join(workspace,'artifact.txt'),'utf8'),'generated');assert.equal(readFileSync(canary,'utf8'),'protected');assert.match(result.stdout,/outside write refused/);
});

test('acceptance reconciliation drains an interrupted verification job before replacement',async()=>{
  const directory=resolve('.state/process-tests',randomUUID());mkdirSync(directory,{recursive:true});
  const owner=spawn(process.execPath,['--experimental-strip-types',resolve('test/fixtures/owned-owner.ts'),directory,'verify-0'],{windowsHide:true,stdio:'ignore'});
  const file=join(directory,'heartbeat');
  try{
    await until(()=>existsSync(file)&&readFileSync(file,'utf8').trim().split('\n').length>5);
    owner.kill('SIGKILL');await new DiscoveryAgent().reconcile({attempts:[directory]});
    const receipt=readJson<{drained:boolean}>(join(directory,'verify-0','process.json'))!;assert.equal(receipt.drained,true);
    const before=readFileSync(file,'utf8');await delay(400);assert.equal(readFileSync(file,'utf8'),before);
  }finally{if(owner.exitCode===null)owner.kill('SIGKILL');}
});

test('an explicitly unlimited assignment records no deadline and still cancels cleanly',async()=>{
  const directory=resolve('.state/process-tests',randomUUID());mkdirSync(directory,{recursive:true});const controller=new AbortController();
  const pending=runOwned({executable:process.execPath,args:['-e','setInterval(()=>{},1000)'],cwd:directory,node:process.execPath,directory:join(directory,'agent'),timeoutMs:null,signal:controller.signal});
  try{assert.equal(readJson<{maxRuntimeMs:number|null}>(join(directory,'agent','command.json'))!.maxRuntimeMs,null);}
  finally{controller.abort();await assert.rejects(pending,StoppedError);}
  assert.equal(readJson<{drained:boolean}>(join(directory,'agent','process.json'))!.drained,true);
});

test('inactivity supervision warns while the unlimited process remains running',async()=>{
  const directory=resolve('.state/process-tests',randomUUID()),workspace=join(directory,'workspace');mkdirSync(workspace,{recursive:true});const controller=new AbortController(),attempt=join(directory,'agent');
  const pending=runOwned({executable:process.execPath,args:['-e','setInterval(()=>{},1000)'],cwd:workspace,node:process.execPath,directory:attempt,timeoutMs:null,signal:controller.signal,supervision:{workspace,warningAfterMs:100}});
  try{await until(()=>readJson<{reason:string}>(join(attempt,'activity.json'))?.reason==='inactivity');assert.equal(readJson<{status:string}>(join(attempt,'process.json'))!.status,'running');}
  finally{controller.abort();await assert.rejects(pending,StoppedError);}
});

test('repeated command failures drain the job before raising a technical loop error',async()=>{
  const directory=resolve('.state/process-tests',randomUUID()),workspace=join(directory,'workspace');mkdirSync(workspace,{recursive:true});const attempt=join(directory,'agent');
  const code=`const event={type:'item.completed',item:{type:'command_execution',command:'node --test',exit_code:1,aggregated_output:'same failure'}};for(let i=0;i<3;i++)console.log(JSON.stringify(event));setInterval(()=>{},1000);`;
  await assert.rejects(runOwned({executable:process.execPath,args:['-e',code],cwd:workspace,node:process.execPath,directory:attempt,timeoutMs:null,supervision:{workspace,warningAfterMs:10000}}),RepeatedFailureError);
  assert.equal(readJson<{drained:boolean}>(join(attempt,'process.json'))!.drained,true);
});

test('explicit command deadlines still stop and drain a hung command',async()=>{
  const directory=resolve('.state/process-tests',randomUUID());mkdirSync(directory,{recursive:true});
  await assert.rejects(runOwned({executable:process.execPath,args:['-e','setInterval(()=>{},1000)'],cwd:directory,node:process.execPath,directory:join(directory,'command'),timeoutMs:250}),/timed-out/);
  assert.equal(readJson<{drained:boolean}>(join(directory,'command','process.json'))!.drained,true);
});
