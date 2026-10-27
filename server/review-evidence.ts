import {mkdirSync,cpSync,readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {inventory,git,gitDirectory,type Workspace} from './projects.ts';

export function reviewGit(directory:string,args:string[]):string{
  return execFileSync('git',['-c',`safe.directory=${directory.replaceAll('\\','/')}`,'-c','core.fsmonitor=false','-c','core.hooksPath=NUL','-C',directory,...args],{windowsHide:true,encoding:'utf8',timeout:15000,maxBuffer:8*1024*1024}).trim();
}

/** The Reviewer gets its own objects and index, with no connection to writable source Git. */
export function prepareReview(context:Workspace,id:string,candidate:string){
  const {root,workspace}=context,directory=join(root,'reviews',id);
  const manifest=JSON.parse(readFileSync(join(root,'workspace.json'),'utf8')) as {baseTree:string};
  const before=inventory(workspace);mkdirSync(directory,{recursive:true});
  for(const name of Object.keys(before)){const target=join(directory,name);mkdirSync(join(target,'..'),{recursive:true});cpSync(join(workspace,name),target);}
  reviewGit(directory,['init','--initial-branch=review']);
  writeFileSync(join(directory,'.git','info','exclude'),'\n.state/\n');
  try{reviewGit(directory,['config','core.autocrlf',git(root,['config','--get','core.autocrlf'])]);}catch{reviewGit(directory,['config','core.autocrlf','false']);}
  // Trees need not belong to commits (new projects have an empty, unborn predecessor).
  const pack=execFileSync('git',['--git-dir='+gitDirectory(root),'pack-objects','--revs','--stdout'],{input:candidate+'\n'+manifest.baseTree+'\n',windowsHide:true,timeout:15000,maxBuffer:64*1024*1024});
  execFileSync('git',['-c',`safe.directory=${directory.replaceAll('\\','/')}`,'-C',directory,'index-pack','--stdin'],{input:pack,windowsHide:true,timeout:15000,stdio:['pipe','pipe','pipe']});
  reviewGit(directory,['read-tree',candidate]);
  assertReviewCandidate(directory,candidate);
  const diff=reviewGit(directory,['diff','--no-ext-diff','--no-textconv',manifest.baseTree,candidate,'--']);
  writeFileSync(join(directory,'.git','barracks-baseline.diff'),diff);
  return {directory,candidate,baseline:manifest.baseTree,changes:reviewGit(directory,['diff','--no-ext-diff','--no-textconv','--name-status',manifest.baseTree,candidate,'--']),diffPath:join(directory,'.git','barracks-baseline.diff')};
}

export function assertReviewCandidate(directory:string,candidate:string){
  reviewGit(directory,['add','-A','--','.']);
  if(reviewGit(directory,['write-tree'])!==candidate)throw Error('Review snapshot does not match the assigned candidate. Rebuild and verify before review.');
}

export function saveReviewEvidence(directory:string,evidence:unknown){
  const file=join(directory,'.git','barracks-review.json');writeFileSync(file,JSON.stringify(evidence,null,2));return file;
}
