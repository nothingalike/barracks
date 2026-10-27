import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { discover } from './local-runtime.ts';

const execute = promisify(execFile);
function ps(value: string) { return "'" + value.replaceAll("'", "''") + "'"; }
const digest = (value: string) => createHash('sha256').update(value).digest('hex');

/** Disposable repositories only; never grants a production worker canonical access. */
export async function qualifyWriteIsolation() {
  const command = discover().codex;
  if (!command) throw new Error('Codex not found. Set BARRACKS_CODEX_PATH or BARRACKS_CODEX_ENTRY.');
  const directory = resolve('.barracks/isolation-boundary', randomUUID());
  const canonical = join(directory, 'canonical');
  const worker = join(directory, 'worker');
  await mkdir(canonical, { recursive: true }); await mkdir(worker);
  const git = async (args: string[], input?: string) => {
    const pending = execute('git', ['-c', `safe.directory=${canonical.replaceAll('\\', '/')}`, '-C', canonical, ...args],
      { windowsHide: true, shell: false, timeout: 10000, maxBuffer: 65536 });
    pending.child.stdin?.end(input);
    return (await pending).stdout.trim();
  };
  await git(['init', '--initial-branch=main']);
  const blob = await git(['hash-object', '-w', '--stdin'], 'canonical fixture bytes\n');
  const tree = await git(['mktree'], `100644 blob ${blob}\tprotected.txt\n`);
  // Construct objects in this disposable repository; the application repo stays uncommitted.
  const commit = await git(['hash-object', '-t', 'commit', '-w', '--stdin'],
    `tree ${tree}\nauthor Fixture <fixture@invalid> 0 +0000\ncommitter Fixture <fixture@invalid> 0 +0000\n\nfixture\n`);
  await git(['update-ref', 'refs/heads/main', commit]);
  await git(['read-tree', '--reset', '-u', 'HEAD']);
  await symlink(canonical, join(worker, 'canonical-link'), 'junction');
  const protectedFile = join(canonical, 'protected.txt');
  const protectedRef = join(canonical, '.git/refs/heads/main');
  const baselineFile = await readFile(protectedFile, 'utf8');
  const baselineRef = await readFile(protectedRef, 'utf8');
  const powershell = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
  const script = `
$ErrorActionPreference='Stop'
$checks=@()
function Check-Write([string]$name,[string]$path) {
  try { [IO.File]::WriteAllText($path,'attempted overwrite'); $script:checks+=@{name=$name;written=$true} }
  catch { $script:checks+=@{name=$name;written=$false} }
}
$sentinel=Get-Content -LiteralPath ${ps(join(worker, 'sentinel.txt'))} -Raw
Check-Write 'allowed-workspace' ${ps(join(worker, 'allowed.txt'))}
Check-Write 'canonical-file' ${ps(protectedFile)}
Check-Write 'canonical-ref' ${ps(protectedRef)}
Check-Write 'junction-alias' ${ps(join(worker, 'canonical-link/protected.txt'))}
$ErrorActionPreference='Continue'
& $env:ComSpec /d /c ${ps(`echo attempted overwrite>"${protectedFile}"`)} 2>$null
$checks+=@{name='alternate-shell';written=($LASTEXITCODE -eq 0)}
$ErrorActionPreference='Stop'
@{sentinel=$sentinel.Trim();checks=$checks} | ConvertTo-Json -Depth 5 -Compress
`;
  const marker = randomUUID();
  await writeFile(join(worker, 'sentinel.txt'), marker);
  await writeFile(join(worker, 'probe.ps1'), script);
  const pending = execute(command.executable, [...command.args.slice(0, -1), 'sandbox', '-P', ':workspace',
    '-C', worker, '--', powershell, '-NoProfile', '-NonInteractive', '-File', join(worker, 'probe.ps1')],
  { windowsHide: true, shell: false, timeout: 30000, maxBuffer: 65536 });
  pending.child.stdin?.end();
  let report: Record<string, unknown>;
  try {
    const { stdout, stderr } = await pending;
    await writeFile(join(directory, 'stdout.txt'), stdout);
    await writeFile(join(directory, 'stderr.txt'), stderr);
    const observed = JSON.parse(stdout.trim());
    assert.equal(observed.sentinel, marker, 'Permitted read control must pass.');
    assert.equal(observed.checks.length, 5);
    for (const check of observed.checks) assert.equal(check.written, check.name === 'allowed-workspace', check.name);
    assert.equal(await readFile(protectedFile, 'utf8'), baselineFile, 'Canonical file bytes changed.');
    assert.equal(await readFile(protectedRef, 'utf8'), baselineRef, 'Canonical main ref changed.');
    assert.equal(await git(['rev-parse', 'main']), commit);
    report = { status: 'passed', checks: observed.checks, canonicalFileSha256: digest(baselineFile),
      canonicalRefSha256: digest(baselineRef), protectedMain: commit };
  } catch (error) {
    const failure = error as Error & { stdout?: string; stderr?: string };
    if (failure.stdout !== undefined) await writeFile(join(directory, 'stdout.txt'), failure.stdout);
    if (failure.stderr !== undefined) await writeFile(join(directory, 'stderr.txt'), failure.stderr);
    report = { status: 'failed', reason: failure.message.split('\n')[0],
      canonicalFilePreserved: (await readFile(protectedFile, 'utf8')) === baselineFile,
      canonicalRefPreserved: (await readFile(protectedRef, 'utf8')) === baselineRef };
  }
  Object.assign(report, { checkedAt: new Date().toISOString(), liveDispatch: false, evidence: directory,
    command, limits: ['Specific installed runtime and direct/child-shell/junction fixture cases only',
      'No authenticated tool-bearing provider worker or cross-provider launcher qualification',
      'No comprehensive escape-resistance or live canonical repository proof'] });
  await writeFile(join(directory, 'result.json'), JSON.stringify(report, null, 2) + '\n');
  return report;
}
