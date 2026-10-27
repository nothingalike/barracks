import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export interface ProbeCommand { executable: string; args: string[] }
export interface ProbeResult {
  status: 'passed' | 'failed' | 'timeout' | 'output-limit';
  exitCode: number | null;
  output: string;
}

/** Bounded read-only command probe. This is not a general worker/process broker. */
export function probe(command: ProbeCommand, timeoutMs = 5000): Promise<ProbeResult> {
  return new Promise((resolve) => {
    let settled = false;
    let output = '';
    const child = spawn(command.executable, command.args, {
      shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    });
    const finish = (status: ProbeResult['status'], exitCode: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ status, exitCode, output });
    };
    const timer = setTimeout(() => {
      child.kill();
      finish('timeout', null);
    }, timeoutMs);
    const collect = (chunk: Buffer) => {
      if (settled) return;
      output += chunk.toString('utf8');
      if (Buffer.byteLength(output) > 16384) {
        output = output.slice(0, 4096);
        child.kill();
        finish('output-limit', null);
      }
    };
    child.stdout?.on('data', collect);
    child.stderr?.on('data', collect);
    child.once('error', (error) => { output = error.message; finish('failed', null); });
    child.once('close', (code) => finish(code === 0 ? 'passed' : 'failed', code));
  });
}

export function discover(): Record<string, ProbeCommand | null> {
  const codexExecutable = process.env.BARRACKS_CODEX_PATH;
  const codexJs = process.env.BARRACKS_CODEX_ENTRY ??
    join(dirname(process.execPath), 'node_modules', '@openai', 'codex', 'bin', 'codex.js');
  const claude = process.env.BARRACKS_CLAUDE_PATH ?? join(homedir(), '.local', 'bin', 'claude.exe');
  return {
    node: { executable: process.execPath, args: ['--version'] },
    codex: codexExecutable
      ? (existsSync(codexExecutable) ? { executable: codexExecutable, args: ['--version'] } : null)
      : (existsSync(codexJs) ? { executable: process.execPath, args: [codexJs, '--version'] } : null),
    claude: existsSync(claude) ? { executable: claude, args: ['--version'] } : null,
  };
}

export async function inspectLocalRuntime() {
  const entries = await Promise.all(Object.entries(discover()).map(async ([name, command]) => [
    name, command ? { command, ...await probe(command) } : { status: 'not-found' },
  ]));
  return {
    checkedAt: new Date().toISOString(),
    platform: process.platform,
    node: process.version,
    tools: Object.fromEntries(entries),
    liveDispatch: false as const,
    readiness: 'partial' as const,
    unqualified: [
      'Authenticated structured worker execution and continuation',
      'Worker write isolation and canonical main protection',
      'Process-tree cancellation and orphan reconciliation',
      'Automatic dispatch, review and restart recovery',
      'Interactive native test access and whole-team cutover',
    ],
  };
}
