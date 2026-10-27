import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { configSchema, type Task, type WorkflowConfig } from '../shared/workflow.ts';
import { Store } from '../server/store.ts';
import { Runner, SimulatedWorker } from '../server/runner.ts';
import {StoppedError} from '../server/process.ts';

const config = configSchema.parse(JSON.parse(readFileSync(new URL('../config/workflow.json', import.meta.url), 'utf8')));
// Capacity fixtures exercise a single slot independently of the installed worker-pool configuration.
config.parallelism={...config.parallelism,implementing:1,refining:1,reviewing:1};
const input = { title: 'Fixture task', description: '', specificationReady: true, requestChangesOnce: true };
const sha = 'a'.repeat(40), nextSha = 'b'.repeat(40);
test('omitted state capacities default to one and overrides stay independent', () => {
  const parsed = configSchema.parse({...config, parallelism:{implementing:3}});
  assert.equal(parsed.parallelism.implementing,3);
  assert.equal(parsed.parallelism.reviewing,1);
  assert.equal(parsed.parallelism.queued,1);
  assert.throws(() => configSchema.parse({...config, parallelism:{reviewing:0}}));
});
function ready(store: Store, options = {}) {
  const task = store.create({ ...input, ...options });
  const assignment = store.claim(task.id, config)!;
  store.finish(assignment.id, { kind: 'triaged', specificationReady: true }, config);
  return store.task(task.id);
}
function built(store: Store) {
  const task = ready(store);
  const build = store.claim(task.id, config)!;
  store.finish(build.id, { kind:'built', candidate:sha, verified:true }, config);
  return store.task(task.id);
}

test('Lead routes incomplete scope through BA; review rejection returns work to Builder and stale review cannot complete it', () => {
  const store = new Store(':memory:');
  try {
    const task = store.create({ ...input, specificationReady:false });
    let job = store.claim(task.id, config)!;
    assert.equal(job.role, 'lead');
    store.finish(job.id, {kind:'triaged', specificationReady:false}, config);
    job = store.claim(task.id, config)!;
    assert.equal(job.role, 'ba');
    store.finish(job.id, {kind:'refined'}, config);
    job = store.claim(task.id, config)!;
    assert.equal(job.role, 'builder');
    store.finish(job.id, {kind:'built', candidate:sha, verified:true}, config);
    job = store.claim(task.id, config)!;
    assert.equal(job.role, 'reviewer');
    assert.notEqual(job.worker, store.task(task.id).author);
    const count = store.history(task.id).length;
    assert.throws(() => store.finish(job.id, {kind:'reviewed', candidate:nextSha, approved:true, notes:'Wrong source'}, config), /candidate/);
    assert.equal(store.history(task.id).length, count);
    assert.equal(store.task(task.id).state, 'reviewing');
    store.finish(job.id, {kind:'reviewed', candidate:sha, approved:false, notes:'Needs fix'}, config);
    assert.equal(store.task(task.id).state, 'implementing');
    assert.equal(store.task(task.id).verified, false);
    assert.equal(store.finish(job.id, {kind:'reviewed', candidate:sha, approved:true, notes:'Late duplicate'}, config), false);
    job = store.claim(task.id, config)!;
    store.finish(job.id, {kind:'built', candidate:nextSha, verified:true}, config);
    job = store.claim(task.id, config)!;
    store.finish(job.id, {kind:'reviewed', candidate:nextSha, approved:true, notes:'Exact revised candidate passed'}, config);
    assert.equal(store.task(task.id).state, 'complete');
    assert.equal(store.task(task.id).reviewCycles, 2);
  } finally { store.close(); }
});

test('configured state capacity is atomic, independent across roles, and pause preserves running work', () => {
  const store = new Store(':memory:');
  try {
    const one = ready(store), two = ready(store), three = ready(store);
    const first = store.claim(one.id, config)!;
    assert.equal(store.claim(one.id, config), null);
    assert.equal(store.claim(two.id, config), null);
    const wider: WorkflowConfig = { ...config, parallelism: { ...config.parallelism, implementing:2 } };
    const second = store.claim(two.id, wider)!;
    assert.equal(second.role, 'builder');
    assert.equal(store.claim(three.id, wider), null);
    store.pause(true);
    store.finish(first.id, {kind:'built', candidate:sha, verified:true}, wider);
    assert.equal(store.claim(one.id, wider), null);
    assert.equal(store.assignments().find(job => job.id === second.id)?.status, 'running');
    store.pause(false);
    assert.equal(store.claim(one.id, wider)?.role, 'reviewer');
    assert.equal(store.claim(three.id, wider)?.role, 'builder');
  } finally { store.close(); }
});

test('failed verification and configured review budget block further dispatch until intervention', () => {
  const store = new Store(':memory:');
  try {
    const task = ready(store);
    const job = store.claim(task.id, config)!;
    store.finish(job.id, {kind:'built', candidate:sha, verified:false}, config);
    assert.equal(store.task(task.id).state, 'blocked');
    assert.equal(store.claim(task.id, config), null);
    assert.throws(() => store.resume(task.id, ''), /answer/);
    store.resume(task.id, 'Corrected verification environment.');
    assert.equal(store.task(task.id).state, 'implementing');
    const build = store.claim(task.id, config)!;
    store.finish(build.id, {kind:'built', candidate:sha, verified:true}, config);
    const review = store.claim(task.id, config)!;
    store.finish(review.id, {kind:'reviewed', candidate:sha, approved:false, notes:'Needs fix'}, {...config,maxReviewCycles:1});
    assert.match(store.task(task.id).blocker!, /budget exhausted/);
  } finally { store.close(); }
});

test('cancel retires the active assignment and ignores its late successful result', () => {
  const store = new Store(':memory:');
  try {
    const task = ready(store), job = store.claim(task.id, config)!;
    store.cancel(task.id);
    assert.equal(store.finish(job.id, {kind:'built', candidate:sha, verified:true}, config), false);
    assert.equal(store.task(task.id).state, 'cancelled');
    assert.equal(store.claim(task.id, config), null);
    assert.throws(() => store.resume(task.id, 'Try again'), /no resumable/);
  } finally { store.close(); }
});

test('reopen preserves pause/history and holds interrupted assignments; a second coordinator cannot open the same store', () => {
  const directory = mkdtempSync(join(tmpdir(), 'barracks-state-'));
  const file = join(directory, 'state.db');
  let store: Store | null = new Store(file);
  try {
    const task = ready(store), job = store.claim(task.id, config)!;
    store.pause(true);
    assert.throws(() => new Store(file), /locked/);
    store.close(); store = new Store(file);
    assert.equal(store.paused, true);
    assert.equal(store.recover(), 1);
    assert.equal(store.recover(), 0);
    assert.equal(store.task(task.id).state, 'blocked');
    assert.equal(store.assignments().find(item => item.id === job.id)?.status, 'interrupted');
    store.pause(false);
    assert.equal(store.claim(task.id, config), null);
    store.resume(task.id, 'Simulation has no live process or external effects; safe to retry.');
    assert.notEqual(store.claim(task.id, config)?.id, job.id);
    assert.ok(store.history(task.id).some(item => item.message.includes('no replacement')));
  } finally { store?.close(); rmSync(directory, {recursive:true,force:true}); }
});

test('real runner completes the simulated BA/build/review/fix cycle automatically', async () => {
  const store = new Store(':memory:');
  const fast = {...config, simulationDelayMs:10};
  const runner = new Runner(store, fast, new SimulatedWorker(10));
  try {
    const task = store.create({...input,specificationReady:false});
    runner.start();
    const deadline = Date.now() + 5000;
    while (store.task(task.id).state !== 'complete' && Date.now() < deadline) { runner.tick(); await delay(15); }
    assert.equal(store.task(task.id).state, 'complete');
    assert.equal(store.task(task.id).reviewCycles, 2);
    const jobs = store.assignments();
    assert.equal(jobs.filter(item => item.role === 'builder').length, 2);
    assert.equal(jobs.filter(item => item.role === 'reviewer').length, 2);
    assert.equal(jobs.filter(item => item.role === 'ba').length, 1);
    assert.equal(jobs.every(item => item.status === 'finished'), true);
  } finally { runner.stop(); await delay(5); store.close(); }
});

test('real cancellation keeps capacity until cleanup completes and interrupted jobs require reconciliation',async()=>{
  const store=new Store(':memory:');
  const first=ready(store,{execution:'codex'}),second=ready(store,{execution:'codex'});
  const worker={run:async(_job:unknown,_task:unknown,signal:AbortSignal):Promise<never>=>new Promise((_accept,reject)=>{signal.addEventListener('abort',()=>setTimeout(()=>reject(new StoppedError('drained')),150),{once:true});}),reconcile:async()=>({})};
  const runner=new Runner(store,config,worker);
  try{
    runner.tick();const cancelling=runner.cancel(first.id);
    assert.equal(store.task(first.id).cancelRequested,true);
    runner.tick();assert.equal(store.assignments().filter(job=>job.taskId===second.id).length,1); // Lead triage only.
    assert.equal(store.assignments().filter(job=>job.role==='builder'&&job.status==='running').length,1);
    await cancelling;assert.equal(store.task(first.id).state,'cancelled');
    runner.tick();assert.equal(store.task(second.id).state,'implementing');
    runner.stop();await runner.drained();store.recover();
    assert.throws(()=>store.resume(second.id,'retry without checking'),/reconciliation/);
    await runner.resume(second.id,'Owner cleanup confirmed.');assert.equal(store.task(second.id).state,'implementing');
  }finally{runner.stop();await runner.drained();store.close();}
});

test('routine technical blockers go to Lead within a configured budget while product/recovery blockers stay held',()=>{
  const store=new Store(':memory:');try{
    const task=ready(store);let job=store.claim(task.id,config)!;
    store.finish(job.id,{kind:'blocked',reason:'Need a verified Node executable path.',blockerKind:'technical'},config);
    job=store.claim(task.id,config)!;assert.equal(job.role,'lead');assert.equal(job.stage,'blocked');
    store.finish(job.id,{kind:'resolved',resolution:'Use the supplied absolute Node path rather than PATH.'},config);
    assert.equal(store.task(task.id).state,'implementing');assert.match(store.task(task.id).resolution!,/absolute Node/);
    job=store.claim(task.id,config)!;store.finish(job.id,{kind:'blocked',reason:'Still unavailable.',blockerKind:'technical'},config);
    assert.equal(store.claim(task.id,config),null,'Configured Lead resolution budget must prevent endless retries.');
    store.resume(task.id,'Operator provided a path.');job=store.claim(task.id,config)!;
    store.finish(job.id,{kind:'blocked',reason:'Product decision needed.',blockerKind:'product'},config);
    assert.equal(store.claim(task.id,config),null);
  }finally{store.close();}
});
