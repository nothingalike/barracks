import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync,readFileSync,unlinkSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {projectSchema,taskRoot,candidate,git} from '../server/projects.ts';
import {initializeParallelSource,publishParallelSource} from '../server/parallel-source.ts';
import type {WorkflowRun} from '../shared/factory.ts';
import {deliveryOutput} from '../server/delivery-output.ts';

test('reviewed branch waits for actual Lead integration, preserves Source edits and replays its exact ref',()=>{
  const source=resolve('.state/handoff-tests',randomUUID());mkdirSync(source,{recursive:true});writeFileSync(join(source,'app.rs'),'baseline');
  const g=(args:string[])=>execFileSync('git',['-C',source,...args],{windowsHide:true,encoding:'utf8',stdio:'pipe'}).trim();g(['init','--initial-branch=main']);mkdirSync(join(source,'.workspace'));mkdirSync(join(source,'project'));writeFileSync(join(source,'.workspace','pm-toolbox.yml'),'paths:\n  project: project\n');writeFileSync(join(source,'project','ticket.md'),'Canonical tracked metadata');g(['add','.']);g(['-c','user.name=Fixture','-c','user.email=fixture@localhost','commit','-m','Baseline']);
  writeFileSync(join(source,'staged-delete.rs'),'old');writeFileSync(join(source,'unstaged-delete.rs'),'old');writeFileSync(join(source,'literal [1].rs'),'unchanged\nsource\n');g(['add','.']);g(['-c','user.name=Fixture','-c','user.email=fixture@localhost','commit','-m','Deletion baseline']);const unchangedBlob=g(['rev-parse','HEAD:literal [1].rs']);g(['config','core.autocrlf','true']);writeFileSync(join(source,'literal [1].rs'),'unchanged\r\nsource\r\n');unlinkSync(join(source,'staged-delete.rs'));g(['add','staged-delete.rs']);unlinkSync(join(source,'unstaged-delete.rs'));
  const project=projectSchema.parse({id:'handoff',name:'Handoff',kind:'repository',path:source,reviewChecklist:'Accepted capability.',delivery:{publication:'reviewed-branch'}});
  assert.throws(()=>initializeParallelSource({id:randomUUID(),artifacts:{}} as WorkflowRun,{...project,ref:'some-other-ref'}),/requires ref HEAD/);
  const run={id:randomUUID(),projectId:project.id,artifacts:{}} as WorkflowRun;initializeParallelSource(run,project);const root=taskRoot({id:run.id});writeFileSync(join(root,'workspace','app.rs'),'accepted\nmultiline\n');writeFileSync(join(root,'workspace','added.rs'),'new\nmultiline\n');run.baseCandidate=candidate(root);run.parallel!.commit=git(root,['-c','user.name=Fixture','-c','user.email=fixture@localhost','commit-tree',run.baseCandidate,'-p',run.parallel!.commit,'-m','Accepted candidate']);run.artifacts.acceptance_candidate=run.baseCandidate;
  const clean=run.baseCandidate;mkdirSync(join(root,'workspace','.workspace'));writeFileSync(join(root,'workspace','.workspace','forbidden'),'forbidden');run.baseCandidate=candidate(root);run.artifacts.acceptance_candidate=run.baseCandidate;assert.throws(()=>publishParallelSource(run,project),/would change runner\/project metadata/);assert.throws(()=>g(['rev-parse','--verify','refs/heads/barracks/'+run.id]));unlinkSync(join(root,'workspace','.workspace','forbidden'));run.baseCandidate=candidate(root);run.artifacts.acceptance_candidate=run.baseCandidate;assert.equal(run.baseCandidate,clean);
  assert.throws(()=>publishParallelSource(run,project),/Integrate it through the project Lead/);const manifest=JSON.parse(readFileSync(join(root,'reviewed-handoff.json'),'utf8'));assert.equal(readFileSync(join(source,'app.rs'),'utf8'),'baseline');assert.equal(g(['rev-parse',manifest.ref]),manifest.commit);assert.throws(()=>g(['show',manifest.ref+':staged-delete.rs']));assert.throws(()=>g(['show',manifest.ref+':unstaged-delete.rs']));
  assert.equal(g(['rev-parse',manifest.ref+':literal [1].rs']),unchangedBlob,'Unchanged Windows checkout bytes must preserve the original Source blob.');
  assert.throws(()=>publishParallelSource(run,project),/Integrate it through/);assert.equal(g(['rev-parse',manifest.ref]),manifest.commit);
  assert.equal(g(['show',manifest.ref+':project/ticket.md']),'Canonical tracked metadata');assert.match(g(['show',manifest.ref+':.workspace/pm-toolbox.yml']),/project/);g(['merge','--ff-only',manifest.ref]);writeFileSync(join(source,'app.rs'),'user edit after integration');assert.throws(()=>publishParallelSource(run,project),/changed since delivery|differs from accepted/);assert.equal(readFileSync(join(source,'app.rs'),'utf8'),'user edit after integration');
  writeFileSync(join(source,'app.rs'),'accepted\r\nmultiline\r\n');assert.equal(readFileSync(join(source,'added.rs'),'utf8'),'new\r\nmultiline\r\n');const publication=publishParallelSource(run,project);assert.equal(publication.candidate,run.baseCandidate);assert.equal(g(['rev-parse','HEAD']),manifest.commit);
  run.baseTaskId=run.id;run.definition=JSON.parse(readFileSync('config/workflows.json','utf8')).find((definition:{id:string})=>definition.id==='qualified-delivery');assert.equal(deliveryOutput(run,project)!.projectMatches,true);
});

