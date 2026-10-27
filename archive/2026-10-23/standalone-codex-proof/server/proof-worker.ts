import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { z } from 'zod';
import type { Assignment, Task, WorkerResult } from '../shared/workflow.ts';
import type { Worker } from './runner.ts';

const replySchema = z.object({ summary:z.string().min(1), approved:z.boolean() }).strict();
const jsonSchema = { type:'object', properties:{summary:{type:'string'},approved:{type:'boolean'}}, required:['summary','approved'], additionalProperties:false };
export interface ProofReceipt {
  assignmentId: string; role: string; sessionId: string; pid: number; startedAt: string;
  sandbox: 'workspace-write' | 'read-only'; candidate: string | null; evidence: string;
}
function inventory(root: string): Record<string,string> {
  const files: Record<string,string> = {};
  for (const name of readdirSync(root).sort()) {
    if (name === '.git') continue;
    const file = join(root,name), info = lstatSync(file);
    if (!info.isFile() || info.isSymbolicLink()) throw new Error(`Fixture must contain plain files only: ${name}`);
    files[name] = createHash('sha256').update(readFileSync(file)).digest('hex');
  }
  return files;
}
export function assertAllowedChanges(before: Record<string,string>, after: Record<string,string>, allowed: string[]) {
  for (const name of new Set([...Object.keys(before),...Object.keys(after)])) {
    if (before[name] !== after[name] && !allowed.includes(name)) throw new Error(`Worker changed protected fixture file: ${name}`);
  }
}
/** Opt-in qualification adapter, restricted to the built-in disposable slug fixture. */
export class CodexProofWorker implements Worker {
  readonly receipts: ProofReceipt[] = [];
  private root: string;
  private workspace: string;
  private executable: string;
  private node: string;
  private baseline: Record<string,string>;
  constructor(root: string, executable: string) {
    this.root = resolve(root); this.workspace = join(this.root,'workspace'); this.executable = executable; this.node = join(this.root,'tools','node.exe');
    const approvedRoot = resolve('.state/qualification');
    if (!this.root.startsWith(approvedRoot + '\\') && !this.root.startsWith(approvedRoot + '/')) throw new Error('Codex proof must run beneath .state/qualification.');
    const manifest = JSON.parse(readFileSync(join(this.root,'manifest.json'),'utf8'));
    if (manifest.kind !== 'barracks-slug-proof-v1') throw new Error('Unsupported proof fixture.');
    this.baseline = inventory(this.workspace);
  }
  private git(args: string[], cwd = this.workspace): string {
    return execFileSync('git',['-c',`safe.directory=${cwd.replaceAll('\\','/')}`,'-c','core.fsmonitor=false',`--git-dir=${join(this.root,'git')}`,`--work-tree=${this.workspace}`,...args],{encoding:'utf8',windowsHide:true,timeout:10000}).trim();
  }
  private tree(): string {
    const names = Object.keys(inventory(this.workspace));
    if (names.some(name => !['README.md','slug.mjs','slug.test.mjs','slug.edge.test.mjs'].includes(name))) throw new Error('Unexpected file in proof workspace.');
    this.git(['add','--',...names]);
    return this.git(['write-tree']);
  }
  private verify(directory: string, evidence: string) {
    const files = readdirSync(directory).filter(name=>name.endsWith('.test.mjs'));
    try {
      const result = execFileSync(this.executable,['sandbox','-P',':read-only','-C',directory,'--',this.node,'--test',...files],{cwd:directory,encoding:'utf8',windowsHide:true,timeout:60000});
      writeFileSync(join(evidence,'verification.txt'),result);
    } catch(error) {
      const failure=error as Error & {stdout?:string;stderr?:string};
      writeFileSync(join(evidence,'verification.txt'),(failure.stdout??'')+'\n'+(failure.stderr??''));
      throw new Error(`Fixture verification failed; inspect ${relative(process.cwd(),join(evidence,'verification.txt'))}.`);
    }
  }
  private async invoke(assignment: Assignment, directory: string, prompt: string, sandbox: 'workspace-write' | 'read-only', signal: AbortSignal) {
    const evidence = join(this.root,'attempts',assignment.id); mkdirSync(evidence,{recursive:true});
    const schemaFile = join(evidence,'schema.json'), outputFile = join(evidence,'reply.json');
    writeFileSync(schemaFile,JSON.stringify(jsonSchema)); writeFileSync(join(evidence,'prompt.txt'),prompt);
    const args = ['--no-daemon','exec','--ignore-user-config','--disable','multi_agent','--disable','multi_agent_v2','--sandbox',sandbox,'-c','windows.sandbox="elevated"','-c','approval_policy="never"','--skip-git-repo-check','--json','--output-schema',schemaFile,'--output-last-message',outputFile,'-C',directory,'-'];
    let pid = 0, sessionId = '', stdout = '', totalBytes = 0;
    const startedAt = new Date().toISOString();
    await new Promise<void>((accept,reject) => {
      const child = spawn(this.executable,args,{cwd:directory,windowsHide:true,shell:false,stdio:['pipe','pipe','pipe']});
      let failure: Error | null = null;
      const stop = (reason: string) => {
        failure ??= new Error(reason);
        if (child.pid && child.exitCode === null) {
          if (process.platform === 'win32') { try { execFileSync('taskkill',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore',timeout:10000}); } catch { child.kill(); } }
          else child.kill('SIGTERM');
        }
      };
      const timer = setTimeout(()=>stop('Codex proof exceeded its 180-second attempt limit; inspect the retained attempt before retrying.'),180000);
      const abort = () => stop('Codex proof cancelled; process-tree cleanup requires inspection before retry.');
      signal.addEventListener('abort',abort,{once:true});
      child.once('spawn',()=>{
        pid=child.pid!;
        writeFileSync(join(evidence,'process.json'),JSON.stringify({pid,startedAt,assignmentId:assignment.id,role:assignment.role,sandbox},null,2));
        if (signal.aborted) abort();
      });
      child.stdin.on('error',()=>{});
      child.stdin.end(prompt);
      child.stdout.on('data',chunk=>{ totalBytes+=chunk.length; if (totalBytes>4*1024*1024) { stop('Codex proof output exceeded 4 MB.'); return; } stdout+=chunk.toString(); appendFileSync(join(evidence,'events.jsonl'),chunk); });
      child.stderr.on('data',chunk=>{ totalBytes+=chunk.length; if (totalBytes>4*1024*1024) { stop('Codex proof output exceeded 4 MB.'); return; } appendFileSync(join(evidence,'stderr.txt'),chunk); });
      child.once('error',error=>{ failure=error; });
      child.once('close',code=>{clearTimeout(timer);signal.removeEventListener('abort',abort);writeFileSync(join(evidence,'exit.json'),JSON.stringify({code,endedAt:new Date().toISOString(),failure:failure?.message??null}));if(failure)reject(failure);else if(code!==0)reject(new Error(`Codex exited ${code}; inspect ${relative(process.cwd(),evidence)}.`));else accept();});
    });
    for (const line of stdout.split('\n')) { try { const event=JSON.parse(line);if(event.type==='thread.started')sessionId=event.thread_id; } catch {} }
    if (!sessionId || this.receipts.some(receipt=>receipt.sessionId===sessionId)) throw new Error('Codex proof requires a distinct recorded session for every assignment.');
    const reply=replySchema.parse(JSON.parse(readFileSync(outputFile,'utf8')));
    const receipt: ProofReceipt = {assignmentId:assignment.id,role:assignment.role,sessionId,pid,startedAt,sandbox,candidate:assignment.candidate,evidence};
    this.receipts.push(receipt);writeFileSync(join(evidence,'receipt.json'),JSON.stringify(receipt,null,2));
    return {reply,evidence,receipt};
  }
  async run(assignment: Assignment, task: Task, signal: AbortSignal): Promise<WorkerResult> {
    if (assignment.stage==='queued') return {kind:'triaged',specificationReady:true};
    if (assignment.stage==='refining') throw new Error('This proof uses the fully specified fixture and skips BA refinement.');
    if (assignment.stage==='blocked') throw new Error('The standalone proof requires operator resolution of blockers.');
    const before=inventory(this.workspace);
    assertAllowedChanges(this.baseline,before,['slug.mjs','slug.edge.test.mjs']);
    if (assignment.stage==='implementing') {
      const allowed=task.reviewCycles===0?['slug.mjs']:['slug.mjs','slug.edge.test.mjs'];
      const persona=readFileSync(resolve('config/personas/builder.md'),'utf8');
      const feedback=task.reviewCycles>0?readFileSync(join(this.root,'review-feedback.txt'),'utf8'):'';
      const prompt=`${persona}\nTask: implement the slug utility described in README.md. ${task.reviewCycles===0?'This first assignment changes implementation only; the independent review stage checks regression coverage.':'Address the reviewer finding below.'}\nAllowed changed files: ${allowed.join(', ')}.\nRun checks using this executable: ${this.node}\n${feedback}\nReturn JSON with summary and approved:false. Use no skills or tools outside the fixture. Work only in ${this.workspace}.`;
      const {evidence,receipt}=await this.invoke(assignment,this.workspace,prompt,'workspace-write',signal);
      assertAllowedChanges(before,inventory(this.workspace),allowed);
      this.verify(this.workspace,evidence);
      const candidate=this.tree();receipt.candidate=candidate;writeFileSync(join(evidence,'receipt.json'),JSON.stringify(receipt,null,2));
      return {kind:'built',candidate,verified:true};
    }
    if (this.tree()!==assignment.candidate) throw new Error('Source changed after build verification; review refused.');
    const snapshot=join(this.root,'reviews',assignment.id);mkdirSync(snapshot,{recursive:true});
    for (const name of Object.keys(before)) cpSync(join(this.workspace,name),join(snapshot,name));
    const snapshotBefore=inventory(snapshot);
    const persona=readFileSync(resolve('config/personas/reviewer.md'),'utf8');
    const prompt=`${persona}\nReview the actual files in this snapshot against README.md. Candidate Git tree: ${assignment.candidate}. Verify slugify behavior and require a separate slug.edge.test.mjs regression test for slugify('  A___B---C  ') === 'a-b-c'. If missing, request that concrete test. Approve when all criteria are met. Run checks with ${this.node}. Return JSON {summary,approved}. Use local read-only commands only; use no external skills.`;
    const {reply,evidence}=await this.invoke(assignment,snapshot,prompt,'read-only',signal);
    assertAllowedChanges(snapshotBefore,inventory(snapshot),[]);
    assertAllowedChanges(before,inventory(this.workspace),[]);
    this.verify(snapshot,evidence);
    if (reply.approved && !existsSync(join(snapshot,'slug.edge.test.mjs'))) throw new Error('Reviewer approved without required regression coverage; fail closed.');
    writeFileSync(join(this.root,'review-feedback.txt'),reply.summary);
    return {kind:'reviewed',candidate:assignment.candidate!,approved:reply.approved,notes:reply.summary};
  }
}
