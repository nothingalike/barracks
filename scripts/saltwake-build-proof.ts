import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {projectSchema,prepare,candidate,runtimeSettings,inventory} from '../server/projects.ts';
import {runVerification} from '../server/project-command.ts';
import assert from 'node:assert/strict';

const reference=resolve('C:/Users/johns/source/repos/Saltwake-rust'),root=resolve('.state/saltwake-build-proof',randomUUID()),source=join(root,'source');mkdirSync(source,{recursive:true});
const g=(args:string[])=>execFileSync('git',['-c','safe.directory='+reference.replaceAll('\\','/'),'-C',reference,...args],{windowsHide:true,encoding:'utf8',stdio:'pipe'}).trim();
const head=g(['rev-parse','HEAD']),status=g(['status','--porcelain=v1','-uall']),archive=join(root,'reference.tar');g(['archive','--format=tar','--output='+archive,head]);execFileSync('tar.exe',['-xf',archive,'-C',source],{windowsHide:true,stdio:'pipe'});
const project=projectSchema.parse({id:'saltwake-build-copy',name:'Disposable Saltwake build copy',kind:'fixture',path:source,reviewChecklist:'Source remains unchanged. Only bounded native/Wasm compilation and tests are claimed.',environment:{CARGO_TARGET_DIR:'{workspace}/.state/cargo',CARGO_BUILD_JOBS:'2',CARGO_PROFILE_DEV_OPT_LEVEL:'0'}}),settings=join(root,'projects.json');writeFileSync(settings,JSON.stringify({...runtimeSettings(),projects:[project]}));process.env.BARRACKS_PROJECTS_PATH=settings;
const context=prepare({id:randomUUID(),projectId:project.id}),tree=candidate(context.root),before=inventory(context.workspace),receipts:unknown[]=[];
const commands=[['test','--offline','--locked','--workspace','--lib','--features','verification'],['build','--offline','--locked','--features','verification'],['build','--offline','--locked','--target','wasm32-unknown-unknown','--features','verification']];
try{for(const [index,args] of commands.entries()){console.log('Saltwake disposable command '+index+': cargo '+args.join(' ')+'; evidence '+root);const started=Date.now(),result=await runVerification(context,{executable:'C:/Users/johns/.cargo/bin/cargo.exe',args,sandbox:'workspace-write',timeoutMs:null},join(root,'command-'+index),new AbortController().signal);receipts.push({args,elapsedMs:Date.now()-started,...result});assert.equal(candidate(context.root),tree);assert.deepEqual(inventory(context.workspace),before);}
  assert.equal(g(['rev-parse','HEAD']),head);assert.equal(g(['status','--porcelain=v1','-uall']),status);
  const paths=['.state/cargo/debug/saltwake-client.exe','.state/cargo/wasm32-unknown-unknown/debug/saltwake-client.wasm'];const artifacts=paths.map(path=>({path:join(context.workspace,path),sha256:createHash('sha256').update(readFileSync(join(context.workspace,path))).digest('hex')}));
  writeFileSync(join(root,'result.json'),JSON.stringify({status:'passed',reference,head,candidate:tree,receipts,artifacts,limitations:'Disposable HEAD snapshot; no dirty work imported, renderer/input/browser/physical acceptance or external preview publication.'},null,2));console.log('PASS '+root);
}catch(error){writeFileSync(join(root,'result.json'),JSON.stringify({status:'failed',reference,head,candidate:tree,error:String(error),receipts},null,2));throw error;}
