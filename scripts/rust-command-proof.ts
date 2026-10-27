import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import {projectSchema,prepare,candidate,inventory} from '../server/projects.ts';
import {runVerification} from '../server/project-command.ts';

const root=resolve('.state/rust-command-proof',randomUUID()),source=join(root,'source');mkdirSync(join(source,'src'),{recursive:true});
writeFileSync(join(source,'Cargo.toml'),'[package]\nname="barracks-rust-proof"\nversion="0.1.0"\nedition="2024"\n[lib]\ncrate-type=["rlib","cdylib"]\n');
writeFileSync(join(source,'Cargo.lock'),'version = 4\n\n[[package]]\nname = "barracks-rust-proof"\nversion = "0.1.0"\n');
writeFileSync(join(source,'src/lib.rs'),'pub fn add(a: i32, b: i32) -> i32 { a + b }\n#[cfg(test)] mod tests { #[test] fn behavior() { assert_eq!(super::add(20,22),42); } }\n');
const project=projectSchema.parse({id:'rust-proof',name:'Rust proof',kind:'fixture',path:source,reviewChecklist:'Actual compiler and declared native tests pass.',environment:{CARGO_TARGET_DIR:'{workspace}/.state/cargo'}}),settings=join(root,'projects.json');
const original=JSON.parse(readFileSync('config/projects.json','utf8'));writeFileSync(settings,JSON.stringify({...original,projects:[project]}));process.env.BARRACKS_PROJECTS_PATH=settings;
const context=prepare({id:randomUUID(),projectId:project.id}),before=inventory(context.workspace),tree=candidate(context.root),receipts:unknown[]=[];
const commands=[
  {executable:'node',args:['-e',"const t=setInterval(()=>console.log('owned build heartbeat'),5000);setTimeout(()=>{clearInterval(t);console.log('long command finished')},65000)"],sandbox:'read-only' as const,timeoutMs:null},
  {executable:'C:/Users/johns/.cargo/bin/cargo.exe',args:['test','--offline','--locked','--all-targets','--all-features'],sandbox:'workspace-write' as const,timeoutMs:null},
  {executable:'C:/Users/johns/.cargo/bin/cargo.exe',args:['build','--offline','--locked','--target','wasm32-unknown-unknown'],sandbox:'workspace-write' as const,timeoutMs:null}
];
for(const [index,command] of commands.entries()){
  console.log('Running: '+command.executable+' '+command.args.slice(0,3).join(' '));const started=Date.now();
  try{const output=await runVerification(context,command,join(root,'command-'+index),new AbortController().signal);const elapsedMs=Date.now()-started;if(index===0)assert.ok(elapsedMs>=65000);receipts.push({command,elapsedMs,...output});assert.deepEqual(inventory(context.workspace),before);assert.equal(candidate(context.root),tree);}
  catch(error){writeFileSync(join(root,'result.json'),JSON.stringify({status:'failed',error:String(error),root,receipts},null,2));throw error;}
}
writeFileSync(join(root,'result.json'),JSON.stringify({status:'passed',root,tree,receipts,limitations:'Dependency-free native test and Wasm library build; no Bevy client, rendered/native input, browser or physical-device qualification.'},null,2));console.log('PASS: >60s supervised command, actual native Rust test and actual Wasm build. Evidence: '+root);
