import {existsSync,readdirSync,statSync,readFileSync,writeFileSync,renameSync} from 'node:fs';
import {join,relative} from 'node:path';
import {createHash} from 'node:crypto';
import {StringDecoder} from 'node:string_decoder';
import type {AgentActivity} from '../shared/supervision.ts';

export interface SupervisionOptions {workspace:string;warningAfterMs:number;maxRepeatedFailures?:number}
function workspaceStamp(root:string){
  const entries:string[]=[];
  const visit=(directory:string)=>{for(const item of readdirSync(directory,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){
    if(['.git','node_modules','.state'].includes(item.name)||item.isSymbolicLink())continue;
    const file=join(directory,item.name);if(item.isDirectory())visit(file);else if(item.isFile()){const info=statSync(file);entries.push(relative(root,file)+':'+info.size+':'+info.mtimeMs);}
  }};visit(root);return createHash('sha256').update(entries.join('\n')).digest('hex');
}

/** Records observations, not proof of useful progress. Inactivity only raises attention. */
export class AgentSupervisor {
  private options:SupervisionOptions;private directory:string;private stamp='';private last:number;private started:number;
  private stdoutBytes=0;private stderrBytes=0;private partial='';private decoder=new StringDecoder('utf8');private failure='';
  private state:AgentActivity;
  constructor(directory:string,options:SupervisionOptions,now=Date.now()){
    this.directory=directory;this.options=options;this.started=this.last=now;
    this.state={startedAt:new Date(now).toISOString(),lastActivityAt:new Date(now).toISOString(),elapsedMs:0,idleMs:0,outputEvents:0,workspaceChanges:0,completedCommands:0,repeatedFailures:0,attention:false,ended:false};
    try{this.stamp=workspaceStamp(options.workspace);}catch(error){this.state.observationError=String(error);}
  }
  private resetFailures(){this.failure='';this.state.repeatedFailures=0;}
  sample(now=Date.now()):AgentActivity{
    try{
      const stamp=workspaceStamp(this.options.workspace);
      if(stamp!==this.stamp){this.stamp=stamp;this.state.workspaceChanges++;this.last=now;this.resetFailures();}
      delete this.state.observationError;
    }catch(error){this.state.observationError=String(error);}
    const stdout=join(this.directory,'stdout.log'),stderr=join(this.directory,'stderr.log');
    if(existsSync(stdout)){
      const bytes=readFileSync(stdout);if(bytes.length>this.stdoutBytes){
        this.last=now;this.partial+=this.decoder.write(bytes.subarray(this.stdoutBytes));this.stdoutBytes=bytes.length;
        const lines=this.partial.split('\n');this.partial=lines.pop()??'';
        for(const line of lines){
          let event:any;try{event=JSON.parse(line);}catch{continue;}
          this.state.outputEvents++;
          if(event.type!=='item.completed')continue;
          if(event.item?.type==='file_change'){this.resetFailures();continue;}
          if(event.item?.type!=='command_execution')continue;
          this.state.completedCommands++;
          if(typeof event.item.exit_code!=='number'||event.item.exit_code===0){this.resetFailures();continue;}
          const fingerprint=createHash('sha256').update(JSON.stringify([event.item.command,event.item.exit_code,event.item.aggregated_output])).digest('hex');
          this.state.repeatedFailures=fingerprint===this.failure?this.state.repeatedFailures+1:1;this.failure=fingerprint;
        }
      }
    }
    if(existsSync(stderr)){const size=statSync(stderr).size;if(size>this.stderrBytes){this.stderrBytes=size;this.last=now;}}
    this.state.lastActivityAt=new Date(this.last).toISOString();this.state.elapsedMs=now-this.started;this.state.idleMs=now-this.last;
    this.state.reason=this.state.repeatedFailures>=(this.options.maxRepeatedFailures??3)?'repeated-failure':this.state.idleMs>=this.options.warningAfterMs?'inactivity':undefined;
    this.state.attention=!!this.state.reason;
    this.persist();return {...this.state};
  }
  finish(){this.sample();this.state.ended=true;this.persist();}
  private persist(){try{const file=join(this.directory,'activity.json');writeFileSync(file+'.tmp',JSON.stringify(this.state));renameSync(file+'.tmp',file);}catch{/* Monitoring must not terminate a worker. */}}
}
