import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import assert from 'node:assert/strict';
import { configSchema } from '../shared/workflow.ts';
import { Store } from '../server/store.ts';
import { Runner } from '../server/runner.ts';
import { CodexProofWorker } from '../server/proof-worker.ts';

// Explicit opt-in: this command invokes authenticated Codex sessions in a disposable fixture only.
const executable = process.env.BARRACKS_CODEX_PATH ?? join(homedir(),'.codex/packages/app-server-daemon/releases/0.163.0-x86_64-pc-windows-msvc/bin/codex.exe');
if (!existsSync(executable)) throw new Error('Set BARRACKS_CODEX_PATH to the qualified native Codex executable.');
const root=resolve('.state/qualification',randomUUID()), workspace=join(root,'workspace');
mkdirSync(workspace,{recursive:true});
cpSync(resolve('test/fixtures/slug-repo'),workspace,{recursive:true});
mkdirSync(join(root,'tools'));
cpSync(process.execPath,join(root,'tools','node.exe'));
writeFileSync(join(root,'manifest.json'),JSON.stringify({kind:'barracks-slug-proof-v1',createdAt:new Date().toISOString()},null,2));
execFileSync('git',['init','--initial-branch=main',`--separate-git-dir=${join(root,'git')}`,workspace],{windowsHide:true,stdio:'pipe'});
const config=configSchema.parse({...JSON.parse(readFileSync('config/workflow.json','utf8')),maxReviewCycles:3});
// Three is a bound for this opt-in experiment, not the application's default workflow policy.
const store=new Store(join(root,'state.db'));
const worker=new CodexProofWorker(root,executable);
const runner=new Runner(store,config,worker);
const task=store.create({title:'Prove real Builder / Reviewer / fix handoffs',description:'Disposable slug utility; staged regression coverage review.',specificationReady:true,requestChangesOnce:false});
let last='',status='failed';
const report: Record<string,unknown>={kind:'codex-slug-proof',status:'running',root,taskId:task.id,startedAt:new Date().toISOString(),scope:'Disposable fixture only; Saltwake is outside this run.',limits:['Controlled regression-coverage challenge, not an unbiased defect-discovery benchmark.','Lead triage is deterministic fixture routing; BA is skipped for fully specified scope.','Candidate identity is a real Git tree object; no application or production commits are made.','Cancellation, orphan recovery and production isolation are not qualified by this happy-path proof.']};
const save=()=>writeFileSync(join(root,'result.json'),JSON.stringify({...report,receipts:worker.receipts,task:store.task(task.id),history:store.history(task.id)},null,2));
console.log(`Qualification fixture: ${root}`);
try {
  let failed=false;
  try {execFileSync(executable,['sandbox','-P',':read-only','-C',workspace,'--',join(root,'tools','node.exe'),'--test','slug.test.mjs'],{cwd:workspace,encoding:'utf8',windowsHide:true,timeout:60000});}
  catch(error){const failure=error as Error & {stdout?:string};const output=failure.stdout??'';writeFileSync(join(root,'baseline-tests.txt'),output);failed=output.includes('ERR_ASSERTION');}
  assert.ok(failed,'Baseline must fail the fixture assertions, not sandbox setup.');
  save();runner.start();
  const deadline=Date.now()+15*60*1000;
  while(Date.now()<deadline){
    const current=store.task(task.id);const active=store.assignments().filter(a=>a.status==='running').map(a=>a.role).join(',');
    const progress=`${current.state} | ${active||'waiting'} | reviews ${current.reviewCycles}`;
    if(progress!==last){console.log(progress);last=progress;save();}
    if(current.state==='complete'){status='passed';break;}
    if(current.state==='blocked'||current.state==='cancelled')throw new Error(current.blocker??'Qualification stopped.');
    await delay(500);
  }
  assert.equal(status,'passed','Qualification did not complete within 15 minutes.');
  assert.equal(store.task(task.id).reviewCycles,2,'The controlled coverage challenge must produce rejection then approval.');
  assert.equal(worker.receipts.filter(receipt=>receipt.role==='builder').length,2);
  assert.equal(worker.receipts.filter(receipt=>receipt.role==='reviewer').length,2);
  assert.equal(new Set(worker.receipts.map(receipt=>receipt.sessionId)).size,4);
  assert.notEqual(worker.receipts[0]?.candidate,worker.receipts[2]?.candidate,'The fix must produce a new source tree.');
  assert.ok(existsSync(join(workspace,'slug.edge.test.mjs')));
  Object.assign(report,{status:'passed',completedAt:new Date().toISOString(),baseline:'failed expected assertions',candidate:store.task(task.id).candidate});
  console.log('PASS: real implementation, independent review rejection, fix and approval completed through Barracks.');
} catch(error){Object.assign(report,{status:'failed',failedAt:new Date().toISOString(),reason:error instanceof Error?error.message:String(error)});console.error(report.reason);process.exitCode=1;}
finally{runner.stop();save();store.close();console.log(`Evidence: ${join(root,'result.json')}`);}
