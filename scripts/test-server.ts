import {spawn,type ChildProcess} from 'node:child_process';
import {mkdirSync,appendFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {randomUUID} from 'node:crypto';
export class TestServer {
  process:ChildProcess|null=null;alive=false;
  private instance='';
  readonly directory:string;readonly port:number;
  constructor(directory:string,port:number){this.directory=directory;this.port=port;}
  get url(){return `http://127.0.0.1:${this.port}`;}
  async start(){
    if(this.alive)throw new Error('The owned test server is already alive.');
    mkdirSync(this.directory,{recursive:true});
    this.instance=randomUUID();
    const child=spawn(process.execPath,['--experimental-strip-types',resolve('server/index.ts')],{cwd:process.cwd(),windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,BARRACKS_PORT:String(this.port),BARRACKS_DB_PATH:join(this.directory,'state.db'),BARRACKS_INSTANCE_ID:this.instance}});
    this.process=child;this.alive=true;child.once('exit',()=>{this.alive=false;});child.once('error',()=>{this.alive=false;});
    child.stdout!.on('data',data=>appendFileSync(join(this.directory,'server.log'),data));child.stderr!.on('data',data=>appendFileSync(join(this.directory,'server.log'),data));
    const deadline=Date.now()+15000;
    while(Date.now()<deadline){if(!this.alive)throw new Error('Owned test server exited; inspect its server.log.');try{await this.api('/snapshot');return;}catch{await delay(100);}}
    throw new Error('Owned test server readiness timed out; its existing process is retained until cleanup.');
  }
  async api(path:string,body?:unknown):Promise<any>{const response=await fetch(this.url+'/api'+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json','X-Barracks-Test-Instance':this.instance},body:body===undefined?undefined:JSON.stringify(body)});if(response.headers.get('x-barracks-instance')!==this.instance)throw new Error('The port does not belong to this test-server instance.');const value=await response.json();if(!response.ok)throw new Error(value.error??JSON.stringify(value));return value;}
  async stop(force=false){
    if(!this.process||!this.alive)return;
    const exited=new Promise<void>(accept=>this.process!.once('exit',()=>accept()));
    this.process.kill(force?'SIGKILL':'SIGTERM');await exited;
  }
}
export async function waitFor<T>(read:()=>Promise<T>|T,accept:(value:T)=>boolean,timeoutMs=240000):Promise<T>{const deadline=Date.now()+timeoutMs;while(Date.now()<deadline){const value=await read();if(accept(value))return value;await delay(200);}throw new Error('Expected test state was not reached before the deadline.');}
