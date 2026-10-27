import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { promisify } from 'node:util';
import { discover } from './qualification/local-runtime.ts';
import { assertProtocolContinuation, protocolSchema, readProtocolResult } from './qualification/protocol.ts';

// Opt-in protocol experiment. The bounded child call is not the production broker.
const provider = process.argv[2];
if (provider !== 'codex' && provider !== 'claude') throw new Error('Choose codex or claude.');
const command = discover()[provider];
if (!command) throw new Error(`No installed ${provider} entry point found.`);
const state = resolve('.barracks', 'protocol', `${provider}-${randomUUID()}`);
await mkdir(state, { recursive: true });
const fixture = await mkdtemp(join(tmpdir(), 'barracks-protocol-'));
const schemaPath = join(fixture, 'schema.json');
await writeFile(schemaPath, JSON.stringify(protocolSchema));
const marker = randomUUID();
const schema = JSON.stringify(protocolSchema);
const run = promisify(execFile);
const initialPrompt = `This is a protocol-only qualification. Use no tools or skills. Remember marker ${marker}. Return marker and phase initial as JSON.`;
const resumePrompt = 'Use no tools or skills. Return the marker from the preceding request and phase resumed as JSON.';
const common = provider === 'codex'
  ? ['--ignore-user-config', '-c', 'sandbox_mode="read-only"', '-c', 'approval_policy="never"',
    '--skip-git-repo-check', '--json', '--output-schema', schemaPath]
  : ['--safe-mode', '--strict-mcp-config', '--tools', '', '--permission-mode', 'dontAsk',
    '--permission-prompts', 'none', '--output-format', 'json', '--json-schema', schema, '--max-budget-usd', '0.50'];
async function invoke(phase: string, sessionId?: string) {
  const args = provider === 'codex'
    ? [...command!.args.slice(0, -1), 'exec', ...(sessionId ? ['resume', sessionId] : []),
      ...common, sessionId ? resumePrompt : initialPrompt]
    : [...(sessionId ? ['--resume', sessionId] : []), ...common, '-p', sessionId ? resumePrompt : initialPrompt];
  let stdout: string;
  try {
    const pending = run(command!.executable, args, {
      cwd: fixture, windowsHide: true, shell: false, timeout: 60000, maxBuffer: 1024 * 1024,
    });
    pending.child.stdin?.end();
    ({ stdout } = await pending);
  } catch (error) {
    const failure = error as Error & { stdout?: string; stderr?: string; code?: string | number; killed?: boolean };
    await writeFile(join(state, `${phase}.stdout`), failure.stdout ?? '');
    await writeFile(join(state, `${phase}.stderr`), failure.stderr ?? '');
    Object.assign(report, { failedPhase: phase, exitCode: failure.code ?? null, killed: failure.killed ?? false });
    throw error;
  }
  await writeFile(join(state, `${phase}.stdout`), stdout);
  return readProtocolResult(provider as 'codex' | 'claude', stdout);
}
const report: Record<string, unknown> = { provider, checkedAt: new Date().toISOString(), fixture,
  liveDispatch: false, timeoutPerCallMs: 60000, maxOutputBytes: 1048576,
  limits: ['No filesystem isolation proof', 'No process-tree cancellation proof',
    'No production role/model qualification', 'Codex dollar budget is not enforced',
    'Fixture retained for inspection; subscription authentication remains CLI-owned'] };
try {
  const initial = await invoke('initial');
  const resumed = await invoke('resumed', initial.sessionId);
  assertProtocolContinuation(initial, resumed, marker);
  Object.assign(report, { status: 'passed', sessionId: initial.sessionId, marker });
} catch (error) {
  // Provider diagnostics may contain account details. Keep the public failure generic.
  Object.assign(report, { status: 'failed', reason: 'Worker call or protocol assertion failed.',
    errorType: error instanceof Error ? error.name : 'UnknownError' });
  process.exitCode = 1;
} finally {
  await writeFile(join(state, 'result.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ ...report, evidence: state }, null, 2));
}
