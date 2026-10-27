import {z} from 'zod';
import {readFileSync,writeFileSync,mkdirSync,copyFileSync,lstatSync,existsSync} from 'node:fs';
import {resolve,join,dirname,sep} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {projectSchema,pinProject} from './projects.ts';
import {Pmt} from './pmt.ts';

const sha=(bytes:Buffer|string)=>createHash('sha256').update(bytes).digest('hex');
const externalStatus=(status:string)=>status.split('\0').filter(entry=>!/^\?\? \.(?:state|workspace)\/barracks-(?:authority|operations)\.sqlite(?:-(?:journal|wal|shm))?$/i.test(entry)).join('\0');
const participant=z.string().min(1),digest=z.string().regex(/^[a-f0-9]{64}$/);
export const transferPlanSchema=z.object({project:projectSchema,sourceReference:z.object({path:z.string(),commit:z.string().regex(/^[a-f0-9]{40}$/)}),
  assignments:z.array(z.object({participantId:participant,assignmentRole:z.enum(['lead','ba','builder','reviewer']).optional(),ticketId:z.string().optional(),state:z.string(),nextAction:z.string().min(1),worktree:z.string().optional(),candidate:z.string().optional(),reviewPins:z.array(z.string()).default([])}).strict()),
  artifacts:z.array(z.object({path:z.string(),meaning:z.string(),expectedHash:digest.optional()}).strict()).default([]),
  processes:z.array(z.object({pid:z.number().int().positive(),startUtc:z.string(),owner:z.enum(['user','old-team']),purpose:z.string(),port:z.number().int().optional()}).strict()).default([]),
  retainedDecisions:z.array(z.string()),pendingActions:z.array(z.string()),outcomeCounts:z.object({accepted:z.number().int().nonnegative(),total:z.number().int().positive()}).optional()
}).strict().superRefine((plan,context)=>{
  if(plan.project.team?.length!==4)context.addIssue({code:'custom',message:'Whole-team transfer needs exactly four configured participants.'});
  for(const member of plan.project.team??[])if(!plan.assignments.some(item=>item.participantId===member.id))context.addIssue({code:'custom',message:'Missing handoff for '+member.id});
  if(plan.assignments.some(item=>!plan.project.team?.some(member=>member.id===item.participantId)))context.addIssue({code:'custom',message:'A handoff names an unconfigured participant.'});
});

function git(path:string,args:string[],binary=false):any{if(args[0]==='diff')args=['diff','--no-ext-diff','--no-textconv',...args.slice(1)];return execFileSync('git',['--no-optional-locks','-c','core.fsmonitor=false','-c','core.hooksPath='+resolve('.state/empty-hooks'),'-c','safe.directory='+path.replaceAll('\\','/'),'-C',path,...args],{windowsHide:true,encoding:binary?undefined:'utf8',maxBuffer:64*1024*1024,stdio:'pipe'});}
function assertOutput(path:string){for(let cursor=resolve(path);;cursor=dirname(cursor)){try{if(lstatSync(cursor).isSymbolicLink())throw Error('Transfer storage cannot contain links.');}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}if(cursor===dirname(cursor))break;}}
function safeFile(root:string,name:string){const path=resolve(root,name);if(!path.startsWith(resolve(root)+sep))throw Error('Transfer file escapes its worktree.');for(let cursor=path;;cursor=dirname(cursor)){if(lstatSync(cursor).isSymbolicLink())throw Error('Transfer input contains a link.');if(cursor===dirname(cursor))break;}return path;}
function snapshotWorktree(path:string,directory:string){
  const before=git(path,['status','--porcelain=v1','-z','-uall']),head=git(path,['rev-parse','HEAD']).trim();let branch='detached';try{branch=git(path,['symbolic-ref','-q','HEAD']).trim();}catch{}
  mkdirSync(directory,{recursive:true});const patch=git(path,['diff','--binary','HEAD','--'],true),staged=git(path,['diff','--cached','--binary','HEAD','--'],true);writeFileSync(join(directory,'tracked.patch'),patch);writeFileSync(join(directory,'index.patch'),staged);
  const names=[...new Set<string>((git(path,['diff','--name-only','-z','HEAD','--'])+'\0'+git(path,['ls-files','--others','--exclude-standard','-z'])).split('\0').filter(Boolean))];
  const files=names.map(name=>{const file=resolve(path,name);for(let cursor=file;;cursor=dirname(cursor)){try{if(lstatSync(cursor).isSymbolicLink())throw Error('Transfer input contains a link.');}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}if(cursor===dirname(cursor))break;}if(!existsSync(file))return {name,deleted:true};safeFile(path,name);const bytes=readFileSync(file),target=join(directory,'files',name);mkdirSync(dirname(target),{recursive:true});writeFileSync(target,bytes);if(sha(readFileSync(file))!==sha(bytes))throw Error('Dirty source changed during transfer capture: '+name);return {name,sha256:sha(bytes),backup:target};});
  const indexPath=resolve(path,git(path,['rev-parse','--git-path','index']).trim());let indexHash:string|undefined;if(existsSync(indexPath)){const bytes=readFileSync(indexPath);indexHash=sha(bytes);writeFileSync(join(directory,'index'),bytes);}
  if(git(path,['status','--porcelain=v1','-z','-uall'])!==before||git(path,['rev-parse','HEAD']).trim()!==head||!git(path,['diff','--binary','HEAD','--'],true).equals(patch)||!git(path,['diff','--cached','--binary','HEAD','--'],true).equals(staged))throw Error('Worktree moved during transfer capture; refresh the paused snapshot.');
  return {path,head,branch,status:before,backupDirectory:directory,patchHash:sha(patch),indexPatchHash:sha(staged),indexHash,files};
}

/** Read-only collection from the old team; import is retained paused inside Barracks. */
export function stageTransfer(input:unknown,storageRoot=resolve('.state/transfers')){
  const base=resolve('.state/transfers');if(storageRoot!==base&&!resolve(storageRoot).startsWith(base+sep))throw Error('Transfer storage must stay in the Barracks transfer folder.');
  const plan=transferPlanSchema.parse(input),project=pinProject(plan.project),id=randomUUID(),root=resolve(storageRoot,id);assertOutput(root);mkdirSync(root,{recursive:true});
  const locations=[...new Set([project.path,...plan.assignments.flatMap(item=>item.worktree?[resolve(item.worktree)]:[])])];
  const worktrees=locations.map((path,index)=>snapshotWorktree(path,join(root,'worktrees',String(index))));
  if(git(plan.sourceReference.path,['rev-parse',plan.sourceReference.commit+'^{commit}']).trim()!==plan.sourceReference.commit)throw Error('Original source reference is unavailable.');
  const tickets=new Pmt(project).list();
  const artifacts=plan.artifacts.map((artifact,index)=>{const path=resolve(artifact.path);safeFile(dirname(path),path);const bytes=readFileSync(path),hash=sha(bytes);if(artifact.expectedHash&&artifact.expectedHash!==hash)throw Error('Transfer artifact changed: '+artifact.path);const backup=join(root,'artifact-'+index);writeFileSync(backup,bytes);if(sha(readFileSync(path))!==hash)throw Error('Artifact moved during capture.');return {...artifact,sha256:hash,backup};});
  const manifest={id,createdAt:new Date().toISOString(),status:'paused' as const,activation:'requires-fresh-drain-proof-and-user-transfer-approval',project,sourceReference:plan.sourceReference,assignments:plan.assignments,worktrees,tickets,artifacts,processes:plan.processes,retainedDecisions:plan.retainedDecisions,pendingActions:plan.pendingActions,outcomeCounts:plan.outcomeCounts,
    reconciliation:{oldDispatchFenced:false,ownedProcessesDrained:false,manifestFresh:false,userApproved:false},contexts:(project.team??[]).map(member=>({participant:member,handoffs:plan.assignments.filter(item=>item.participantId===member.id)}))};
  const bytes=JSON.stringify(manifest,null,2);writeFileSync(join(root,'manifest.json'),bytes);writeFileSync(join(root,'manifest.sha256'),sha(bytes));return {root,manifest};
}
export function assertTransferredOwnership(manifest:Pick<ReturnType<typeof stageTransfer>['manifest'],'project'|'assignments'>){
  const records=manifest.assignments.filter(item=>item.ticketId&&item.worktree);
  for(const record of records)if(!record.assignmentRole||!manifest.project.team?.some(member=>member.id===record.participantId&&member.roles.includes(record.assignmentRole!)))throw Error('Retained ticket work needs an explicit configured assignment role and original source owner.');
  for(const id of new Set(records.map(item=>item.ticketId!))){const owners=records.filter(item=>item.ticketId===id&&item.assignmentRole==='builder');if(owners.length!==1)throw Error('Transfer needs exactly one explicit original Builder/source owner for '+id+'.');}
}
export function verifyTransfer(root:string){const bytes=readFileSync(join(root,'manifest.json'));if(sha(bytes)!==readFileSync(join(root,'manifest.sha256'),'utf8'))throw Error('Transfer manifest seal changed.');const manifest=JSON.parse(bytes.toString('utf8')) as ReturnType<typeof stageTransfer>['manifest'];
  for(const worktree of manifest.worktrees){for(const [name,hash] of [['tracked.patch',worktree.patchHash],['index.patch',worktree.indexPatchHash],['index',worktree.indexHash]])if(hash&&sha(readFileSync(safeFile(root,join(worktree.backupDirectory,name!))))!==hash)throw Error('Worktree patch/index backup changed.');for(const file of worktree.files)if(file.backup&&sha(readFileSync(safeFile(root,file.backup)))!==file.sha256)throw Error('Dirty-work backup changed.');}
  for(const artifact of manifest.artifacts)if(sha(readFileSync(safeFile(root,artifact.backup)))!==artifact.sha256)throw Error('Transfer artifact backup changed.');return manifest;
}

/** Rollback starts from observed effects; it never restores a stale DB over real work. */
export function reconcileTransfer(root:string){
  const manifest=verifyTransfer(root),effects:{kind:string;path:string;before:string;after:string;action:string}[]=[];
  for(const worktree of manifest.worktrees){
    const head=git(worktree.path,['rev-parse','HEAD']).trim(),status=git(worktree.path,['status','--porcelain=v1','-z','-uall']);
    if(head!==worktree.head)effects.push({kind:'head',path:worktree.path,before:worktree.head,after:head,action:'Preserve completed commits and reconcile their review/publication before choosing a new coordinator epoch.'});
    if(externalStatus(status)!==externalStatus(worktree.status))effects.push({kind:'worktree',path:worktree.path,before:worktree.status,after:status,action:'Preserve dirty work and refresh the acknowledged owner checkpoint.'});
    for(const [kind,args,before] of [['index',['diff','--cached','--binary','HEAD','--'],worktree.indexPatchHash],['tracked-diff',['diff','--binary','HEAD','--'],worktree.patchHash]] as const){const after=sha(git(worktree.path,[...args],true));if(after!==before)effects.push({kind,path:worktree.path,before,after,action:'Preserve the current staged/working diff and refresh its owner handoff before any recovery.'});}
    for(const file of worktree.files){const path=resolve(worktree.path,file.name),actual=existsSync(path)?sha(readFileSync(safeFile(worktree.path,file.name))):'deleted';if(actual!==(file.sha256??'deleted'))effects.push({kind:'dirty-file',path,before:file.sha256??'deleted',after:actual,action:'Preserve the newer bytes; retain the sealed backup as a recovery reference.'});}
  }
  try{const current=new Pmt(manifest.project).list();for(const previous of manifest.tickets){const item=current.find(item=>item.id===previous.id);if(item?.revision!==previous.revision)effects.push({kind:'tracker',path:previous.id,before:previous.revision,after:item?.revision??'missing',action:'Reconcile the canonical tracker operation journal and preserve legitimate ticket transitions.'});}for(const item of current)if(!manifest.tickets.some(previous=>previous.id===item.id))effects.push({kind:'tracker',path:item.id,before:'absent',after:item.revision,action:'Preserve the new canonical item; reconcile ownership rather than restoring an old tracker copy.'});}
  catch(error){effects.push({kind:'tracker-hold',path:manifest.project.trackerPath??manifest.project.path,before:'readable snapshot',after:String(error),action:'Reconcile pending tracker effects before either dispatcher resumes.'});}
  return {transferId:manifest.id,status:'paused',dispatchAllowed:false,effects,requiredActions:['Checkpoint and drain the current coordinator before changing authority.','Reconcile every observed source/tracker effect and preserve legitimate work.','Verify exact owned process start identities and drain evidence.','Use fresh user-approved ownership evidence and a new epoch; retain the old manifest and backups.']};
}
