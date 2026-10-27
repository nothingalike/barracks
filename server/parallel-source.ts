import {mkdirSync,readFileSync,writeFileSync,cpSync,existsSync,lstatSync,unlinkSync,renameSync,realpathSync} from 'node:fs';
import {resolve,join,dirname,sep,isAbsolute} from 'node:path';
import {execFileSync} from 'node:child_process';
import {randomUUID,createHash} from 'node:crypto';
import {git,candidate,inventory,prepare,taskRoot,ignoreRuntimeFiles,type Project} from './projects.ts';
import {verificationPlan} from './verification.ts';
import type {WorkflowRun} from '../shared/factory.ts';
import type {Task} from '../shared/workflow.ts';
import {sourceHead,reviewedHandoff,sourceContentMatches} from './reviewed-handoff.ts';
import {fetchTransferBase} from './transfer-seed.ts';

const digest=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');
function localFile(root:string,name:string){
  const file=resolve(root,name);if(!file.startsWith(resolve(root)+sep))throw Error('Source path escapes its project: '+name);
  for(let cursor=file;cursor!==resolve(root);cursor=dirname(cursor))try{if(lstatSync(cursor).isSymbolicLink())throw Error('Managed source contains a symbolic link: '+name);}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
  return file;
}
function commit(root:string,tree:string,parents:string[]=[]){
  return git(root,['-c','user.name=Barracks runner','-c','user.email=barracks@localhost','-c','commit.gpgsign=false','commit-tree',tree,...parents.flatMap(id=>['-p',id]),'-m','Private Barracks integration checkpoint']);
}
function materialize(root:string,tree:string){git(root,['read-tree','--reset','-u',tree]);}

/** Private commit anchors support linked worktrees; the associated repository is never committed. */
export function initializeParallelSource(run:WorkflowRun,project:Project){
  if(run.parallel)return;
  if(project.ref!=='HEAD')throw Error('Parallel delivery currently requires ref HEAD; select its associated worktree explicitly before delivery.');
  const root=taskRoot({id:run.id}),workspace=join(root,'workspace'),manifest=join(root,'workspace.json');
  if(existsSync(manifest))throw Error('A partial parallel workspace exists. Reconcile it before retrying initialization.');
  const source=realpathSync(resolve(project.path));
  if(project.delivery?.publication==='reviewed-branch'){const head=sourceHead(project);if(!head)throw Error('Reviewed branch delivery needs an existing Source HEAD.');run.artifacts.source_head=head;}
  const excludedPrefixes=['.git','.state','.workspace','node_modules'];
  const pmt=join(source,'.workspace/pm-toolbox.yml');
  if(existsSync(pmt)){const configured=/^paths:\s*\r?\n((?:[ \t].*\r?\n)*)/m.exec(readFileSync(pmt,'utf8'))?.[1];const folder=/^\s+project:\s*(.+)$/m.exec(configured??'')?.[1]?.trim().replace(/^['"]|['"]$/g,'');if(folder&&!isAbsolute(folder))excludedPrefixes.push(folder.replaceAll('\\','/'));}
  let names:string[];
  if(project.kind==='repository'){
    const args=['-c',`safe.directory=${source.replaceAll('\\','/')}`,'-C',source];
    const actual=execFileSync('git',[...args,'rev-parse','--show-toplevel'],{windowsHide:true,encoding:'utf8'}).trim();
    if(realpathSync(actual).toLowerCase()!==source.toLowerCase())throw Error('The selected project must be a repository or Git worktree root.');
    names=[...new Set(execFileSync('git',[...args,'ls-files','--cached','--others','--exclude-standard','-z'],{windowsHide:true,encoding:'utf8',maxBuffer:8*1024*1024}).split('\0').filter(Boolean))];
  }else names=Object.keys(inventory(source));
  names=names.filter(name=>!excludedPrefixes.some(prefix=>name===prefix||name.startsWith(prefix+'/'))&&existsSync(localFile(source,name)));
  mkdirSync(workspace,{recursive:true});writeFileSync(manifest,JSON.stringify({status:'initializing',projectId:project.id}));
  for(const name of names){const target=localFile(workspace,name);mkdirSync(dirname(target),{recursive:true});cpSync(localFile(source,name),target);}
  execFileSync('git',['init','--initial-branch=integration','--separate-git-dir='+join(root,'git'),workspace],{windowsHide:true,stdio:'pipe'});
  git(root,['config','core.autocrlf','false']);ignoreRuntimeFiles(root);git(root,['add','-A','-f','--','.']);
  const sourceBase=fetchTransferBase(run,project);
  const tree=git(root,['write-tree']),anchor=commit(root,tree,sourceBase?[sourceBase]:[]),baseline=inventory(workspace);
  git(root,['update-ref','HEAD',anchor]);
  writeFileSync(manifest,JSON.stringify({status:'ready',projectId:project.id,baseline,projectSnapshot:project,baseTree:tree,baseCommit:anchor},null,2));
  run.baseTaskId=run.id;run.baseCandidate=tree;run.children={};run.completedTickets=[];
  run.parallel={commit:anchor,initialTree:tree,initialFiles:baseline,excludedPrefixes,ticketRuns:{},wave:[]};
}

export class IntegrationConflict extends Error{tree?:string;constructor(message:string,tree?:string){super(message);this.tree=tree;}}
export function planParallelIntegration(run:WorkflowRun,tasks:Task[],project:Project){
  if(!run.parallel||!run.baseCandidate)throw Error('Parallel integration has no source baseline.');
  if(run.parallel.plan)return run.parallel.plan;
  const root=taskRoot({id:run.id});if(candidate(root)!==run.baseCandidate)throw Error('Integration source changed outside its owned stage.');
  let mergedCommit=run.parallel.commit;
  const commands:ReturnType<typeof verificationPlan>=[...verificationPlan(project,root)];
  for(const task of tasks){
    if(task.state!=='complete'||!task.candidate||!task.verified||!task.worktree||candidate(taskRoot(task))!==task.candidate)throw Error('Every branch must have an unchanged independently approved candidate before integration.');
    const branchCommit=commit(root,task.candidate,[task.worktree.commit]);
    let tree:string;
    try{tree=git(root,['merge-tree','--write-tree',mergedCommit,branchCommit]).split(/\r?\n/)[0]!;}
    catch(error){const detail=typeof error==='object'&&error!==null&&'stdout' in error?String(error.stdout):String(error),tree=detail.split(/\r?\n/)[0];throw new IntegrationConflict('Approved ticket changes conflict during integration. Resolve the marked files while preserving the whole batch. '+detail.slice(0,12000),tree&&/^[a-f0-9]{40}$/.test(tree)?tree:undefined);}
    mergedCommit=commit(root,tree,[mergedCommit,branchCommit]);
    for(const command of verificationPlan(project,taskRoot(task))){const normalized={...command,executable:/(?:^|[\\/])node\.exe$/i.test(command.executable)?'node':command.executable};if(!commands.some(other=>JSON.stringify(other)===JSON.stringify(normalized)))commands.push(normalized);}
  }
  if(!commands.length)throw Error('The combined source has no independent verification plan.');
  const taskId=randomUUID(),tree=git(root,['rev-parse',mergedCommit+'^{tree}']);
  const context=prepare({id:taskId,projectId:run.projectId,projectSnapshot:project,baseTaskId:run.id,baseCandidate:run.baseCandidate,worktree:{runId:run.id,commit:run.parallel.commit}});
  materialize(context.root,tree);writeFileSync(join(context.root,'verification.json'),JSON.stringify(commands,null,2));
  run.parallel.plan={taskId,candidate:tree,commit:mergedCommit,tickets:[...run.parallel.wave]};return run.parallel.plan;
}

export function acceptParallelIntegration(run:WorkflowRun){
  const plan=run.parallel?.plan;if(!run.parallel||!plan||!run.baseCandidate)throw Error('No integration candidate was supplied to the Lead.');
  const root=taskRoot({id:run.id});
  const current=candidate(root);
  if((current!==run.baseCandidate&&current!==plan.candidate)||candidate(taskRoot({id:plan.taskId}))!==plan.candidate)throw Error('The integration candidate or predecessor changed during Lead review.');
  // Replaying the persisted plan after a crash may find its exact tree already materialized.
  if(current!==plan.candidate)materialize(root,plan.candidate);git(root,['update-ref','HEAD',plan.commit]);
  cpSync(join(taskRoot({id:plan.taskId}),'verification.json'),join(root,'verification.json'));
  run.baseCandidate=plan.candidate;run.parallel.commit=plan.commit;
  run.completedTickets=[...new Set([...(run.completedTickets??[]),...plan.tickets])];run.parallel.wave=[];delete run.parallel.plan;delete run.parallel.repairTicketId;
}

export function publishParallelSource(run:WorkflowRun,project:Project){
  if(!run.parallel||!run.baseCandidate||run.artifacts.acceptance_candidate!==run.baseCandidate)throw Error('Publishing requires final acceptance of the exact combined candidate.');
  const root=taskRoot({id:run.id}),workspace=join(root,'workspace'),target=realpathSync(resolve(project.path));
  if(candidate(root)!==run.baseCandidate)throw Error('Accepted source changed before publication.');
  const names=git(root,['diff','--no-renames','--name-only','-z',run.parallel.initialTree,run.baseCandidate,'--']).split('\0').filter(Boolean);
  for(const name of names)if(run.parallel.excludedPrefixes.some(prefix=>name.toLowerCase()===prefix.toLowerCase()||name.toLowerCase().startsWith(prefix.toLowerCase()+'/')))throw Error('Publication would change runner/project metadata: '+name);
  if(project.delivery?.publication==='reviewed-branch')reviewedHandoff(run,project);
  const finalFiles=new Set(git(root,['ls-tree','-r','--name-only','-z',run.baseCandidate]).split('\0').filter(Boolean));
  const changedNames=new Set(names);
  const verifyUntouched=()=>{for(const name of new Set([...Object.keys(run.parallel!.initialFiles),...finalFiles]))if(!changedNames.has(name)){
    const file=localFile(target,name),expected=readFileSync(localFile(workspace,name));
    if(!existsSync(file)||!readFileSync(file).equals(expected))throw Error('Unchanged baseline source was edited or removed; publication held without overwriting: '+name);
  }};verifyUntouched();
  const plan=names.map(name=>{
    if(run.parallel!.excludedPrefixes.some(prefix=>name===prefix||name.startsWith(prefix+'/')))throw Error('Publication would change runner/project metadata: '+name);
    const file=localFile(target,name),desired=finalFiles.has(name)?readFileSync(localFile(workspace,name)):undefined,current=existsSync(file)?readFileSync(file):undefined;
    const currentHash=current?digest(current):undefined,desiredHash=desired?digest(desired):undefined;
    const matchesAccepted=currentHash===desiredHash||project.delivery?.publication==='reviewed-branch'&&sourceContentMatches(project,name,current,desired);
    if(currentHash!==run.parallel!.initialFiles[name]&&!matchesAccepted)throw Error('Project files changed since delivery started; publication held without overwriting: '+name);
    return {name,file,desired,current,currentHash,desiredHash,matchesAccepted};
  });
  if(project.delivery?.publication==='reviewed-branch'){
    for(const item of plan)if(!item.matchesAccepted)throw Error('Integrated Source worktree differs from accepted source; preserve and reconcile: '+item.name);
    run.parallel.publication={candidate:run.baseCandidate,projectPath:target,files:names};writeFileSync(join(root,'publication.json'),JSON.stringify(run.parallel.publication,null,2));return run.parallel.publication;
  }
  const changed:typeof plan=[];
  try{
    for(const item of plan){
      if(item.currentHash===item.desiredHash)continue;
      const current=existsSync(item.file)?digest(readFileSync(item.file)):undefined;if(current!==item.currentHash)throw Error('Project file changed while preparing publication: '+item.name);
      if(item.desired){mkdirSync(dirname(item.file),{recursive:true});const temp=item.file+'.barracks-'+randomUUID()+'.tmp';writeFileSync(temp,item.desired);try{renameSync(temp,item.file);}finally{if(existsSync(temp))unlinkSync(temp);}}
      else unlinkSync(item.file);changed.push(item);
    }
    for(const item of plan){const actual=existsSync(item.file)?digest(readFileSync(item.file)):undefined;if(actual!==item.desiredHash)throw Error('Project changed during publication: '+item.name);}
    verifyUntouched();
    if(candidate(root)!==run.baseCandidate)throw Error('Accepted candidate changed during publication.');
  }catch(error){
    for(const item of changed.reverse()){const actual=existsSync(item.file)?digest(readFileSync(item.file)):undefined;if(actual!==item.desiredHash)continue;if(item.current)writeFileSync(item.file,item.current);else if(existsSync(item.file))unlinkSync(item.file);}
    throw error;
  }
  run.parallel.publication={candidate:run.baseCandidate,projectPath:target,files:names};
  writeFileSync(join(root,'publication.json'),JSON.stringify(run.parallel.publication,null,2));return run.parallel.publication;
}
