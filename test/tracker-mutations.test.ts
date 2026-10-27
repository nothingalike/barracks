import test,{mock} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {syncBuiltinESMExports} from 'node:module';
import {mkdirSync,writeFileSync,readFileSync,existsSync,symlinkSync,readdirSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {TrackerMutations} from '../server/tracker-mutations.ts';

function fixture(){const root=resolve('.state/tracker-journal-tests',randomUUID());mkdirSync(join(root,'.workspace'),{recursive:true});mkdirSync(join(root,'project'));writeFileSync(join(root,'.workspace','pm-toolbox.yml'),'paths:\n  project: project\n');writeFileSync(join(root,'project','story.md'),'original story');writeFileSync(join(root,'project','index.md'),'original index');return root;}

test('failed CLI staging is retried from canonical preimages and operation keys deduplicate publication',()=>{
  const root=fixture();let staged=0;
  const invoke=(stage:string,args:string[]):any=>{
    if(args[0]==='barracks-layout')return {paths:{project:'project'}};
    if(args[0]==='workspace')return {valid:true,issues:[]};
    if(args[0]==='index'){writeFileSync(join(stage,'project','index.md'),'new index');return {};}
    staged++;assert.notEqual(stage,root);assert.equal(readFileSync(join(stage,'project','story.md'),'utf8'),'original story');writeFileSync(join(stage,'project','new.md'),'new story');
    if(staged===1){writeFileSync(join(stage,'project','story.md'),'failed stage side effect');throw Error('EPERM: simulated CLI atomic replacement failure.');}
    return {id:'NEW',path:join(stage,'project','new.md')};
  };
  const adapter=new TrackerMutations(root,invoke),request={key:'create-new',args:['story','create','NEW']};const result=adapter.run(request) as {id:string;path:string};assert.equal(result.path,join(root,'project','new.md'));assert.equal(readFileSync(join(root,'project','story.md'),'utf8'),'original story');assert.equal(readFileSync(join(root,'project','index.md'),'utf8'),'new index');assert.equal(staged,2);assert.deepEqual(adapter.run(request),result);assert.equal(staged,2);assert.throws(()=>adapter.run({...request,args:['story','create','changed']}),/different intent/);
});

for(const mode of ['replay','user-edit'] as const)test('tracker journal after canonical effect: '+mode,()=>{
  const root=fixture();let executions=0,writes=0;
  const invoke=(stage:string,args:string[]):any=>{if(args[0]==='barracks-layout')return {paths:{project:'project'}};if(args[0]==='workspace')return {valid:true,issues:[]};if(args[0]==='index'){writeFileSync(join(stage,'project','index.md'),'accepted index');return {};}
    executions++;writeFileSync(join(stage,'project','story.md'),'accepted story');return {id:'STORY'};};
  const original=fs.renameSync,intercept=mock.method(fs,'renameSync',(from:fs.PathLike,to:fs.PathLike)=>{original(from,to);if(String(to)===join(root,'project','index.md')&&++writes===1)throw Error('Injected crash after the canonical effect.');});syncBuiltinESMExports();
  const request={key:'move-story',args:['story','move','STORY']};
  try{
    assert.throws(()=>new TrackerMutations(root,invoke).run(request),/Injected crash/);assert.throws(()=>TrackerMutations.assertReadable(root),/pending/);
    assert.equal(readFileSync(join(root,'project','story.md'),'utf8'),'original story','The crash interrupted a multi-file publication before its remaining effect.');
    if(mode==='user-edit'){writeFileSync(join(root,'project','index.md'),'user index edit');assert.throws(()=>new TrackerMutations(root,invoke).reconcile(),/outside its recorded/);assert.equal(readFileSync(join(root,'project','index.md'),'utf8'),'user index edit');}
    else{assert.deepEqual(new TrackerMutations(root,invoke).run(request),{id:'STORY'});TrackerMutations.assertReadable(root);assert.equal(executions,1);assert.equal(writes,1);assert.equal(readFileSync(join(root,'project','story.md'),'utf8'),'accepted story');assert.equal(readFileSync(join(root,'project','index.md'),'utf8'),'accepted index');}
  }finally{intercept.mock.restore();syncBuiltinESMExports();}
});

test('the tracker journal fences a second write coordinator through the entire staged operation',()=>{
  const root=fixture();let secondWrote=false;
  const invoke=(stage:string,args:string[]):any=>{if(args[0]==='barracks-layout')return {paths:{project:'project'}};if(args[0]==='workspace')return {valid:true,issues:[]};if(args[0]==='index')return {};
    assert.throws(()=>new TrackerMutations(root,()=>{secondWrote=true;return {};}).run({args:['story','move','OTHER']}),/busy|locked/);writeFileSync(join(stage,'project','story.md'),'one authority');return {};};
  new TrackerMutations(root,invoke).run({args:['story','move','STORY']});assert.equal(secondWrote,false);assert.equal(readFileSync(join(root,'project','story.md'),'utf8'),'one authority');assert.equal(existsSync(join(root,'.workspace','barracks-operations.sqlite')),true);
});
test('dangling journal links are refused before any file outside the tracker can be created',()=>{
  const root=fixture(),outside=join(root,'..',randomUUID()+'.sqlite');symlinkSync(outside,join(root,'.workspace','barracks-operations.sqlite'),'file');assert.throws(()=>new TrackerMutations(root,()=>({})).run({args:['story','move','STORY']}),/link/);assert.equal(existsSync(outside),false);
});
for(const mode of ['cleanup','foreign-temp'] as const)test('tracker acknowledgment preserves recoverable cleanup: '+mode,()=>{
  const root=fixture();let executions=0,failed=false;const leftovers:string[]=[];
  const invoke=(stage:string,args:string[]):any=>{if(args[0]==='barracks-layout')return {paths:{project:'project'}};if(args[0]==='workspace')return {valid:true};if(args[0]==='index')return {};executions++;writeFileSync(join(stage,'project','story.md'),'accepted story');return {};};
  const rename=fs.renameSync,unlink=fs.unlinkSync,renaming=mock.method(fs,'renameSync',(from:fs.PathLike,to:fs.PathLike)=>{rename(from,to);if(String(to)===join(root,'project','story.md')){writeFileSync(from,readFileSync(to));leftovers.push(String(from));}}),removing=mock.method(fs,'unlinkSync',(file:fs.PathLike)=>{if(leftovers.includes(String(file))&&!failed){failed=true;throw Error('Injected cleanup failure after canonical publication.');}unlink(file);});syncBuiltinESMExports();
  try{const request={key:'cleanup-proof',args:['story','move','STORY']};assert.throws(()=>new TrackerMutations(root,invoke).run(request),/cleanup failure/);assert.throws(()=>TrackerMutations.assertReadable(root),/pending/);
    if(mode==='foreign-temp'){writeFileSync(leftovers[0]!,'foreign edit');assert.throws(()=>new TrackerMutations(root,invoke).reconcile(),/cleanup held/);assert.equal(readFileSync(leftovers[0]!,'utf8'),'foreign edit');}
    else{new TrackerMutations(root,invoke).reconcile();TrackerMutations.assertReadable(root);assert.equal(readdirSync(join(root,'project')).some(name=>name.endsWith('.tmp')),false);assert.equal(executions,1);}
  }finally{renaming.mock.restore();removing.mock.restore();syncBuiltinESMExports();}
});
test('externally managed tracker mutations cannot reach the staging CLI action',()=>{
  const root=fixture();let mutated=false;
  for(const github of [{mode:'managed'},{mode:'links',features:{create_issues:true}}]){
    const invoke=(_stage:string,args:string[])=>{if(args[0]==='barracks-layout')return {paths:{project:'project'},github};mutated=true;return {};};assert.throws(()=>new TrackerMutations(root,invoke).run({args:['story','create','REMOTE']}),/external GitHub/);
  }assert.equal(mutated,false);assert.equal(readFileSync(join(root,'project','story.md'),'utf8'),'original story');
});
test('mixed-case reserved tracker layouts cannot target Git metadata or the operation journal',()=>{
  for(const path of ['.GIT','.Git/subfolder','.WORKSPACE']){const root=fixture();let called=false;const coordinator=new TrackerMutations(root,(_root,args)=>{if(args[0]==='barracks-layout')return {paths:{project:path}};called=true;return {};});assert.throws(()=>coordinator.run({args:['story','move','STORY']}),/contained source-independent/);assert.equal(called,false);}
});
