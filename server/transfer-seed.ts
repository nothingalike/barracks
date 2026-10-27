import {readFileSync,writeFileSync,mkdirSync,unlinkSync,existsSync,lstatSync} from 'node:fs';
import {join,resolve,dirname,sep} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {verifyTransfer,assertTransferredOwnership} from './transfer-manifest.ts';
import {verifyTransferActivation} from './transfer-activation.ts';
import {claimTransferredAssignment} from './transfer-adoption.ts';
import {git,gitDirectory,prepare,taskRoot,candidate,inventory,type Project} from './projects.ts';
import type {WorkflowRun} from '../shared/factory.ts';
import type {Task} from '../shared/workflow.ts';

export function loadProjectTransfer(project:Project){
  if(!project.transfer)return undefined;
  const {root,sha256}=project.transfer,bytes=readFileSync(join(root,'manifest.json'));if(createHash('sha256').update(bytes).digest('hex')!==sha256)throw Error('Approved transfer manifest changed.');
  const manifest=verifyTransfer(root);if(manifest.project.id!==project.id||resolve(manifest.project.path)!==resolve(project.path)||resolve(manifest.project.trackerPath??manifest.project.path)!==resolve(project.trackerPath??project.path))throw Error('Transferred project identity/roots differ from the approved profile.');
  assertTransferredOwnership(manifest);
  const activation=verifyTransferActivation(root,sha256);if(activation.participants.slice().sort().join('\0')!==(project.team??[]).map(member=>member.id).sort().join('\0'))throw Error('Transfer activation does not acknowledge this project roster.');
  const ids=(project.team??[]).map(member=>member.id).sort().join('\0');if(ids!==(manifest.project.team??[]).map(member=>member.id).sort().join('\0'))throw Error('The complete transferred roster must match the approved project team.');
  return manifest;
}
export function fetchTransferBase(run:WorkflowRun,project:Project){
  const manifest=run.artifacts.transfer_snapshot as ReturnType<typeof loadProjectTransfer>;if(!manifest)return;
  const source=manifest.worktrees.find(tree=>resolve(tree.path)===resolve(project.path));if(!source)throw Error('Transfer lacks its integration worktree.');
  git(taskRoot({id:run.id}),['-c','protocol.file.allow=always','fetch','--no-write-fetch-head','--no-tags','--no-recurse-submodules',project.path,source.head]);
  return source.head;
}

/** Seed retained progress into a private child. Prior reviews remain context, not new verdicts. */
export function seedTransferredTicket(run:WorkflowRun,child:WorkflowRun,task:Task,project:Project){
  const manifest=run.artifacts.transfer_snapshot as ReturnType<typeof loadProjectTransfer>;if(!manifest)return undefined;
  assertTransferredOwnership(manifest);
  if(child.artifacts.transfer_seed){const context=prepare(task);if(JSON.stringify(inventory(context.workspace))!==JSON.stringify(child.artifacts.transfer_seed_files))throw Error('Transferred private progress changed before routing; reconcile it without overwriting.');return undefined;}
  const owners=manifest.assignments.filter(item=>item.ticketId===child.ticketId&&item.worktree&&item.assignmentRole==='builder');if(!owners.length)return undefined;if(owners.length!==1)throw Error('Transferred ticket has ambiguous original source ownership.');const assignment=owners[0]!;
  if(!project.team?.some(member=>member.id===assignment.participantId&&member.roles.includes('builder')))throw Error('Transferred assignment requires its configured Builder owner.');
  const snapshot=manifest.worktrees.find(tree=>resolve(tree.path)===resolve(assignment.worktree!)),integration=manifest.worktrees.find(tree=>resolve(tree.path)===resolve(project.path));if(!snapshot||!integration)throw Error('Transferred assignment lacks its sealed worktree snapshot.');
  // Verify sealed backups immediately before use; current old worktree bytes are never adopted.
  verifyTransfer(project.transfer!.root);
  if(!claimTransferredAssignment(project,child.ticketId!,run.id,child.id,assignment.participantId))return undefined;
  const root=taskRoot({id:run.id});git(root,['-c','protocol.file.allow=always','fetch','--no-write-fetch-head','--no-tags','--no-recurse-submodules',snapshot.path,snapshot.head]);
  if(/^120000 /m.test(git(root,['ls-tree','-r',snapshot.head])))throw Error('Transferred committed links require safe source reconciliation before resuming.');
  const common=git(root,['merge-base',integration.head,snapshot.head]);
  const scratch=prepare({id:randomUUID(),projectId:run.projectId,projectSnapshot:project,baseTaskId:run.id,baseCandidate:run.baseCandidate,worktree:{runId:run.id,commit:run.parallel!.commit}});
  git(scratch.root,['read-tree','--reset','-u',snapshot.head]);
  for(const file of snapshot.files){const target=scratchTarget(scratch.workspace,file.name);if(file.deleted){if(existsSync(target))unlinkSync(target);}else{mkdirSync(dirname(target),{recursive:true});scratchTarget(scratch.workspace,file.name);writeFileSync(target,readFileSync(file.backup!));}}
  const retained=candidate(scratch.root),patch=execFileSync('git',['-c','core.hooksPath='+resolve('.state/empty-hooks'),'-c','core.fsmonitor=false','--git-dir='+gitDirectory(root),'--work-tree='+join(root,'workspace'),'diff','--binary','--no-ext-diff','--no-textconv',common,retained,'--','.',...run.parallel!.excludedPrefixes.map(prefix=>':(exclude,literal)'+prefix)],{windowsHide:true,maxBuffer:64*1024*1024});
  const context=prepare(task);git(context.root,['read-tree','--reset','-u',run.parallel!.commit]);const patchFile=join(context.root,'transfer.patch');writeFileSync(patchFile,patch);let conflicts=false;
  if(patch.length)try{execFileSync('git',['-c','safe.directory='+context.workspace.replaceAll('\\','/'),'-c','core.hooksPath='+resolve('.state/empty-hooks'),'-c','core.fsmonitor=false','--git-dir='+gitDirectory(context.root),'--work-tree='+context.workspace,'apply','--3way','--index','--',patchFile],{cwd:context.workspace,windowsHide:true,stdio:'pipe',timeout:15000,maxBuffer:64*1024*1024});}catch(error){if(!git(context.root,['ls-files','-u']))throw error;conflicts=true;}
  return {transferId:manifest.id,participantId:assignment.participantId,sourceHead:snapshot.head,priorReviewPins:assignment.reviewPins,nextAction:assignment.nextAction,conflicts};
}
function scratchTarget(root:string,name:string){const file=resolve(root,name);if(!file.startsWith(root+sep))throw Error('Transferred file escapes its private workspace.');for(let cursor=file;;cursor=dirname(cursor)){try{if(lstatSync(cursor).isSymbolicLink())throw Error('Transferred workspace paths cannot contain links.');}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}if(cursor===dirname(cursor))break;}return file;}
