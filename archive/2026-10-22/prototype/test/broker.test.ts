import assert from 'node:assert/strict';
import { spawn, execFile, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { promisify } from 'node:util';
import test from 'node:test';
import { LaunchBroker } from '../src/broker/launch-broker.ts';
import type { ProcessIdentity } from '../src/broker/contracts.ts';
import { ExecutionLedger } from '../src/ledger/execution-ledger.ts';

const assignment = { jobId: 'broker-1', project: 'fixture', ticket: 'BRK-007', participant: 'builder-a', attempt: 1, baseSha: 'a'.repeat(40) };
const spec = { kind: 'qualification-fixture' as const, fingerprint: 'f'.repeat(64) };
const result = { ...assignment, candidateSha: 'b'.repeat(40), status: 'ready-for-review', requestedNextAction: 'independent-review',
  evidence: [{ path: 'fixture.log', sha256: 'c'.repeat(64) }] };
const fakeIdentity = { pid: 1, startUtc: '2026-10-23T00:00:00.000Z' };
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'barracks-broker-'));
  return { root, path: join(root, 'ledger.db'), cleanup: () => {
    assert.ok(dirname(resolve(root)) === resolve(tmpdir()) && basename(root).startsWith('barracks-broker-'));
    rmSync(root, { recursive: true, force: true });
  } };
}
async function startTime(pid: number): Promise<string> {
  assert.ok(Number.isInteger(pid) && pid > 0);
  const ps = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
  const pending = promisify(execFile)(ps, ['-NoProfile', '-NonInteractive', '-Command',
    `(Get-Process -Id ${pid} -ErrorAction Stop).StartTime.ToUniversalTime().ToString('o')`],
  { windowsHide: true, timeout: 5000, maxBuffer: 4096 });
  pending.child.stdin?.end();
  return (await pending).stdout.trim();
}
async function worker(root: string) {
  const receipt = join(root, 'worker-receipt.json');
  const child = spawn(process.execPath, [resolve('test/fixtures/broker-worker.cjs'), receipt, assignment.jobId],
    { windowsHide: true, stdio: 'ignore' });
  await once(child, 'spawn');
  assert.ok(child.pid);
  const identity = { pid: child.pid, startUtc: await startTime(child.pid) };
  const stop = async () => { if (child.exitCode === null && child.signalCode === null) { const exit = once(child, 'exit'); child.kill(); await exit; } };
  const inspect = async (expected: ProcessIdentity) => {
    try { return await startTime(expected.pid) === expected.startUtc ? 'same-running' as const : 'identity-mismatch' as const; }
    catch { return 'exited' as const; }
  };
  return { child, identity, stop, inspect, receipt };
}
test('concurrent ensures launch one real child and reopen observes the same PID/start identity', { skip: process.platform !== 'win32' }, async () => {
  const state = fixture(); let ledger = new ExecutionLedger(state.path); ledger.assign(assignment);
  let owned: Awaited<ReturnType<typeof worker>> | undefined; let launches = 0;
  const runtime = { launch: async () => {
    launches++; assert.equal(ledger.getLaunch(assignment.jobId)?.state, 'reserved');
    owned = await worker(state.root); return owned.identity;
  }, inspect: async (identity: ProcessIdentity) => { assert.ok(owned); return owned.inspect(identity); } };
  try {
    const broker = new LaunchBroker(ledger, runtime);
    const values = await Promise.all([broker.ensureJob(assignment.jobId, spec), broker.ensureJob(assignment.jobId, spec)]);
    assert.ok(owned);
    assert.equal(launches, 1); assert.equal(values[0].state, 'running');
    assert.deepEqual(values[0].identity, owned.identity);
    assert.equal(ledger.pending().length, 0);
    ledger.close(); ledger = new ExecutionLedger(state.path);
    const reopened = new LaunchBroker(ledger, runtime);
    assert.equal((await reopened.ensureJob(assignment.jobId, spec)).state, 'running');
    assert.equal(launches, 1);
    assert.equal(JSON.parse(await readFile(owned.receipt, 'utf8')).jobId, assignment.jobId);
    await owned.stop();
    assert.equal((await reopened.ensureJob(assignment.jobId, spec)).state, 'reconciliation-required');
    assert.equal(launches, 1);
  } finally { if (owned) await owned.stop(); ledger.close(); state.cleanup(); }
});
test('a real launch with lost receipt is not replayed after reopening the ledger', { skip: process.platform !== 'win32' }, async () => {
  const state = fixture(); let ledger = new ExecutionLedger(state.path); ledger.assign(assignment);
  let launches = 0; let owned: Awaited<ReturnType<typeof worker>> | undefined;
  const runtime = { launch: async () => { launches++; owned = await worker(state.root); throw new Error('injected receipt loss'); },
    inspect: async () => 'unknown' as const };
  try {
    assert.equal((await new LaunchBroker(ledger, runtime).ensureJob(assignment.jobId, spec)).state, 'reconciliation-required');
    ledger.close(); ledger = new ExecutionLedger(state.path);
    assert.equal((await new LaunchBroker(ledger, runtime).ensureJob(assignment.jobId, spec)).state, 'reconciliation-required');
    assert.equal(launches, 1);
    assert.ok(owned); assert.equal(JSON.parse(await readFile(owned.receipt, 'utf8')).jobId, assignment.jobId);
  } finally { if (owned) await owned.stop(); ledger.close(); state.cleanup(); }
});
test('abrupt exit after reservation leaves an uncertain attempt, with no automatic launch', () => {
  const state = fixture();
  try {
    assert.throws(() => execFileSync(process.execPath, ['--experimental-strip-types', resolve('test/fixtures/broker-crash.ts'),
      state.path, JSON.stringify({ assignment, spec })], { windowsHide: true, stdio: 'pipe' }),
    error => (error as { status: number }).status === 23);
    const ledger = new ExecutionLedger(state.path);
    try { assert.equal(ledger.getLaunch(assignment.jobId)?.state, 'reserved'); }
    finally { ledger.close(); }
  } finally { state.cleanup(); }
});
test('a persisted reservation without a receipt refuses replay', async () => {
  const state = fixture(); const ledger = new ExecutionLedger(state.path); ledger.assign(assignment); ledger.reserveLaunch(assignment.jobId, spec);
  let launches = 0;
  try {
    const record = await new LaunchBroker(ledger, { launch: async () => { launches++; return fakeIdentity; }, inspect: async () => 'unknown' })
      .ensureJob(assignment.jobId, spec);
    assert.equal(record.state, 'reconciliation-required'); assert.equal(launches, 0);
  } finally { ledger.close(); state.cleanup(); }
});
test('PID identity mismatch and conflicting launch specs never start replacement work', async () => {
  const state = fixture(); const ledger = new ExecutionLedger(state.path); ledger.assign(assignment);
  ledger.reserveLaunch(assignment.jobId, spec); ledger.recordProcess(assignment.jobId, fakeIdentity);
  let launches = 0;
  try {
    const broker = new LaunchBroker(ledger, { launch: async () => { launches++; return fakeIdentity; }, inspect: async () => 'identity-mismatch' });
    await assert.rejects(broker.ensureJob(assignment.jobId, { ...spec, fingerprint: 'd'.repeat(64) }), /spec differs/);
    assert.equal((await broker.ensureJob(assignment.jobId, spec)).state, 'reconciliation-required');
    assert.equal(launches, 0);
  } finally { ledger.close(); state.cleanup(); }
});
test('pause refuses a new launch, and an early terminal result survives the process receipt', async () => {
  const state = fixture(); const ledger = new ExecutionLedger(state.path); ledger.assign(assignment); ledger.setPaused('fixture', true);
  let launches = 0;
  const broker = new LaunchBroker(ledger, { launch: async () => { launches++; ledger.recordResult(result); return fakeIdentity; }, inspect: async () => 'unknown' });
  try {
    await assert.rejects(broker.ensureJob(assignment.jobId, spec), /paused/); assert.equal(launches, 0);
    ledger.setPaused('fixture', false);
    assert.equal((await broker.ensureJob(assignment.jobId, spec)).state, 'terminal');
    assert.equal((await broker.ensureJob(assignment.jobId, spec)).state, 'terminal');
    assert.equal(launches, 1); assert.deepEqual(ledger.pending().map(event => event.id), ['result:broker-1']);
  } finally { ledger.close(); state.cleanup(); }
});
test('schema-one migration preserves assignment, outbox and paused state', () => {
  const state = fixture(); let ledger = new ExecutionLedger(state.path); ledger.assign(assignment); ledger.setPaused('fixture', true); ledger.close();
  const old = new DatabaseSync(state.path); old.exec('DROP TABLE launches; PRAGMA user_version=1;'); old.close();
  ledger = new ExecutionLedger(state.path);
  try {
    assert.deepEqual(ledger.get(assignment.jobId)?.assignment, assignment); assert.equal(ledger.isPaused('fixture'), true);
    assert.equal(ledger.getLaunch(assignment.jobId), undefined); ledger.setPaused('fixture', false);
    assert.deepEqual(ledger.pending().map(event => event.id), ['launch:broker-1']);
  } finally { ledger.close(); state.cleanup(); }
});
