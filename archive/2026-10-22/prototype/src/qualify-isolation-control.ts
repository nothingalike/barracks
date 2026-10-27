import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { discover } from './qualification/local-runtime.ts';

// A boundary test is meaningful only after the sandbox can execute a permitted read.
const command = discover().codex;
if (!command) throw new Error('Codex entry point not found. Set BARRACKS_CODEX_ENTRY to the installed codex.js.');
const directory = resolve('.barracks/isolation', randomUUID());
await mkdir(directory, { recursive: true });
const marker = randomUUID();
await writeFile(join(directory, 'sentinel.txt'), marker);
const report = { checkedAt: new Date().toISOString(), liveDispatch: false,
  status: 'blocked', positiveReadControl: false, writeIsolation: 'unqualified',
  evidence: directory, reason: '', nextAction: 'Repair the installed Windows sandbox, then rerun npm run qualify:isolation-control.' };
try {
  const pending = promisify(execFile)(command.executable, [...command.args.slice(0, -1),
    'sandbox', '-P', ':read-only', '-C', directory, '--',
    join(process.env.SystemRoot ?? 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe'),
    '-NoProfile', '-NonInteractive', '-Command', 'Get-Content -LiteralPath sentinel.txt'],
  { windowsHide: true, shell: false, timeout: 30000, maxBuffer: 65536 });
  pending.child.stdin?.end();
  const { stdout, stderr } = await pending;
  await writeFile(join(directory, 'stdout.txt'), stdout);
  await writeFile(join(directory, 'stderr.txt'), stderr);
  report.positiveReadControl = stdout.trim() === marker;
  report.status = report.positiveReadControl ? 'partial' : 'blocked';
  report.reason = report.positiveReadControl ? 'Positive read passed; write-boundary experiments are still required.' : 'Read output did not match sentinel.';
} catch (error) {
  const failure = error as Error & { stdout?: string; stderr?: string };
  await writeFile(join(directory, 'stdout.txt'), failure.stdout ?? '');
  await writeFile(join(directory, 'stderr.txt'), failure.stderr ?? '');
  report.reason = /setup refresh had errors/.test(failure.stderr ?? '')
    ? 'Windows sandbox setup failed before the positive read control.' : 'Sandbox positive read did not complete successfully.';
}
await writeFile(join(directory, 'result.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
if (!report.positiveReadControl) process.exitCode = 2;
