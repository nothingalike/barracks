import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve,join,sep} from 'node:path';
import {randomUUID} from 'node:crypto';
import {runOwned} from '../server/process.ts';
import {EvidenceLedger} from '../server/evidence-ledger.ts';
import {prepare,candidate,inventory} from '../server/projects.ts';
import assert from 'node:assert/strict';

// Explicit operator qualification command; this is not a workflow host executor.
const [proofArg,taskId]=process.argv.slice(2);if(!proofArg||!taskId||!/^[a-f0-9-]{36}$/.test(taskId))throw Error('Supply the disposable Saltwake build-proof folder and task UUID.');
const proof=resolve(proofArg);if(!proof.startsWith(resolve('.state/saltwake-build-proof')+sep))throw Error('The observer accepts only Barracks disposable build proofs.');
const result=JSON.parse(readFileSync(join(proof,'result.json'),'utf8')),context=prepare({id:taskId,projectId:'saltwake-build-copy'});
if(resolve(context.project.path)!==join(proof,'source')||candidate(context.root)!==result.candidate)throw Error('Disposable source identity/candidate changed.');
const before=inventory(context.workspace),id=randomUUID(),root=join(proof,'host-observer-'+id),captures=join(context.workspace,'.state','render-'+id);mkdirSync(root,{recursive:true});
const helper=join(root,'helper.mjs');writeFileSync(helper,`import http from 'node:http';import net from 'node:net';import {readFileSync} from 'node:fs';import {resolve,extname,sep} from 'node:path';import {spawn} from 'node:child_process';
const root=process.cwd(),dist=resolve('.state/site');const server=http.createServer((request,response)=>{try{const url=new URL(request.url,'http://127.0.0.1'),file=resolve(dist,'.'+decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname));if(!file.startsWith(dist+sep))throw Error('outside');response.setHeader('Content-Type',({'.wasm':'application/wasm','.js':'text/javascript','.html':'text/html','.png':'image/png','.json':'application/json'})[extname(file)]??'application/octet-stream');response.end(readFileSync(file));}catch{response.writeHead(404);response.end();}});await new Promise((done,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',done)});const probe=net.createServer();await new Promise(done=>probe.listen(0,'127.0.0.1',done));const debug=probe.address().port;await new Promise(done=>probe.close(done));
const child=spawn(process.execPath,['tools/browser-combat-header-check.mjs',root,String(server.address().port),String(debug),resolve('.state/chrome-${id}'),${JSON.stringify(captures)},${JSON.stringify(result.head)},dist,'false'],{windowsHide:true,stdio:'inherit'});const code=await new Promise((done,reject)=>{child.once('error',reject);child.once('exit',done)});await new Promise(done=>server.close(done));process.exitCode=code??1;
`);
try{const output=await runOwned({executable:process.execPath,args:[helper],cwd:context.workspace,node:process.execPath,directory:join(root,'command'),timeoutMs:180000,supervision:{workspace:context.workspace,warningAfterMs:60000}}),report=JSON.parse(readFileSync(join(captures,'result.json'),'utf8'));assert.equal(report.status,'PASS');assert.equal(candidate(context.root),result.candidate);assert.deepEqual(inventory(context.workspace),before);
  const receipt=new EvidenceLedger(id).command(result.candidate,{executable:process.execPath,args:[helper],platform:'Windows headless Chromium SwiftShader; explicit standalone owned observer'},join(root,'command'),[{name:'Packaged Wasm',path:join(context.workspace,'.state/site',report.packageWasm),role:'build'},{name:'Observer helper',path:helper,role:'helper'},{name:'Render harness',path:join(context.workspace,'tools/browser-combat-header-check.mjs'),role:'helper'},{name:'Render report',path:join(captures,'result.json'),role:'capture'}],'browser');
  writeFileSync(join(root,'result.json'),JSON.stringify({status:'passed',candidate:result.candidate,sourceCommit:result.head,root,report,output,receipt,artifacts:captures,execution:'Explicit standalone owned observer outside the Codex command sandbox; no automatic workflow host permission.',limitations:'Bounded SwiftShader Chromium HUD/header proof; no physical GPU/input/performance or live publication.'},null,2));console.log('PASS '+root);
}catch(error){writeFileSync(join(root,'result.json'),JSON.stringify({status:'failed',error:String(error)},null,2));throw error;}
