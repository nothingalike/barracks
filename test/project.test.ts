import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {resolve,join} from 'node:path';
import {prepare,projectsSchema,candidate,checkProtected} from '../server/projects.ts';
import {Store} from '../server/store.ts';
test('configured local repository is copied at its committed revision and never receives task writes',()=>{
  const root=resolve('.state/project-tests',randomUUID()),source=join(root,'source');mkdirSync(source,{recursive:true});
  const git=(args:string[],input?:string)=>execFileSync('git',['-c',`safe.directory=${source.replaceAll('\\','/')}`,'-C',source,...args],{input,encoding:'utf8',windowsHide:true}).trim();
  git(['init','--initial-branch=main']);
  const blob=git(['hash-object','-w','--stdin'],'export const answer = 1;\n');
  const tree=git(['mktree'],`100644 blob ${blob}\tanswer.mjs\n`);
  const commit=git(['hash-object','-t','commit','-w','--stdin'],`tree ${tree}\nauthor Fixture <fixture@invalid> 0 +0000\ncommitter Fixture <fixture@invalid> 0 +0000\n\nfixture\n`);
  git(['update-ref','refs/heads/main',commit]);git(['read-tree','--reset','-u','HEAD']);
  const original=readFileSync(join(source,'answer.mjs'));
  const config=projectsSchema.parse({codexExecutable:process.execPath,attemptTimeoutMs:1000,projects:[{id:'local-copy',name:'Local copy',kind:'repository',path:source,verify:[{executable:'node',args:['--test']}],reviewChecklist:'Inspect the change.'}]});
  const store=new Store(':memory:');try{
    const task=store.create({title:'Change answer',execution:'codex',projectId:'local-copy'});
    const context=prepare(task,config);
    assert.match(readFileSync(join(context.workspace,'answer.mjs'),'utf8'),/^export const answer = 1;\r?\n$/);
    assert.equal(candidate(context.root),tree);
    writeFileSync(join(context.workspace,'answer.mjs'),'export const answer = 2;\n');
    assert.notEqual(candidate(context.root),tree);
    assert.deepEqual(readFileSync(join(source,'answer.mjs')),original);
    assert.equal(git(['rev-parse','HEAD']),commit);
  }finally{store.close();}
});
test('unconfigured projects and protected-source changes fail closed',()=>{
  const settings=projectsSchema.parse({codexExecutable:process.execPath,attemptTimeoutMs:1000,projects:[]});
  const store=new Store(':memory:');try{
    const task=store.create({title:'Unknown project',execution:'codex',projectId:'unknown'});
    assert.throws(()=>prepare(task,settings),/configured project/);
    assert.throws(()=>checkProtected({project:{protectedPaths:['README.md']},baseline:{'README.md':'original'}},{'README.md':'changed'}),/Protected source/);
  }finally{store.close();}
});
