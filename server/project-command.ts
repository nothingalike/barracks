import {runOwned,CommandFailedError,readJson} from './process.ts';
import {runtimeSettings,verificationTool,type Project} from './projects.ts';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {materializeProjectTools} from './project-tools.ts';

export function projectEnvironment(project:Project,workspace:string,node:string,overrides:Record<string,string>={}){
  const environment:Record<string,string>={};
  for(const [name,value] of Object.entries({...project.environment,...overrides})){
    const previous=Object.keys(environment).find(key=>key.toLowerCase()===name.toLowerCase());if(previous)delete environment[previous];
    environment[name]=value.replaceAll('{workspace}',workspace).replaceAll('{node}',node);
  }const tools=materializeProjectTools(project,workspace);if(tools){const key=Object.keys(environment).find(name=>name.toLowerCase()==='path')??'PATH';environment[key]=tools+';'+(environment[key]??process.env.PATH??process.env.Path??'');}return environment;
}

/** Every build/review/acceptance command uses the same owned execution policy. */
export async function runVerification(context:{project:Project;workspace:string;node:string},command:Project['verify'][number],directory:string,signal:AbortSignal,execute:typeof runOwned=runOwned){
  const {project,workspace,node}=context,settings=runtimeSettings();
  try{const output=await execute({executable:settings.codexExecutable,args:['sandbox','-P',command.sandbox==='workspace-write'?':workspace':':read-only','-C',workspace,'--',verificationTool(command.executable,node),...command.args],cwd:workspace,node,directory,signal,env:projectEnvironment(project,workspace,node,command.env),timeoutMs:command.timeoutMs===undefined?60000:command.timeoutMs,supervision:{workspace,warningAfterMs:settings.inactivityWarningMs}});return {...output,exitCode:0};}
  catch(error){if(!(error instanceof CommandFailedError)||!command.allowFailure)throw error;const result=readJson<{code:number|null}>(join(directory,'command-result.json'));if(!Number.isInteger(result?.code))throw error;const text=(name:string)=>{try{return readFileSync(join(directory,name),'utf8').slice(-16000);}catch{return '';}};return {stdout:text('stdout.log'),stderr:text('stderr.log'),exitCode:result!.code!,diagnosticFailure:true};}
}
