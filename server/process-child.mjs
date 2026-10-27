import {spawn} from 'node:child_process';
import {readFileSync,writeFileSync,appendFileSync} from 'node:fs';
const config=JSON.parse(readFileSync(process.argv[2],'utf8'));
const env={...process.env};for(const [name,value] of Object.entries(config.env??{})){const previous=Object.keys(env).find(key=>key.toLowerCase()===name.toLowerCase());if(previous)delete env[previous];env[name]=value;}
const child=spawn(config.executable,config.args,{cwd:config.cwd,env,windowsHide:true,shell:false,stdio:['pipe','pipe','pipe']});
let error=null, bytes=0;
child.once('spawn',()=>writeFileSync(config.childReceipt,JSON.stringify({pid:child.pid,startedAt:new Date().toISOString()})));
child.stdin.on('error',()=>{});
child.stdin.end(config.input??'');
for(const [stream,file] of [[child.stdout,config.stdout],[child.stderr,config.stderr]]) stream.on('data',chunk=>{
  bytes+=chunk.length;
  if(bytes>config.maxOutputBytes){writeFileSync(config.result,JSON.stringify({code:null,error:'Output limit exceeded.'}));process.exit(1);}
  appendFileSync(file,chunk);
});
child.once('error',failure=>{error=failure.message;});
child.once('close',code=>{writeFileSync(config.result,JSON.stringify({code,error,endedAt:new Date().toISOString()}));process.exitCode=error||code!==0?1:0;});
