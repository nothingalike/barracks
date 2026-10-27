import {spawn,execFileSync} from 'node:child_process';
import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {AgentSupervisor,type SupervisionOptions} from './supervision.ts';
import type {AgentActivity} from '../shared/supervision.ts';

export class StoppedError extends Error { readonly cleanupConfirmed=true; }
export class CommandFailedError extends Error { readonly cleanupConfirmed=true; }
export class RepeatedFailureError extends Error { readonly cleanupConfirmed=true; }
export function readJson<T>(file:string):T|null {try{return JSON.parse(readFileSync(file,'utf8').replace(/^\uFEFF/,'')) as T;}catch{return null;}}
export function readActivity(directory:string,assignedActive:boolean):AgentActivity|null{
  const activity=readJson<AgentActivity>(join(directory,'activity.json'));if(!activity)return null;
  const receipt=readJson<Receipt>(join(directory,'process.json'));
  if(receipt?.drained)return {...activity,ended:true,lifecycle:'finished'};
  if(assignedActive&&receipt?.status==='running')return {...activity,ended:false,lifecycle:'running',idleMs:Math.max(0,Date.now()-Date.parse(activity.lastActivityAt))};
  return {...activity,ended:false,lifecycle:'recovery'};
}
function quote(value:string):string {return '"'+value.replace(/(\\*)"/g,'$1$1\\"').replace(/(\\+)$/,'$1$1')+'"';}
let ownerStartTicks:string|undefined;
function ownerStart(){return ownerStartTicks??=execFileSync('powershell.exe',['-NoProfile','-Command',`(Get-Process -Id ${process.pid}).StartTime.ToUniversalTime().Ticks.ToString()`],{encoding:'utf8',windowsHide:true}).trim();}
interface Receipt { status:string; drained?:boolean; exitCode?:number; hostPid:number;hostStartUtc:string;rootPid:number;rootStartUtc:string;memberIdentity:{pid:number;startUtc:string;name:string}[] }
export interface Command {executable:string;args:string[];cwd:string;input?:string;node:string;directory:string;timeoutMs?:number|null;env?:Record<string,string>;signal?:AbortSignal;supervision?:SupervisionOptions}

/** Owns a suspended Windows job; terminal results require all job members to drain. */
export async function runOwned(command:Command):Promise<{stdout:string;stderr:string}> {
  if(process.platform!=='win32')throw new Error('The current owned-process backend requires Windows.');
  mkdirSync(command.directory,{recursive:true});
  const manifest=join(command.directory,'command.json'), receipt=join(command.directory,'process.json'), cancelFile=join(command.directory,'cancel');
  const stdout=join(command.directory,'stdout.log'),stderr=join(command.directory,'stderr.log'),result=join(command.directory,'command-result.json');
  const childManifest=join(command.directory,'child.json');
  writeFileSync(childManifest,JSON.stringify({...command,signal:undefined,stdout,stderr,result,childReceipt:join(command.directory,'child-process.json'),maxOutputBytes:4*1024*1024}));
  const timeout=command.timeoutMs===undefined?180000:command.timeoutMs;
  writeFileSync(manifest,JSON.stringify({node:command.node,cwd:command.cwd,jobName:`Local\\Barracks-${crypto.randomUUID()}`,commandLine:[command.node,resolve('server/process-child.mjs'),childManifest].map(quote).join(' '),receipt,cancelFile,errorFile:join(command.directory,'host-error.json'),maxRuntimeMs:timeout,ownerPid:process.pid,ownerStartTicks:ownerStart()}));
  const host=spawn('powershell.exe',['-NoProfile','-File',resolve('server/windows/host.ps1'),'-Manifest',manifest],{windowsHide:true,stdio:'ignore'});
  let hostError:Error|null=null,closed=false;
  host.once('error',error=>{hostError=error;closed=true;});host.once('exit',()=>{closed=true;});
  const abort=()=>writeFileSync(cancelFile,'cancel');
  command.signal?.addEventListener('abort',abort,{once:true});if(command.signal?.aborted)abort();
  const deadline=timeout===null?Infinity:Date.now()+timeout+20000;
  const supervisor=command.supervision?new AgentSupervisor(command.directory,command.supervision):undefined;
  let nextObservation=0,repeatedFailure=false;
  try {
    while(!closed&&Date.now()<deadline){
      if(supervisor&&Date.now()>=nextObservation){
        try{const activity=supervisor.sample();if(activity.reason==='repeated-failure'&&!repeatedFailure){repeatedFailure=true;writeFileSync(cancelFile,'repeated-failure');}}catch{/* Observation failure does not imply worker failure. */}
        nextObservation=Date.now()+1000;
      }
      await delay(50);
    }
    if(!closed){writeFileSync(cancelFile,'timeout');throw new Error('Owned host did not stop; reconciliation is required.');}
    if(hostError)throw hostError;
    const state=readJson<Receipt>(receipt);
    if(!state?.drained)throw new Error(`Process cleanup is unconfirmed; inspect ${command.directory}.`);
    if(command.signal?.aborted)throw new StoppedError('Assignment cancelled after its owned process tree drained.');
    if(repeatedFailure)throw new RepeatedFailureError('The same command failed repeatedly without observed workspace changes. Its process tree drained; Lead intervention is required. Inspect the retained worker log.');
    if(state.status==='cancelled')throw new StoppedError('Assignment cancelled after its owned process tree drained.');
    if(state.status!=='exited')throw new Error(`Assignment stopped: ${state.status}. Existing work is preserved.`);
    const outcome=readJson<{code:number|null;error:string|null}>(result);
    const output={stdout:existsSync(stdout)?readFileSync(stdout,'utf8'):'',stderr:existsSync(stderr)?readFileSync(stderr,'utf8'):''};
    if(outcome?.code!==0||outcome.error)throw new CommandFailedError(`Command failed; inspect ${stdout} and ${stderr}.`);
    return output;
  }finally{command.signal?.removeEventListener('abort',abort);try{supervisor?.finish();}catch{/* Keep process cleanup authoritative. */}}
}

/** Refuse replacement until the native host confirms job drain, including owner-loss cleanup. */
export async function reconcileProcess(directory:string):Promise<void>{
  if(!existsSync(join(directory,'command.json')))return; // A reservation with no command manifest launched no process.
  const deadline=Date.now()+15000;
  while(Date.now()<deadline){
    const receipt=readJson<Receipt>(join(directory,'process.json'));
    if(receipt?.drained)return;
    const manifest=readJson<{jobName:string}>(join(directory,'command.json'));
    if(receipt&&manifest?.jobName&&/^Local\\Barracks-[a-f0-9-]+$/.test(manifest.jobName)){
      const script=`Add-Type -Path '${resolve('server/windows/OwnedJob.cs').replaceAll("'","''")}'; [Barracks.Runtime.OwnedJob]::Exists('${manifest.jobName}')`;
      const exists=execFileSync('powershell.exe',['-NoProfile','-Command',script],{encoding:'utf8',windowsHide:true,timeout:10000}).trim();
      if(exists==='False'){
        writeFileSync(join(directory,'process.json'),JSON.stringify({...receipt,status:'owner-lost',drained:true,remainingMembers:[],reconciledBy:'kernel-job-absent',endedAt:new Date().toISOString()}));return;
      }
    }
    await delay(100);
  }
  throw new Error('Owned process cleanup is not confirmed. Inspect the retained process receipt before resuming.');
}
