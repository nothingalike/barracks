import assert from 'node:assert/strict';
import {existsSync,readFileSync,writeFileSync,mkdirSync,appendFileSync,readdirSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {TestServer,waitFor} from './test-server.ts';
import {reconcileProcess,readJson} from '../server/process.ts';
import {Store} from '../server/store.ts';
import {configSchema} from '../shared/workflow.ts';
const directory=resolve('.state/real-tests/recovery',randomUUID());mkdirSync(directory,{recursive:true});
const server=new TestServer(directory,4122),results:Record<string,unknown>={};
const heartbeatDescription='Authorized lifecycle diagnostic only. Lead: route directly to implementation. Builder: use the supplied Node executable to append process.pid and Date.now() to heartbeat.txt every 100ms for 90 seconds and wait for that foreground command. Do not detach. On retry follow the operator resolution rather than repeat this diagnostic.';
const root=(id:string)=>resolve('.state/tasks',id);
async function task(title:string){return server.api('/tasks',{title,description:heartbeatDescription,execution:'codex',projectId:'slug',specificationReady:true,requestChangesOnce:false});}
async function writing(id:string){await waitFor(async()=>{const s=await server.api('/snapshot'),t=s.tasks.find((t:any)=>t.id===id);if(t.state==='blocked')throw new Error(t.blocker);return existsSync(join(root(id),'workspace/heartbeat.txt'));},Boolean);await delay(400);}
async function quiet(id:string){const file=join(root(id),'workspace/heartbeat.txt'),before=readFileSync(file,'utf8');await delay(1200);assert.equal(readFileSync(file,'utf8'),before);}
try{
  // Seed a controlled technical blocker; the resolution is performed by a real Lead session.
  const store=new Store(join(directory,'state.db')),config=configSchema.parse(JSON.parse(readFileSync('config/workflow.json','utf8')));
  const technical=store.create({title:'Controlled technical blocker for real Lead resolution',description:'Resolve the missing Node path, then implement slugify.',execution:'codex',projectId:'slug',specificationReady:true,requestChangesOnce:false});
  let seed=store.claim(technical.id,config)!;store.finish(seed.id,{kind:'triaged',specificationReady:true},config);seed=store.claim(technical.id,config)!;store.finish(seed.id,{kind:'blocked',blockerKind:'technical',reason:'Qualification fixture: Builder needs the explicit absolute Node executable path. Lead should supply the provided Node path, then return work to implementation.'},config);store.close();
  await server.start();
  await waitFor(async()=>{const s=await server.api('/snapshot');return s.tasks.find((t:any)=>t.id===technical.id);},t=>t.state==='implementing'&&!!t.resolution);
  const technicalState=(await server.api('/snapshot')).tasks.find((t:any)=>t.id===technical.id);assert.equal(technicalState.technicalAttempts,1);assert.match(technicalState.resolution,/node/i);await server.api('/tasks/'+technical.id+'/cancel',{});results.technical={status:'passed',taskId:technical.id};console.log('PASS: real Lead resolves seeded technical blocker and hands back to Builder.');
  const cancelled=await task('Qualification: cancel an actual writing worker');await writing(cancelled.id);await server.api('/tasks/'+cancelled.id+'/cancel',{});await quiet(cancelled.id);assert.equal((await server.api('/snapshot')).tasks.find((t:any)=>t.id===cancelled.id).state,'cancelled');results.cancel={status:'passed',taskId:cancelled.id};console.log('PASS: real writing worker cancellation stops later writes.');
  const interrupted=await task('Qualification: restart and stale review');await writing(interrupted.id);
  let snapshot=await server.api('/snapshot');const active=snapshot.assignments.find((a:any)=>a.taskId===interrupted.id&&a.status==='running');
  const attempt=join(root(interrupted.id),'attempts',active.id,'codex');assert.equal(readJson<any>(join(attempt,'command.json')).ownerPid,server.process!.pid);
  await server.stop(true);await reconcileProcess(attempt);await quiet(interrupted.id);await server.start();
  snapshot=await server.api('/snapshot');assert.equal(snapshot.tasks.find((t:any)=>t.id===interrupted.id).state,'blocked');const count=snapshot.assignments.filter((a:any)=>a.taskId===interrupted.id).length;await delay(1200);assert.equal((await server.api('/snapshot')).assignments.filter((a:any)=>a.taskId===interrupted.id).length,count);
  await server.api('/tasks/'+interrupted.id+'/resume',{answer:'Diagnostic complete. Do not repeat the heartbeat. Preserve heartbeat.txt, implement slugify, add the required regression test and obtain review.'});results.restart={status:'passed',taskId:interrupted.id};console.log('PASS: restart holds the old attempt without duplicate launch; reconciliation resumes preserved work.');
  const review=await waitFor(async()=>{const s=await server.api('/snapshot'),t=s.tasks.find((t:any)=>t.id===interrupted.id);if(t.state==='blocked')throw new Error(t.blocker);return s.assignments.find((a:any)=>a.taskId===interrupted.id&&a.role==='reviewer'&&a.status==='running');},a=>!!a&&existsSync(join(root(interrupted.id),'attempts',a.id,'codex/process.json')));
  appendFileSync(join(root(interrupted.id),'workspace/slug.mjs'),'\n// Controlled stale-review probe.\n');
  const held=await waitFor(async()=>{const s=await server.api('/snapshot');return s.tasks.find((t:any)=>t.id===interrupted.id);},t=>t.state==='blocked');assert.equal(held.reviewCycles,0);assert.match(held.blocker,/source changed|candidate changed|stale/i);
  results.stale={status:'passed',taskId:interrupted.id,assignmentId:review.id};console.log('PASS: stale real review verdict rejected without advancing review rounds.');
  await server.api('/tasks/'+interrupted.id+'/resume',{answer:'Stale-review probe complete. Preserve evidence, do not repeat the heartbeat, reverify current source and obtain fresh independent review.'});
  const complete=await waitFor(async()=>{const s=await server.api('/snapshot'),t=s.tasks.find((t:any)=>t.id===interrupted.id);if(t.state==='blocked')throw new Error(t.blocker);return t;},t=>t.state==='complete');
  const state=await server.api('/snapshot');writeFileSync(join(directory,'snapshot.json'),JSON.stringify(state,null,2));results.completion={status:'passed',taskId:complete.id,candidate:complete.candidate};
  for(const id of [technical.id,cancelled.id,complete.id])for(const attemptId of readdirSync(join(root(id),'attempts'))){const path=join(root(id),'attempts',attemptId,'codex/process.json');if(existsSync(path))assert.ok(readJson<any>(path).drained);}
  console.log('PASS: recovered task completed against a fresh verified candidate.');
}catch(error){results.failure=error instanceof Error?error.message:String(error);process.exitCode=1;console.error(results.failure);}
finally{await server.stop();writeFileSync(join(directory,'result.json'),JSON.stringify({status:process.exitCode?'failed':'passed',checkedAt:new Date().toISOString(),results},null,2));console.log('Evidence: '+directory);}
