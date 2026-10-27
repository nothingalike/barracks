import assert from 'node:assert/strict';
import test from 'node:test';
import { qualificationProject, workerResult } from '../src/contracts/team.ts';
import { probe } from '../src/qualification/local-runtime.ts';

const result = {
  jobId: 'job-1', project: 'saltwake', ticket: 'SW-112', participant: 'builder-b',
  attempt: 1, baseSha: 'a'.repeat(40), candidateSha: 'b'.repeat(40),
  status: 'ready-for-review', requestedNextAction: 'independent-review',
  evidence: [{ path: 'handoff.md', sha256: 'c'.repeat(64) }],
};
test('a review handoff includes exact source and evidence', () => {
  assert.equal(workerResult.parse(result).candidateSha, 'b'.repeat(40));
  assert.equal(workerResult.safeParse({ ...result, evidence: [] }).success, false);
  assert.equal(workerResult.safeParse({ ...result, candidateSha: 'latest' }).success, false);
});
test('blocked and failed work request the corresponding next action', () => {
  assert.equal(workerResult.safeParse({ ...result, status: 'blocked' }).success, false);
  assert.equal(workerResult.safeParse({ ...result, status: 'blocked', blocker: 'Needs interface', requestedNextAction: 'unblock' }).success, true);
  assert.equal(workerResult.safeParse({ ...result, status: 'failed', requestedNextAction: 'repair' }).success, true);
});
test('qualification cannot activate dispatch or duplicate participants', () => {
  const project = {
    id: 'other-project', repository: 'isolated-path', integrationBranch: 'develop',
    protectedBranches: ['main'], participants: ['lead', 'ba', 'builder-a', 'builder-b'], liveDispatch: false,
  };
  assert.equal(qualificationProject.safeParse(project).success, true);
  assert.equal(qualificationProject.safeParse({ ...project, liveDispatch: true }).success, false);
  assert.equal(qualificationProject.safeParse({ ...project, participants: ['lead', 'ba', 'builder-a', 'builder-a'] }).success, false);
  assert.equal(qualificationProject.safeParse({ ...project, integrationBranch: 'main' }).success, false);
});
test('version probe runs a real child process', async () => {
  const result = await probe({ executable: process.execPath, args: ['--version'] });
  assert.equal(result.status, 'passed');
  assert.match(result.output, /^v\d+/);
});
test('failed process and missing executable are not reported as ready', async () => {
  const failed = await probe({ executable: process.execPath, args: ['-e', 'process.exit(7)'] });
  assert.equal(failed.status, 'failed');
  assert.equal(failed.exitCode, 7);
  const missing = await probe({ executable: 'barracks-missing-executable', args: [] });
  assert.equal(missing.status, 'failed');
});
test('bounded probe terminates its own hung child', async () => {
  const result = await probe({ executable: process.execPath, args: ['-e', 'setInterval(() => {}, 1000)'] }, 150);
  assert.equal(result.status, 'timeout');
});
test('unbounded child output is rejected', async () => {
  const result = await probe({ executable: process.execPath, args: ['-e', 'process.stdout.write("x".repeat(20000))'] });
  assert.equal(result.status, 'output-limit');
});