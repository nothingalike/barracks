import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync,readFileSync,symlinkSync,readdirSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {stageTransfer,verifyTransfer,reconcileTransfer} from '../server/transfer-manifest.ts';
import {projectSchema} from '../server/projects.ts';
import {Pmt} from '../server/pmt.ts';

test('whole-team import stays paused and preserves staged, unstaged, untracked and retained evidence separately',()=>{
  const root=resolve('.state/transfer-tests',randomUUID()),source=join(root,'source'),tracker=join(root,'tracker');mkdirSync(source,{recursive:true});mkdirSync(tracker);
  const g=(args:string[])=>execFileSync('git',['-C',source,...args],{windowsHide:true,encoding:'utf8',stdio:'pipe'}).trim();g(['init','--initial-branch=main']);writeFileSync(join(source,'app.rs'),'base');g(['add','.']);g(['-c','user.name=Fixture','-c','user.email=fixture@localhost','commit','-m','Base']);const head=g(['rev-parse','HEAD']);
  writeFileSync(join(source,'app.rs'),'staged');g(['add','app.rs']);writeFileSync(join(source,'app.rs'),'unstaged');writeFileSync(join(source,'draft.rs'),'untracked');const artifact=join(root,'capture.txt');writeFileSync(artifact,'retained failure');
  const team=[{id:'lead',name:'Lead',roles:['lead']},{id:'ba',name:'BA',roles:['ba','reviewer']},{id:'a',name:'A',roles:['builder','reviewer']},{id:'b',name:'B',roles:['builder','reviewer']}];
  execFileSync('git',['init','--initial-branch=main',tracker],{windowsHide:true,stdio:'pipe'});const project=projectSchema.parse({id:'transfer',name:'Transfer',kind:'repository',path:source,trackerPath:tracker,team,reviewChecklist:'Preserve evidence.'});new Pmt(project).ensure(project);
  const plan={project,sourceReference:{path:source,commit:head},assignments:team.map(member=>({participantId:member.id,state:'checkpoint',nextAction:'Retain current bounded assignment.',worktree:source})),artifacts:[{path:artifact,meaning:'Raw failure remains failed.'}],retainedDecisions:['Backend acceptance remains waived.'],pendingActions:['Lead interface decision.']};
  const outside=join(root,'outside'),link=resolve('.state/transfers','linked-'+randomUUID());mkdirSync(outside);mkdirSync(resolve('.state/transfers'),{recursive:true});symlinkSync(outside,link,'junction');assert.throws(()=>stageTransfer(plan,link),/storage cannot contain links/);assert.deepEqual(readdirSync(outside),[]);
  assert.throws(()=>stageTransfer({...plan,assignments:plan.assignments.slice(1)}),/Missing handoff/);
  const {root:staged,manifest}=stageTransfer(plan);assert.equal(manifest.status,'paused');assert.equal(manifest.contexts.length,4);assert.equal(manifest.reconciliation.oldDispatchFenced,false);assert.equal(manifest.reconciliation.userApproved,false);assert.equal(g(['rev-parse','HEAD']),head);assert.equal(readFileSync(join(source,'app.rs'),'utf8'),'unstaged');assert.equal(readFileSync(join(source,'draft.rs'),'utf8'),'untracked');assert.match(g(['diff','--cached']),/staged/);
  const restored=verifyTransfer(staged);assert.equal(restored.worktrees.length,1);assert.equal(restored.worktrees[0]!.files.length,2);
  const status=g(['status','--porcelain=v1','-uall']);writeFileSync(join(source,'app.rs'),'different staged bytes');g(['add','app.rs']);writeFileSync(join(source,'app.rs'),'unstaged');assert.equal(g(['status','--porcelain=v1','-uall']),status);assert.ok(reconcileTransfer(staged).effects.some(effect=>effect.kind==='index'));
  writeFileSync(join(source,'app.rs'),'legitimate later work');g(['add','.']);g(['-c','user.name=Fixture','-c','user.email=fixture@localhost','commit','-m','Legitimate accepted result']);const later=g(['rev-parse','HEAD']),reconciliation=reconcileTransfer(staged);assert.equal(reconciliation.dispatchAllowed,false);assert.ok(reconciliation.effects.some(effect=>effect.kind==='head'&&effect.after===later));assert.equal(g(['rev-parse','HEAD']),later);assert.equal(readFileSync(join(source,'app.rs'),'utf8'),'legitimate later work');
  writeFileSync(restored.worktrees[0]!.files.find(file=>file.name==='draft.rs')!.backup!,'corrupted');assert.throws(()=>verifyTransfer(staged),/backup changed/);
});
