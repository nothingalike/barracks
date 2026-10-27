import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const powershell = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');

export function quoteWindowsArgument(value: string) {
  if (value.includes('\0')) throw new Error('Process arguments cannot contain NUL.');
  return '"' + value.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, '$1$1') + '"';
}
async function waitFor<T>(read: () => Promise<T | undefined>, description: string, timeoutMs = 10000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await read();
    if (result !== undefined) return result;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for ${description}.`);
}
async function json(path: string) {
  try { return JSON.parse((await readFile(path, 'utf8')).replace(/^\uFEFF/, '')); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}
function alive(pid: number) {
  try { process.kill(pid, 0); return true; } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false;
    throw error;
  }
}

/** Real Windows lifetime experiment; this does not grant filesystem isolation. */
export async function qualifyWindowsProcesses(scenarioNames: string[] = ['cancel', 'host-exit']) {
  if (process.platform !== 'win32') throw new Error('Windows Job Object qualification requires Windows.');
  if (scenarioNames.some(name => !['cancel', 'host-exit', 'coordinator-exit'].includes(name))) {
    throw new Error('Choose cancel, host-exit or coordinator-exit.');
  }
  const state = resolve('.barracks/process', randomUUID());
  await mkdir(state, { recursive: true });
  const sentinel = spawn(process.execPath, ['-e', 'setInterval(() => {},1000)'], { windowsHide: true, stdio: 'ignore' });
  assert.ok(sentinel.pid);
  const scenarios: unknown[] = [];
  try {
    for (const scenario of scenarioNames) {
      const directory = join(state, scenario);
      await mkdir(directory);
      const jobId = randomUUID();
      const receiptPath = join(directory, 'receipt.json');
      const manifestPath = join(directory, 'manifest.json');
      const cancelFile = join(directory, 'cancel');
      const fixture = resolve('test/fixtures/process-tree.cjs');
      const host = resolve('src/windows/qualification-host.ps1');
      const commandLine = [process.execPath, fixture, directory, jobId, '0'].map(quoteWindowsArgument).join(' ');
      await writeFile(manifestPath, JSON.stringify({ jobId, executable: process.execPath,
        commandLine, cwd: directory, receipt: receiptPath, cancelFile, maxRuntimeMs: 15000 }));
      await writeFile(join(directory, 'dirty.patch'), 'preserve tracked delta\n');
      await writeFile(join(directory, 'untracked.txt'), 'preserve untracked bytes\n');
      const child = scenario === 'coordinator-exit'
        ? spawn(process.execPath, [resolve('test/fixtures/job-coordinator.cjs'), powershell, host,
          manifestPath, join(directory, 'coordinator.json')], { windowsHide: true, stdio: 'ignore' })
        : spawn(powershell, ['-NoProfile', '-NonInteractive', '-File', host, '-Manifest', manifestPath],
          { windowsHide: true, stdio: 'ignore' });
      const exit = new Promise<number | null>((resolve, reject) => {
        child.once('error', reject); child.once('exit', resolve);
      });
      try {
        const receipt = await waitFor(() => json(receiptPath), `${scenario} receipt`);
        assert.equal(receipt.jobId, jobId);
        assert.equal(receipt.status, 'running');
        const members = await waitFor(async () => {
          const values = await Promise.all([0, 1, 2].map(level => json(join(directory, `member-${level}.json`))));
          return values.every(Boolean) ? values : undefined;
        }, 'three-generation tree');
        for (const member of members) { assert.equal(member.jobId, jobId); assert.equal(alive(member.pid), true); }
        const heartBefore = await readFile(join(directory, 'heartbeat-2'), 'utf8');
        await waitFor(async () => (await readFile(join(directory, 'heartbeat-2'), 'utf8')) !== heartBefore ? true : undefined,
          'grandchild heartbeat');
        if (scenario === 'coordinator-exit') {
          assert.equal(await exit, 23);
          const coordinator = await json(join(directory, 'coordinator.json'));
          assert.equal(coordinator.brokerPid, receipt.hostPid);
          assert.equal(alive(receipt.hostPid), true);
          const afterExit = await readFile(join(directory, 'heartbeat-2'), 'utf8');
          await waitFor(async () => (await readFile(join(directory, 'heartbeat-2'), 'utf8')) !== afterExit ? true : undefined,
            'grandchild progress after coordinator exit', 1500);
          // Reconcile the existing receipt. No replacement worker is launched.
          assert.equal((await json(receiptPath)).rootPid, receipt.rootPid);
        }
        if (scenario === 'host-exit') child.kill();
        else await writeFile(cancelFile, jobId);
        await waitFor(async () => members.every(member => !alive(member.pid)) ? true : undefined,
          'all owned descendants to exit');
        if (scenario !== 'host-exit') {
          const terminal = await waitFor(async () => {
            const current = await json(receiptPath);
            return current?.status === 'cancelled' ? current : undefined;
          }, 'empty Job Object receipt');
          assert.equal(terminal.remainingMembers.length, 0);
          for (const member of members) assert.ok(terminal.membersBeforeCancel.includes(member.pid));
          assert.ok(terminal.membersBeforeCancel.every((pid: number) => !alive(pid)));
        }
        if (scenario !== 'coordinator-exit') await exit;
        assert.equal(alive(sentinel.pid), true);
        assert.equal(await readFile(join(directory, 'dirty.patch'), 'utf8'), 'preserve tracked delta\n');
        assert.equal(await readFile(join(directory, 'untracked.txt'), 'utf8'), 'preserve untracked bytes\n');
        scenarios.push({ scenario, jobId, hostPid: receipt.hostPid, hostStartUtc: receipt.hostStartUtc,
          rootPid: receipt.rootPid, rootStartUtc: receipt.rootStartUtc, memberPids: members.map(member => member.pid),
          allMembersExited: true, unrelatedSentinelSurvived: true, sourceBytesPreserved: true });
      } finally {
        // Only this fixture's host receives cancellation; its deadline also bounds failed experiments.
        await writeFile(cancelFile, jobId);
        if (scenario !== 'coordinator-exit' && child.exitCode === null) child.kill();
      }
    }
    const report = { checkedAt: new Date().toISOString(), status: 'passed', liveDispatch: false,
      mechanism: 'Windows Job Object, suspended creation, assign before resume, kill on last handle close',
      scenarios, limits: ['Qualification fixture only; production CLI compatibility untested',
        'No filesystem isolation or arbitrary external process-launch fencing',
        'Coordinator-exit recovery remains unqualified; separate startup experiments failed',
        'Receipt reconciliation is a fixture experiment, not the production durable broker'], evidence: state };
    await writeFile(join(state, 'result.json'), JSON.stringify(report, null, 2) + '\n');
    return report;
  } catch (error) {
    await writeFile(join(state, 'result.json'), JSON.stringify({ checkedAt: new Date().toISOString(),
      status: 'failed', liveDispatch: false, scenarios, reason: error instanceof Error ? error.message : String(error) }, null, 2));
    throw error;
  } finally { sentinel.kill(); }
}
