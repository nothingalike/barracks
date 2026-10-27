import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { ExecutionLedger } from '../src/ledger/execution-ledger.ts';

const assignment = { jobId: 'job-1', project: 'fixture', ticket: 'BRK-006', participant: 'builder-a', attempt: 1, baseSha: 'a'.repeat(40) };
const result = { ...assignment, candidateSha: 'b'.repeat(40), status: 'ready-for-review', requestedNextAction: 'independent-review',
  evidence: [{ path: 'evidence.json', sha256: 'c'.repeat(64) }] };
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'barracks-ledger-'));
  const path = join(root, 'ledger.db');
  return { path, cleanup: () => {
    assert.ok(isAbsolute(root) && dirname(resolve(root)) === resolve(tmpdir()) && basename(root).startsWith('barracks-ledger-'));
    rmSync(root, { recursive: true, force: true });
  } };
}
test('duplicate jobs/results preserve exactly one obligation of each kind', () => {
  const state = fixture(); const ledger = new ExecutionLedger(state.path);
  try {
    assert.equal(ledger.assign(assignment), 'created');
    assert.equal(ledger.assign({ ...assignment }), 'duplicate');
    assert.throws(() => ledger.assign({ ...assignment, baseSha: 'd'.repeat(40) }), /different assignment/);
    assert.equal(ledger.recordResult(result), 'recorded');
    assert.equal(ledger.recordResult(result), 'duplicate');
    assert.throws(() => ledger.recordResult({ ...result, candidateSha: 'd'.repeat(40) }), /different result/);
    assert.deepEqual(ledger.pending().map(event => event.id), ['result:job-1']);
    ledger.acknowledge('launch:job-1'); ledger.acknowledge('launch:job-1');
    assert.deepEqual(ledger.pending().map(event => event.id), ['result:job-1']);
  } finally { ledger.close(); state.cleanup(); }
});
test('capacity, source identity and monotonic attempts reject conflicting work', () => {
  const state = fixture(); const ledger = new ExecutionLedger(state.path);
  try {
    ledger.assign(assignment);
    assert.throws(() => ledger.assign({ ...assignment, jobId: 'job-2', ticket: 'BRK-007' }), /active job/);
    assert.throws(() => ledger.assign({ ...assignment, jobId: 'job-2', participant: 'builder-b', attempt: 2 }), /active job/);
    assert.throws(() => ledger.assign({ ...assignment, jobId: 'job-2', participant: 'invented' }));
    assert.throws(() => ledger.recordResult({ ...result, baseSha: 'd'.repeat(40) }), /baseSha/);
    assert.equal(ledger.get('job-1')?.result, null);
    ledger.recordResult(result);
    assert.throws(() => ledger.assign({ ...assignment, jobId: 'job-2' }), /attempt must exceed/);
    ledger.assign({ ...assignment, jobId: 'job-2', attempt: 2 });
    assert.equal(ledger.recordResult(result), 'duplicate');
    assert.equal(ledger.get('job-2')?.result, null);
  } finally { ledger.close(); state.cleanup(); }
});
test('pause blocks new assignments and hides launch obligations while accepting results', () => {
  const state = fixture(); let ledger = new ExecutionLedger(state.path);
  try {
    ledger.assign(assignment); ledger.setPaused('fixture', true);
    assert.deepEqual(ledger.pending(), []);
    assert.throws(() => ledger.assign({ ...assignment, jobId: 'job-2', ticket: 'BRK-007', participant: 'builder-b' }), /paused/);
    ledger.recordResult(result);
    assert.deepEqual(ledger.pending().map(event => event.kind), ['result-recorded']);
    ledger.close(); ledger = new ExecutionLedger(state.path);
    assert.equal(ledger.isPaused('fixture'), true);
    ledger.setPaused('fixture', false);
    assert.equal(ledger.pending().length, 1);
  } finally { ledger.close(); state.cleanup(); }
});
test('a failed outbox insert rolls back the associated terminal result', () => {
  const state = fixture(); let ledger = new ExecutionLedger(state.path);
  ledger.assign(assignment); ledger.close();
  const fault = new DatabaseSync(state.path);
  fault.exec(`CREATE TRIGGER fail_result_event BEFORE INSERT ON outbox WHEN NEW.kind='result-recorded'
    BEGIN SELECT RAISE(ABORT, 'injected outbox failure'); END;`);
  fault.close(); ledger = new ExecutionLedger(state.path);
  try {
    assert.throws(() => ledger.recordResult(result), /injected outbox failure/);
    assert.equal(ledger.get('job-1')?.result, null);
    assert.deepEqual(ledger.pending().map(event => event.id), ['launch:job-1']);
  } finally { ledger.close(); state.cleanup(); }
});
test('a failed launch-obligation insert rolls back assignment intent', () => {
  const state = fixture(); let ledger = new ExecutionLedger(state.path); ledger.close();
  const fault = new DatabaseSync(state.path);
  fault.exec(`CREATE TRIGGER fail_launch_event BEFORE INSERT ON outbox WHEN NEW.kind='launch-requested'
    BEGIN SELECT RAISE(ABORT, 'injected launch failure'); END;`);
  fault.close(); ledger = new ExecutionLedger(state.path);
  try {
    assert.throws(() => ledger.assign(assignment), /injected launch failure/);
    assert.equal(ledger.get('job-1'), undefined);
    assert.deepEqual(ledger.pending(), []);
  } finally { ledger.close(); state.cleanup(); }
});
test('abrupt process exit leaves committed result and lost notification pending once', () => {
  const state = fixture();
  try {
    assert.throws(() => execFileSync(process.execPath, ['--experimental-strip-types',
      resolve('test/fixtures/ledger-crash.ts'), state.path, JSON.stringify({ assignment, result })],
    { windowsHide: true, stdio: 'pipe' }), error => (error as { status: number }).status === 23);
    const ledger = new ExecutionLedger(state.path);
    try {
      assert.deepEqual(ledger.get('job-1')?.result, result);
      assert.equal(ledger.recordResult(result), 'duplicate');
      assert.equal(ledger.pending().filter(event => event.kind === 'result-recorded').length, 1);
      assert.equal(ledger.pending().filter(event => event.kind === 'launch-requested').length, 0);
    } finally { ledger.close(); }
  } finally { state.cleanup(); }
});
test('the live SQLite owner excludes a second connection, and close releases ownership', () => {
  const state = fixture(); const ledger = new ExecutionLedger(state.path);
  try { assert.throws(() => new ExecutionLedger(state.path), /locked/); }
  finally { ledger.close(); }
  const replacement = new ExecutionLedger(state.path); replacement.close(); state.cleanup();
});
