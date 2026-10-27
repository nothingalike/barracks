import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {projectSchema,prepare,candidate,inventory} from '../server/projects.ts';
import {projectEnvironment,runVerification} from '../server/project-command.ts';
import {prepareReview,assertReviewCandidate} from '../server/review-evidence.ts';

test('one command policy preserves explicit unlimited/runtime/environment settings across isolated workspaces',async()=>{
  const root=resolve('.state/command-policy-tests',randomUUID()),source=join(root,'source');mkdirSync(source,{recursive:true});writeFileSync(join(source,'lib.rs'),'pub fn value()->u8{1}\n');
  const project=projectSchema.parse({id:'command-policy',name:'Command policy',kind:'fixture',path:source,reviewChecklist:'Preserve source.',environment:{CARGO_TARGET_DIR:'{workspace}/.state/cargo',RUSTFLAGS:'-Dwarnings'}});
  const settings=join(root,'projects.json'),previous=process.env.BARRACKS_PROJECTS_PATH;writeFileSync(settings,JSON.stringify({codexExecutable:process.execPath,projects:[project]}));process.env.BARRACKS_PROJECTS_PATH=settings;
  try{
    const context=prepare({id:randomUUID(),projectId:project.id}),tree=candidate(context.root),before=inventory(context.workspace),snapshot=prepareReview(context,randomUUID(),tree);
    for(const workspace of [context.workspace,snapshot.directory]){
      const command={executable:'node',args:['--test'],sandbox:'workspace-write' as const,timeoutMs:null,env:{rustflags:'-Dnew'}};
      await runVerification({...context,workspace},command,join(root,'receipt'),new AbortController().signal,async owned=>{
        assert.equal(owned.timeoutMs,null);assert.equal(owned.cwd,workspace);assert.equal(owned.env!.CARGO_TARGET_DIR,workspace+'/.state/cargo');assert.equal(owned.env!.rustflags,'-Dnew');assert.equal('RUSTFLAGS' in owned.env!,false);assert.ok(owned.supervision);
        mkdirSync(join(workspace,'.state','cargo'),{recursive:true});writeFileSync(join(workspace,'.state','cargo','artifact.exe'),'generated binary');return {stdout:'real process result is retained by the execution module',stderr:''};
      });
    }
    assert.equal(candidate(context.root),tree);assertReviewCandidate(snapshot.directory,tree);assert.deepEqual(inventory(context.workspace),before);
    await runVerification(context,{executable:'node',args:[],sandbox:'read-only'},join(root,'bounded'),new AbortController().signal,async command=>{assert.equal(command.timeoutMs,60000);return {stdout:'',stderr:''};});
    await runVerification(context,{executable:'node',args:[],sandbox:'read-only',timeoutMs:300000},join(root,'explicit'),new AbortController().signal,async command=>{assert.equal(command.timeoutMs,300000);return {stdout:'',stderr:''};});
    assert.deepEqual(projectEnvironment(project,'candidate','node'),{CARGO_TARGET_DIR:'candidate/.state/cargo',RUSTFLAGS:'-Dwarnings'});
    assert.equal(readFileSync(join(source,'lib.rs'),'utf8'),'pub fn value()->u8{1}\n');
  }finally{process.env.BARRACKS_PROJECTS_PATH=previous;}
});
