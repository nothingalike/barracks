import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {projectSchema,prepare,candidate,inventory} from '../server/projects.ts';
import {runVerification} from '../server/project-command.ts';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createHash} from 'node:crypto';

const [proofArg,taskId]=process.argv.slice(2);if(!proofArg||!taskId)throw Error('Supply the disposable build proof folder and its task UUID.');
const proof=resolve(proofArg),manifest=JSON.parse(readFileSync(resolve('.state/tasks',taskId,'workspace.json'),'utf8')),project=projectSchema.parse(manifest.projectSnapshot);
project.tools=[{name:'wasm-bindgen.exe',path:'C:/Users/johns/AppData/Local/trunkrs/trunk/cache/wasm-bindgen-0.2.129/wasm-bindgen.exe'}].map(tool=>({...tool,sha256:createHash('sha256').update(readFileSync(tool.path)).digest('hex')}));
if(resolve(project.path)!==join(proof,'source'))throw Error('Only the selected disposable build snapshot can be rendered.');
const attempt=randomUUID(),context={...prepare({id:taskId,projectId:project.id}),project},tree=candidate(context.root),before=inventory(context.workspace),root=join(proof,'render-'+attempt);mkdirSync(root,{recursive:true});
const settings=join(proof,'projects.json');process.env.BARRACKS_PROJECTS_PATH=settings;
const result=JSON.parse(readFileSync(join(proof,'result.json'),'utf8'));
const helper=join(context.workspace,'.state/render-proof.mjs');mkdirSync(join(context.workspace,'.state'),{recursive:true});
writeFileSync(helper,`import http from 'node:http';import net from 'node:net';import {readFileSync} from 'node:fs';import {resolve,extname,sep} from 'node:path';import {spawn} from 'node:child_process';
const root=process.cwd(),dist=resolve('.state/site');const server=http.createServer((request,response)=>{try{const url=new URL(request.url,'http://127.0.0.1'),file=resolve(dist,'.'+decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname));if(!file.startsWith(dist+sep))throw Error('outside');response.setHeader('Content-Type',({'.wasm':'application/wasm','.js':'text/javascript','.html':'text/html','.png':'image/png','.json':'application/json'})[extname(file)]??'application/octet-stream');response.end(readFileSync(file));}catch{response.writeHead(404);response.end();}});await new Promise((done,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',done)});const probe=net.createServer();await new Promise(done=>probe.listen(0,'127.0.0.1',done));const debug=probe.address().port;await new Promise(done=>probe.close(done));
const child=spawn(process.execPath,['tools/browser-combat-header-check.mjs',root,String(server.address().port),String(debug),resolve('.state/chrome-${attempt}'),resolve('.state/render-${attempt}'),${JSON.stringify(result.head)},dist,'false'],{windowsHide:true,stdio:'inherit'});const code=await new Promise((done,reject)=>{child.once('error',reject);child.once('exit',done)});await new Promise(done=>server.close(done));process.exitCode=code??1;
`);
try{
  const domain=await runVerification(context,{executable:'C:/Users/johns/.cargo/bin/cargo.exe',args:['test','--offline','--locked','--workspace','--exclude','saltwake-client'],sandbox:'workspace-write',timeoutMs:null},join(root,'domain'),new AbortController().signal);
  const build=await runVerification(context,{executable:'C:/Users/johns/.cargo/bin/trunk.exe',args:['build','--features','verification','--dist','.state/site'],sandbox:'workspace-write',env:{CARGO_NET_OFFLINE:'true',NO_COLOR:'true'},timeoutMs:null},join(root,'package'),new AbortController().signal);
  console.log('Disposable Trunk package ready.');
  const render=await runVerification(context,{executable:'node',args:['.state/render-proof.mjs'],sandbox:'workspace-write',timeoutMs:180000},join(root,'browser'),new AbortController().signal);
  assert.equal(candidate(context.root),tree);assert.deepEqual(inventory(context.workspace),before);
  const observations=JSON.parse(readFileSync(join(context.workspace,'.state/render-'+attempt+'/result.json'),'utf8'));assert.equal(observations.status,'PASS');
  writeFileSync(join(root,'helper.mjs'),readFileSync(helper));writeFileSync(join(root,'result.json'),JSON.stringify({status:'passed',candidate:tree,sourceCommit:result.head,domain,build,render,observations,helper:join(root,'helper.mjs'),artifacts:join(context.workspace,'.state/render-'+attempt),limitations:'SwiftShader Chromium HUD/header rendering in a disposable snapshot; no physical GPU, controller/mobile input, performance or live publication.'},null,2));console.log('PASS '+root);
}catch(error){writeFileSync(join(root,'result.json'),JSON.stringify({status:'failed',error:String(error)},null,2));throw error;}
