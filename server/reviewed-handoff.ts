import {execFileSync} from 'node:child_process';
import {existsSync,readFileSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {z} from 'zod';
import type {WorkflowRun} from '../shared/factory.ts';
import {taskRoot,type Project} from './projects.ts';

const oid=z.string().regex(/^[a-f0-9]{40}$/);
const manifestSchema=z.object({runId:z.string().uuid(),candidate:oid,base:oid,tree:oid,commit:oid,ref:z.string()}).strict();
function sourceGit(project:Project,args:string[],input?:string|Buffer,index?:string){return execFileSync('git',['-c','safe.directory='+project.path.replaceAll('\\','/'),'-c','core.fsmonitor=false','-c','core.hooksPath='+resolve('.state/empty-hooks'),'-c','gc.auto=0','-c','maintenance.auto=false','-C',project.path,...args],{windowsHide:true,encoding:'utf8',stdio:['pipe','pipe','pipe'],input,...(index?{env:{...process.env,GIT_INDEX_FILE:index}}:{})}).trim();}
export function sourceHead(project:Project){try{return sourceGit(project,['rev-parse','--verify','HEAD']);}catch{return undefined;}}
export function sourceContentMatches(project:Project,name:string,actual:Buffer|undefined,expected:Buffer|undefined){
  if(!actual||!expected)return actual===expected;if(actual.equals(expected))return true;
  return sourceGit(project,['hash-object','--path='+name,'--stdin'],actual)===sourceGit(project,['hash-object','--path='+name,'--stdin'],expected);
}

/** Creates only an explicitly selected review ref; completion waits for verified Source integration. */
export function reviewedHandoff(run:WorkflowRun,project:Project){
  if(project.kind!=='repository'||!run.parallel||!run.baseCandidate)throw Error('Reviewed branch handoff requires a Git repository delivery.');
  const root=taskRoot({id:run.id}),file=join(root,'reviewed-handoff.json'),base=oid.parse(run.artifacts.source_head),ref='refs/heads/barracks/'+run.id;
  let plan:z.infer<typeof manifestSchema>;
  if(existsSync(file))plan=manifestSchema.parse(JSON.parse(readFileSync(file,'utf8')));
  else{
    if(sourceHead(project)!==base)throw Error('Source HEAD changed before the reviewed handoff; reconcile its accepted base.');
    // Local object transfer has no network remote, branch checkout or worktree effect.
    sourceGit(project,['-c','protocol.file.allow=always','fetch','--no-write-fetch-head','--no-tags','--no-recurse-submodules',join(root,'git'),run.parallel.commit]);
    // Overlay managed source onto the original repository tree. Tracked PMT and
    // other excluded metadata remain in the review commit and the real index is untouched.
    const index=join(root,'handoff-index');sourceGit(project,['read-tree',base],undefined,index);
    const entries=sourceGit(project,['ls-tree','-r','-z',run.baseCandidate]).split('\0').filter(Boolean),finalNames=new Set(entries.map(entry=>entry.slice(entry.indexOf('\t')+1)));
    const baseNames=sourceGit(project,['ls-tree','-r','--name-only','-z',base]).split('\0').filter(name=>name&&!run.parallel!.excludedPrefixes.some(prefix=>name===prefix||name.startsWith(prefix+'/')));
    const removed=baseNames.filter(name=>!finalNames.has(name)).map(name=>'0 '+'0'.repeat(40)+'\t'+name+'\0').join('');
    sourceGit(project,['update-index','-z','--index-info'],removed,index);
    // Apply the Source repository's clean filters (including Windows line endings)
    // while keeping candidate files and the real Source index/worktree untouched.
    const directory=join(root,'workspace'),sourceDirectory=sourceGit(project,['rev-parse','--absolute-git-dir']);
    if(entries.length)sourceGit(project,['--literal-pathspecs','--git-dir='+sourceDirectory,'--work-tree='+directory,'-C',directory,'add','-f','--pathspec-from-file=-','--pathspec-file-nul'],[...finalNames].join('\0')+'\0',index);
    const normalized=new Map(sourceGit(project,['ls-files','--stage','-z'],undefined,index).split('\0').filter(Boolean).map(entry=>[entry.slice(entry.indexOf('\t')+1),entry.split(' ')[1]!]));
    const updates=entries.map(entry=>entry.slice(0,6)+' '+normalized.get(entry.slice(entry.indexOf('\t')+1))+'\t'+entry.slice(entry.indexOf('\t')+1)+'\0').join('');sourceGit(project,['update-index','-z','--index-info'],updates,index);
    const tree=sourceGit(project,['write-tree'],undefined,index),commit=sourceGit(project,['-c','user.name=Barracks runner','-c','user.email=barracks@localhost','-c','commit.gpgsign=false','commit-tree',tree,'-p',base,'-m','Reviewed Barracks delivery '+run.id]);
    plan={runId:run.id,candidate:run.baseCandidate,base,tree,commit,ref};writeFileSync(file,JSON.stringify(plan,null,2),{flag:'wx',flush:true});
  }
  if(plan.runId!==run.id||plan.candidate!==run.baseCandidate||plan.base!==base||plan.ref!==ref)throw Error('Reviewed handoff manifest no longer matches this accepted delivery.');
  let current:string|undefined;try{current=sourceGit(project,['rev-parse','--verify',ref]);}catch{}
  if(current&&current!==plan.commit)throw Error('Review branch changed externally; handoff is held.');
  if(!current)sourceGit(project,['update-ref',ref,plan.commit,'0'.repeat(40)]);
  run.artifacts.reviewed_handoff=plan;
  let integrated=false;try{sourceGit(project,['merge-base','--is-ancestor',plan.commit,'HEAD']);integrated=true;}catch{}
  if(!integrated)throw Error('Reviewed branch '+ref.replace('refs/heads/','')+' is ready. Integrate it through the project Lead, then resume to verify Source delivery. Source files have not been copied.');
  if(sourceGit(project,['rev-parse','HEAD^{tree}'])!==plan.tree)throw Error('Integrated Source tree differs from the accepted handoff tree; fresh review and acceptance are required.');
  return plan;
}
