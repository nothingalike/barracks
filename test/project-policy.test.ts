import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync,readFileSync,renameSync,symlinkSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {projectSchema,runProject,prepare,candidate,inventory} from '../server/projects.ts';
import {Pmt} from '../server/pmt.ts';
import {Factory} from '../server/factory.ts';
import {Store} from '../server/store.ts';
import {Runner,SimulatedWorker} from '../server/runner.ts';
import {configSchema} from '../shared/workflow.ts';
import {deliveryOutput} from '../server/delivery-output.ts';

test('new scoped-policy runs reject legacy bypass and pin source, tracker and command settings',async()=>{
  const root=resolve('.state/project-policy-tests',randomUUID()),source=join(root,'source'),tracker=join(root,'tracker'),other=join(root,'other');for(const folder of [source,tracker,other])mkdirSync(folder,{recursive:true});
  writeFileSync(join(source,'source.txt'),'approved source');writeFileSync(join(other,'source.txt'),'other source');execFileSync('git',['init','--initial-branch=main',tracker],{windowsHide:true,stdio:'pipe'});
  const project=projectSchema.parse({id:'policy',name:'Policy',kind:'fixture',path:source,trackerPath:tracker,reviewChecklist:'Use selected scope.',delivery:{selection:'explicit',excludeLabels:['Grok'],excludeRollups:true},environment:{PROOF:'pinned'}}),pmt=new Pmt(project);pmt.ensure(project);pmt.command(['epic','create','--title','Selected work','--yes']);const epic=pmt.list().find(item=>!item.epic)!;pmt.command(['story','create','--title','Capability','--epic',epic.id,'--yes']);const ticket=pmt.list().find(item=>item.epic===epic.id)!;
  const settings=join(root,'projects.json'),previous=process.env.BARRACKS_PROJECTS_PATH;writeFileSync(settings,JSON.stringify({codexExecutable:process.execPath,projects:[project]}));process.env.BARRACKS_PROJECTS_PATH=settings;
  const store=new Store(':memory:');store.pause(true);const config=configSchema.parse(JSON.parse(readFileSync('config/workflow.json','utf8'))),factory=new Factory(store,new Runner(store,config,new SimulatedWorker(1)));
  try{
    const input={projectId:project.id,title:'Scoped delivery',epicId:epic.id};
    assert.throws(()=>factory.create({...input,workflowId:'delivery'}),/requires scoped/);
    assert.throws(()=>factory.create({...input,workflowId:'parallel-delivery'}),/explicitly/);
    const run=factory.create({...input,workflowId:'parallel-delivery',ticketIds:[ticket.id]});
    const replacement={...project,path:other,trackerPath:other,environment:{PROOF:'changed'}};writeFileSync(settings,JSON.stringify({codexExecutable:process.execPath,projects:[replacement]}));
    assert.equal(runProject(run).path,source);assert.equal(runProject(run).trackerPath,tracker);assert.equal(runProject(run).environment!.PROOF,'pinned');assert.equal(new Pmt(runProject(run)).list().find(item=>item.id===ticket.id)!.title,'Capability');
    const context=prepare({id:randomUUID(),projectId:project.id,projectSnapshot:runProject(run)});assert.equal(readFileSync(join(context.workspace,'source.txt'),'utf8'),'approved source');
    run.baseTaskId=context.root.split(/[\\/]/).at(-1)!;run.baseCandidate=candidate(context.root);assert.equal(deliveryOutput(run,replacement)!.projectPath,source);assert.equal(deliveryOutput(run,replacement)!.projectMatches,true);
    assert.equal(prepare({id:context.root.split(/[\\/]/).at(-1)!,projectId:project.id}).project.environment!.PROOF,'pinned');
    factory.stop();await factory.drained();
    renameSync(tracker,tracker+'-retained');symlinkSync(other,tracker,'junction');assert.throws(()=>runProject(run),/identity changed/);
    renameSync(source,source+'-retained');symlinkSync(other,source,'junction');assert.equal(deliveryOutput(run,replacement)!.projectIdentityChanged,true);assert.equal(deliveryOutput(run,replacement)!.projectMatches,false);
  }finally{factory.stop();store.close();process.env.BARRACKS_PROJECTS_PATH=previous;}
});

test('Git inventory rejects a tracked parent directory replaced by a junction with identical leaf bytes',()=>{
  const root=resolve('.state/inventory-policy-tests',randomUUID()),source=join(root,'source'),outside=join(root,'outside');mkdirSync(join(source,'src'),{recursive:true});mkdirSync(outside);writeFileSync(join(source,'src','lib.rs'),'unchanged');writeFileSync(join(outside,'lib.rs'),'unchanged');
  const project=projectSchema.parse({id:'inventory-policy',name:'Inventory',kind:'fixture',path:source,reviewChecklist:'Preserve source.'});const settings={codexExecutable:process.execPath,attemptTimeoutMs:null,inactivityWarningMs:600000,projects:[project]};
  const context=prepare({id:randomUUID(),projectId:project.id},settings);candidate(context.root);renameSync(join(context.workspace,'src'),join(context.workspace,'src-retained'));symlinkSync(outside,join(context.workspace,'src'),'junction');assert.throws(()=>inventory(context.workspace),/Symlink/);assert.equal(readFileSync(join(outside,'lib.rs'),'utf8'),'unchanged');
});
