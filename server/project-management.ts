import {readFileSync,realpathSync,statSync,existsSync,writeFileSync,renameSync,unlinkSync} from 'node:fs';
import {resolve,dirname,basename,join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {projectSchema,projectsSchema,projectsFile,runtimeSettings,verificationTool,type Project} from './projects.ts';
import type {Task} from '../shared/workflow.ts';

function directory(value:unknown){
  if(typeof value!=='string'||!value.trim())throw Error('Choose a local folder.');
  const folder=realpathSync(resolve(value.trim()));
  if(!statSync(folder).isDirectory())throw Error('Folder must be a directory.');
  return folder;
}
function sourceGit(folder:string,args:string[]){const output=execFileSync('git',['--literal-pathspecs','-c',`safe.directory=${folder.replaceAll('\\','/')}`,'-c','core.fsmonitor=false','-c',`core.hooksPath=${resolve('.state/empty-hooks')}`,'-c','commit.gpgsign=false','-C',folder,...args],{encoding:'utf8',windowsHide:true,timeout:15000,stdio:['ignore','pipe','pipe']});return args.includes('-z')?output:output.trim();}
function gitIntake(folder:string){
  let root:string;
  try{root=realpathSync(sourceGit(folder,['rev-parse','--show-toplevel']));}
  catch(error){if((error as {code?:string}).code==='ENOENT')throw Error('Git is not installed or available to Barracks. Install Git and try again.');if(existsSync(join(folder,'.git'))||!String((error as {stderr?:unknown}).stderr).includes('not a git repository'))throw Error('Git could not inspect this folder. Check its repository access and try again.');return {status:'needs-git' as const,path:folder};}
  if(root.toLowerCase()!==folder.toLowerCase())throw Error('This folder belongs to a parent Git repository. Choose its root folder: '+root);
  try{sourceGit(folder,['rev-parse','--verify','HEAD^{commit}']);return null;}catch{}
  const files=[...new Set(sourceGit(folder,['ls-files','--cached','--others','--exclude-standard','-z']).split('\0').filter(Boolean))].sort();
  if(files.length>500)throw Error('This folder has over 500 candidate files. Add a .gitignore or create the initial commit with Git, then retry.');
  const staged=sourceGit(folder,['diff','--cached','--name-only','-z']).split('\0').filter(Boolean);
  const config=(key:string)=>{try{return sourceGit(folder,['config','--get',key]);}catch{return '';}};
  return {status:'needs-commit' as const,path:folder,files,staged,author:{name:config('user.name'),email:config('user.email')}};
}
export function inspectProject(value:unknown){
  const folder=directory(value);
  const intake=gitIntake(folder);if(intake)return intake;
  const name=basename(folder),verify:Project['verify']=[],notes:string[]=[];
  const npmCli=join(dirname(process.execPath),'node_modules/npm/bin/npm-cli.js');
  const manifest=join(folder,'package.json');
  if(existsSync(manifest)){
    try{const pkg=JSON.parse(readFileSync(manifest,'utf8'));
      if((!pkg.packageManager||pkg.packageManager.startsWith('npm@'))&&existsSync(npmCli)){for(const script of ['build','test'])if(typeof pkg.scripts?.[script]==='string')verify.push({executable:'node',args:[npmCli,'run',script],sandbox:'workspace-write'});}
      else notes.push('Confirm the verification commands for this package manager.');
    }catch{notes.push('package.json could not be read; enter verification commands manually.');}
  }
  if(!verify.length)notes.push('No existing build or test commands. Leave these empty for a new project; the first build will establish its checks.');
  notes.push('Commands are suggestions only. Dependencies and toolchain setup must be available in the task copy.');
  return {status:'ready' as const,project:{id:name.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')||'project',name,kind:'repository' as const,path:folder,ref:'HEAD',protectedPaths:[],verify,instructions:'',reviewChecklist:'Confirm the task acceptance criteria, inspect the changes and require all configured verification commands to pass.'},notes};
}
export function setupProjectGit(input:unknown){
  if(!input||typeof input!=='object')throw Error('Choose a project folder and confirm the Git action.');
  const value=input as {path?:unknown;action?:unknown;confirmed?:unknown;files?:unknown;name?:unknown;email?:unknown};
  if(value.confirmed!==true)throw Error('Confirm this Git action before continuing.');
  const folder=directory(value.path),state=gitIntake(folder);
  if(value.action==='initialize'){
    if(state?.status!=='needs-git')throw Error('Git state changed. Choose the folder again to refresh intake.');
    sourceGit(folder,['init','--initial-branch=main']);
  }else if(value.action==='initial-commit'){
    if(state?.status!=='needs-commit')throw Error('Git state changed. Choose the folder again to refresh intake.');
    if(!Array.isArray(value.files)||value.files.some(file=>typeof file!=='string'||!state.files.includes(file)))throw Error('Choose files from the current initial-commit list.');
    const files=value.files as string[];
    if(state.staged.some(file=>!files.includes(file)))throw Error('Some files are already staged. Include those files or adjust staging in Git before creating the first commit.');
    if(typeof value.name!=='string'||!value.name.trim()||/[\r\n<>]/.test(value.name)||typeof value.email!=='string'||!/^\S+@\S+$/.test(value.email)||/[\r\n<>]/.test(value.email))throw Error('Enter a Git author name and email for this commit.');
    const identity=['-c','user.name='+value.name.trim(),'-c','user.email='+value.email.trim()];
    if(files.length)sourceGit(folder,['add','--',...files]);
    try{sourceGit(folder,[...identity,'commit','--allow-empty','-m','Initial project baseline']);}catch{throw Error('Git could not create the initial commit. Selected files may remain staged; inspect the folder in Git and try again.');}
  }else throw Error('Choose initialize or initial-commit.');
  return inspectProject(folder);
}
export function saveProject(input:unknown,id:string|undefined,tasks:Task[]){
  const project=projectSchema.parse(input),settings=runtimeSettings();
  const existing=settings.projects.find(item=>item.id===id);
  if(id&&!existing)throw Error('Project no longer exists. Reload the workspace.');
  if(id&&project.id!==id)throw Error('Project ID stays fixed so existing tasks keep their project.');
  if(!id&&project.kind!=='repository')throw Error('Add Project links a local Git repository.');
  if(!id&&settings.projects.some(item=>item.id===project.id))throw Error('Project ID is already used. Choose another ID.');
  if(id&&tasks.some(task=>task.projectId===id&&task.execution==='codex'&&!['complete','cancelled'].includes(task.state)))throw Error('This project has unfinished real tasks. Finish or cancel them before changing project settings.');
  project.path=directory(project.path);
  if(project.trackerPath){project.trackerPath=directory(project.trackerPath);if(!existsSync(join(project.trackerPath,'.workspace/pm-toolbox.yml')))throw Error('Tracker folder must contain the existing .workspace/pm-toolbox.yml configuration.');}
  if(project.kind==='repository'){
    if(inspectProject(project.path).status!=='ready')throw Error('Complete the Git setup offered during Add Project before saving.');
    try{sourceGit(project.path,['rev-parse','--verify','--end-of-options',project.ref+'^{commit}']);}catch{throw Error('Source branch/ref must resolve to a committed revision in this repository.');}
  }
  if(settings.projects.some(item=>item.id!==id&&realpathSync(resolve(item.path)).toLowerCase()===project.path.toLowerCase()))throw Error('This folder is already linked to a project. Select it from the project switcher.');
  for(const name of project.protectedPaths)if(!name||name.includes('\\')||name.startsWith('/')||name.split('/').some(part=>part==='..'||part==='.')||name.includes(':'))throw Error('Protected files must use relative paths inside the project, such as src/config.ts.');
  for(const command of project.verify)verificationTool(command.executable,process.execPath);
  const next=projectsSchema.parse({...settings,projects:id?settings.projects.map(item=>item.id===id?project:item):[...settings.projects,project]});
  const target=projectsFile(),temporary=target+'.'+randomUUID()+'.tmp';
  try{writeFileSync(temporary,JSON.stringify(next,null,2)+'\n',{flag:'wx'});renameSync(temporary,target);}finally{if(existsSync(temporary))unlinkSync(temporary);}
  return project;
}
