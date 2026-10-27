import {z} from 'zod';
import {cpSync,existsSync,lstatSync,mkdirSync,readFileSync,readdirSync,writeFileSync,realpathSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {join,relative,resolve,isAbsolute} from 'node:path';
import type {Task} from '../shared/workflow.ts';
import type {WorkflowRun} from '../shared/factory.ts';
import {teamSchema,reviewAxisSchema,planReviewers} from '../shared/participants.ts';
import {sourceGrantSchema,resourceNameSchema} from '../shared/source-grants.ts';
import {evidenceKindSchema} from '../shared/evidence.ts';
import {deliveryPolicySchema} from '../shared/project-policy.ts';
export const assignmentTimeoutSchema=z.number().int().min(1000).max(2147483647).nullable();
export const environmentSchema=z.record(z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/),z.string().refine(value=>!value.includes('\0'),'Environment values cannot contain NUL.'));
const artifactPath=z.string().min(1).refine(path=>!path.includes('\\')&&!path.includes(':')&&!path.startsWith('/')&&path.split('/').every(part=>part&&part!=='.'&&part!=='..'&&part.toLowerCase()!=='.git'&&!part.includes('\0')),'Use a relative artifact path inside the verification workspace.');
export const verificationCommandSchema=z.object({executable:z.string().min(1),args:z.array(z.string()),sandbox:z.enum(['read-only','workspace-write']).default('read-only'),timeoutMs:assignmentTimeoutSchema.optional(),env:environmentSchema.optional(),resources:z.array(resourceNameSchema).optional(),evidenceKind:evidenceKindSchema.exclude(['physical']).optional(),allowFailure:z.boolean().optional(),platform:z.string().min(1).max(100).optional(),artifacts:z.array(z.object({path:artifactPath,name:z.string().min(1),role:z.enum(['build','helper','capture','log'])}).strict()).optional()}).strict();
export const projectSchema=z.object({
  id:z.string().regex(/^[a-z0-9-]+$/),name:z.string().min(1),kind:z.enum(['fixture','repository']),path:z.string().min(1),trackerPath:z.string().min(1).optional(),
  delivery:deliveryPolicySchema.optional(),
  transfer:z.object({root:z.string().refine(isAbsolute,'Use the sealed transfer folder.'),sha256:z.string().regex(/^[a-f0-9]{64}$/),approved:z.literal(true)}).strict().optional(),
  ref:z.string().default('HEAD'),protectedPaths:z.array(z.string()).default([]),
  verify:z.array(verificationCommandSchema).default([]),
  environment:environmentSchema.optional(),
  tools:z.array(z.object({name:z.string().regex(/^[A-Za-z0-9_-]+\.exe$/),path:z.string().refine(isAbsolute,'Use an absolute installed-tool path.'),sha256:z.string().regex(/^[a-f0-9]{64}$/)}).strict()).refine(tools=>new Set(tools.map(tool=>tool.name.toLowerCase())).size===tools.length,'Choose distinct tool names.').optional(),
  team:teamSchema.optional(),
  reviewChecklist:z.string().min(1),
  instructions:z.string().max(10000).default(''),
}).strict().superRefine((project,context)=>{
  if(!project.team||!project.delivery?.reviewAxes.length)return;
  const axes=[...new Set(project.delivery.reviewAxes)];
  for(const author of project.team.filter(person=>person.roles.includes('builder'))){
    if(!planReviewers({team:project.team,axes,author:author.id}))context.addIssue({code:'custom',message:'Builder '+author.id+' needs a different independent participant for every required review axis.',path:['team']});
  }
});
export const projectsSchema=z.object({codexExecutable:z.string().min(1),attemptTimeoutMs:assignmentTimeoutSchema.default(null),inactivityWarningMs:z.number().int().min(1000).max(2147483647).default(600000),projects:z.array(projectSchema)}).strict();
export type Project=z.infer<typeof projectSchema>;
export const projectsFile=()=>resolve(process.env.BARRACKS_PROJECTS_PATH??'config/projects.json');
export const runtimeSettings=()=>projectsSchema.parse(JSON.parse(readFileSync(projectsFile(),'utf8')));
export function pinProject(project:Project):Project{return {...project,path:realpathSync(resolve(project.path)),...(project.trackerPath?{trackerPath:realpathSync(resolve(project.trackerPath))}:{})};}
export function runProject(run:Pick<WorkflowRun,'projectId'|'artifacts'>):Project{
  const saved=run.artifacts.project_snapshot;
  const project=saved?projectSchema.parse(saved):runtimeSettings().projects.find(project=>project.id===run.projectId);
  if(!project||project.id!==run.projectId)throw Error('Project configuration no longer matches this run.');
  if(saved)for(const path of [project.path,project.trackerPath].filter((value):value is string=>!!value))if(realpathSync(path).toLowerCase()!==resolve(path).toLowerCase())throw Error('Pinned project source or tracker identity changed. Reconcile the saved run before continuing.');
  return project;
}
export const taskRoot=(task:Pick<Task,'id'>)=>resolve('.state/tasks',task.id);
export function verificationTool(executable:string,node:string):string{
  if(executable==='node')return node;
  const path=isAbsolute(executable)?executable:execFileSync('where.exe',[executable],{encoding:'utf8',windowsHide:true}).trim().split(/\r?\n/)[0]!;
  if(!existsSync(path)||!path.toLowerCase().endsWith('.exe'))throw new Error('Verification executable must resolve to a native .exe. Use node with a script argument for npm or other JavaScript tools.');
  return path;
}
export function inventory(root:string):Record<string,string>{
  const files:Record<string,string>={};
  if(existsSync(join(root,'.git'))){
    const names=execFileSync('git',['-c',`safe.directory=${resolve(root).replaceAll('\\','/')}`,'-C',root,'ls-files','--cached','--others','--exclude-standard','-z'],{windowsHide:true,encoding:'utf8',maxBuffer:16*1024*1024}).split('\0').filter(Boolean);
    for(const name of [...new Set(names)].sort()){
      if(name.split('/').some(part=>['.git','node_modules','.state'].includes(part)))continue;
      const file=join(root,name);if(!existsSync(file))continue;
      let cursor=root;for(const part of name.split('/')){cursor=join(cursor,part);if(lstatSync(cursor).isSymbolicLink())throw Error('Symlink is outside the current workspace contract: '+name);}
      const info=lstatSync(file);
      if(info.isFile())files[name]=createHash('sha256').update(readFileSync(file)).digest('hex');
    }return files;
  }
  function visit(directory:string){for(const name of readdirSync(directory).sort()){
    if(['.git','node_modules','.state'].includes(name))continue;
    const file=join(directory,name),info=lstatSync(file),key=relative(root,file).replaceAll('\\','/');
    if(info.isSymbolicLink())throw new Error(`Symlink is outside the current workspace contract: ${key}`);
    if(info.isDirectory())visit(file);else if(info.isFile())files[key]=createHash('sha256').update(readFileSync(file)).digest('hex');
  }}visit(root);return files;
}
export function gitDirectory(root:string):string{
  const manifest=join(root,'workspace.json');return existsSync(manifest)?JSON.parse(readFileSync(manifest,'utf8')).gitDirectory??join(root,'git'):join(root,'git');
}
export function git(root:string,args:string[]):string {
  const workspace=join(root,'workspace');
  return execFileSync('git',['-c',`safe.directory=${workspace.replaceAll('\\','/')}`,'-c','core.fsmonitor=false','-c',`core.hooksPath=${join(root,'empty-hooks')}`,'--git-dir='+gitDirectory(root),'--work-tree='+workspace,...args],{windowsHide:true,encoding:'utf8',timeout:15000,maxBuffer:8*1024*1024}).trim();
}
export function ignoreRuntimeFiles(root:string){
  const common=resolve(join(root,'workspace'),git(root,['rev-parse','--git-common-dir'])),file=join(common,'info','exclude');mkdirSync(join(common,'info'),{recursive:true});
  const before=existsSync(file)?readFileSync(file,'utf8'):'';if(!before.split(/\r?\n/).includes('.state/'))writeFileSync(file,before+'\n.state/\n');
}
export function candidate(root:string):string{git(root,['add','-A','--','.']);return git(root,['write-tree']);}
export interface Workspace {project:Project;root:string;workspace:string;node:string;baseline:Record<string,string>}
export function prepare(task:Pick<Task,'id'|'projectId'|'baseTaskId'|'baseCandidate'|'worktree'|'projectSnapshot'>,settings=runtimeSettings()):Workspace{
  const root=taskRoot(task),workspace=join(root,'workspace'),manifest=join(root,'workspace.json'),saved=existsSync(manifest)?JSON.parse(readFileSync(manifest,'utf8')):null;
  const pinned=task.projectSnapshot??saved?.projectSnapshot;
  let project=pinned?projectSchema.parse(pinned):settings.projects.find(item=>item.id===task.projectId);
  if(!project)throw new Error('Select a configured project before starting a real task.');
  if(project.id!==task.projectId)throw Error('Pinned project identity does not match this task.');
  if(!existsSync(settings.codexExecutable))throw new Error('Configured codexExecutable does not exist. Update config/projects.json.');
  let baseline:Record<string,string>;
  if(saved){
    if(saved.status!=='ready'||saved.projectId!==project.id)throw new Error('Workspace initialization is incomplete. Existing files are preserved for inspection.');
    baseline=saved.baseline;
    if(saved.projectSnapshot){
      project=projectSchema.parse(saved.projectSnapshot);
      if(task.projectSnapshot){
        const adopted=projectSchema.parse(task.projectSnapshot),identity=(value:Project)=>JSON.stringify([value.id,resolve(value.path).toLowerCase(),resolve(value.trackerPath??value.path).toLowerCase(),value.ref]);
        if(identity(adopted)!==identity(project))throw Error('Pinned project identity differs from the prepared workspace.');
        // Approved delegation amendments apply to retained workspaces; their other source facts stay frozen.
        if(adopted.delivery)project=projectSchema.parse({...project,delivery:{...project.delivery,leadDelegation:adopted.delivery.leadDelegation}});
      }
    }
  }else{
    mkdirSync(root,{recursive:true});
    writeFileSync(manifest,JSON.stringify({status:'initializing',projectId:project.id}));
    let linkedGit:string|undefined;
    if(task.worktree){
      if(!/^[a-f0-9-]{36}$/.test(task.worktree.runId)||! /^[a-f0-9]{40}$/.test(task.worktree.commit))throw Error('Invalid managed worktree baseline.');
      const owner=taskRoot({id:task.worktree.runId});
      if(git(owner,['rev-parse',task.worktree.commit+'^{tree}'])!==task.baseCandidate)throw Error('Worktree commit does not match its approved baseline.');
      git(owner,['worktree','add','--detach',workspace,task.worktree.commit]);
      linkedGit=execFileSync('git',['-c',`safe.directory=${workspace.replaceAll('\\','/')}`,'-C',workspace,'rev-parse','--absolute-git-dir'],{encoding:'utf8',windowsHide:true}).trim();
    }else if(task.baseTaskId){
      if(!/^[a-f0-9-]{36}$/.test(task.baseTaskId)||!task.baseCandidate)throw Error('Invalid workflow source baseline.');
      const prior=taskRoot({id:task.baseTaskId});
      if(candidate(prior)!==task.baseCandidate)throw Error('The workflow source baseline changed; reconcile before starting another ticket.');
      inventory(join(prior,'workspace'));
      cpSync(join(prior,'workspace'),workspace,{recursive:true,filter:source=>!['.git','node_modules','.state'].includes(source.replaceAll('\\','/').split('/').at(-1)!)});
      execFileSync('git',['init','--initial-branch=main','--separate-git-dir='+join(root,'git'),workspace],{windowsHide:true,stdio:'pipe'});
    }else if(project.kind==='fixture'){
      cpSync(resolve(project.path),workspace,{recursive:true});
      execFileSync('git',['init','--initial-branch=main','--separate-git-dir='+join(root,'git'),workspace],{windowsHide:true,stdio:'pipe'});
    }else{
      if(!existsSync(resolve(project.path)))throw new Error('Configured local repository path does not exist.');
      execFileSync('git',['clone','--no-hardlinks','--no-checkout','--separate-git-dir='+join(root,'git'),resolve(project.path),workspace],{windowsHide:true,stdio:'pipe',timeout:60000});
      git(root,['checkout','--detach',project.ref]);git(root,['remote','remove','origin']);
    }
    baseline=inventory(workspace);
    if(linkedGit)writeFileSync(manifest,JSON.stringify({status:'ready',projectId:project.id,baseline,gitDirectory:linkedGit}));
    ignoreRuntimeFiles(root);
    writeFileSync(manifest,JSON.stringify({status:'ready',projectId:project.id,baseline,gitDirectory:linkedGit,projectSnapshot:project,baseTree:candidate(root),baseCommit:project.kind==='repository'&&!task.baseTaskId?git(root,['rev-parse','HEAD']):null},null,2));
  }
  ignoreRuntimeFiles(root);
  const node=join(root,'tools','node.exe');if(!existsSync(node)){mkdirSync(join(root,'tools'),{recursive:true});cpSync(process.execPath,node);}
  return {project,root,workspace,node,baseline};
}
export function checkProtected(context:{project:Pick<Project,'protectedPaths'>;baseline:Record<string,string>},after:Record<string,string>){
  for(const name of context.project.protectedPaths){if(context.baseline[name]!==after[name])throw new Error(`Protected source changed: ${name}. Restore it before resuming.`);}
}
