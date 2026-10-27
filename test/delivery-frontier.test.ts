import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {projectSchema,inventory} from '../server/projects.ts';
import {Pmt} from '../server/pmt.ts';
import {inspectDelivery,assertFrontierCurrent} from '../server/delivery-frontier.ts';
import {runInputSchema} from '../shared/factory.ts';

test('all-ticket requests support the full Saltwake-sized catalog without changing concurrency',()=>{
  const ticketIds=Array.from({length:259},(_,index)=>'SW-'+(index+1));const input=runInputSchema.parse({projectId:'saltwake',workflowId:'qualified-delivery',epicId:'SW-E05',title:'Deliver the epic',ticketIds,ticketConcurrency:2});assert.equal(input.ticketIds?.length,259);assert.equal(input.ticketConcurrency,2);assert.throws(()=>runInputSchema.parse({...input,ticketIds:[...ticketIds,ticketIds[0]]}),/Choose each ticket once/);
});

test('separate canonical tracker supports read-only selected delivery, exclusions and readiness invalidation',()=>{
  const root=resolve('.state/frontier-tests',randomUUID()),source=join(root,'source'),tracker=join(root,'tracker');mkdirSync(source,{recursive:true});mkdirSync(tracker);
  writeFileSync(join(source,'game.rs'),'// unrelated source\n');
  execFileSync('git',['init','--initial-branch=main',tracker],{windowsHide:true,stdio:'pipe'});
  const project=projectSchema.parse({id:'frontier',name:'Frontier',path:source,trackerPath:tracker,kind:'fixture',reviewChecklist:'Preserve scope.',delivery:{selection:'explicit',excludeRollups:true,excludeLabels:['Grok']}}),pmt=new Pmt(project);
  pmt.ensure(project);pmt.command(['epic','create','--title','Original outcomes','--yes']);const epic=pmt.list().find(item=>!item.epic)!;
  for(const title of ['Capability A','Capability B','Parent outcome','Externally owned'])pmt.command(['story','create','--epic',epic.id,'--title',title,'--yes']);
  for(const ticket of pmt.list().filter(item=>item.epic===epic.id))pmt.edit(ticket.id,{title:ticket.title,revision:ticket.revision,body:ticket.body.replace('- [Define expected outcomes and restrictions]','- The named capability preserves its approved public behavior.')});
  const find=(title:string)=>pmt.list().find(item=>item.title===title)!,a=find('Capability A'),b=find('Capability B'),outcome=find('Parent outcome'),external=find('Externally owned');
  const editHeader=(id:string,from:string,to:string)=>{const file=join(tracker,pmt.list().find(item=>item.id===id)!.path);writeFileSync(file,readFileSync(file,'utf8').replace(from,to));};
  editHeader(b.id,'depends_on: []','depends_on: '+JSON.stringify([a.id]));editHeader(outcome.id,'labels: []','labels: ["rollup"]');editHeader(external.id,'labels: []','labels: ["gRoK"]');
  pmt.command(['index','rebuild']);const trackerBefore=inventory(tracker),sourceBefore=inventory(source);
  const preview=inspectDelivery(project,epic.id,[a.id,b.id]);assert.deepEqual(preview.blockers,[]);assert.equal(preview.trackerPath,tracker);assert.equal(preview.sourcePath,source);assert.equal(preview.tickets.length,2);assert.ok(preview.omitted.includes(outcome.id));
  assert.match(inspectDelivery(project,epic.id).blockers.join(' '),/explicitly/);
  assert.match(inspectDelivery(project,epic.id,[b.id]).blockers.join(' '),/requires/);
  assert.match(inspectDelivery(project,epic.id,[outcome.id,external.id]).blockers.join(' '),/excluded/);
  const wholeEpic=inspectDelivery({...project,delivery:{...project.delivery!,selection:'epic',requirePathGrants:true}},epic.id,[external.id,outcome.id,b.id,a.id]);assert.deepEqual(wholeEpic.blockers,[]);assert.deepEqual(wholeEpic.tickets.map(ticket=>ticket.id).sort(),[a.id,b.id].sort());assert.ok(wholeEpic.omitted.includes(external.id));assert.ok(wholeEpic.omitted.includes(outcome.id));
  assert.match(inspectDelivery(project,epic.id,[a.id,b.id,outcome.id,external.id]).blockers.join(' '),/excluded/,'A strict explicit project policy is retained.');
  assert.match(inspectDelivery(project,epic.id,['UNKNOWN']).blockers.join(' '),/not in/);
  assertFrontierCurrent(preview,pmt.list(),[a.id,b.id]);
  assert.deepEqual(inventory(tracker),trackerBefore);assert.deepEqual(inventory(source),sourceBefore);
  pmt.move(a.id,'in-progress');assertFrontierCurrent(preview,pmt.list(),[a.id]);
  const current=pmt.list();current.find(item=>item.id===a.id)!.status='in-progress';assertFrontierCurrent(preview,current,[a.id]);
  current.find(item=>item.id===a.id)!.body='## Revised scope\nNew product decision\n'+current.find(item=>item.id===a.id)!.body;assert.throws(()=>assertFrontierCurrent(preview,current,[a.id]),/changed after/);
  pmt.move(a.id,'complete');
  const automatic=projectSchema.parse({...project,delivery:{...project.delivery,selection:'epic',requirePathGrants:true}}),epicPreview=inspectDelivery(automatic,epic.id);
  const remainingAll=inspectDelivery(automatic,epic.id,pmt.list().filter(ticket=>ticket.epic===epic.id).map(ticket=>ticket.id));assert.deepEqual(remainingAll.blockers,[]);assert.deepEqual(remainingAll.tickets.map(ticket=>ticket.id),[b.id]);
  assert.deepEqual(epicPreview.blockers,[]);assert.equal(epicPreview.selection,'epic');assert.deepEqual(epicPreview.tickets.map(ticket=>ticket.id),[b.id]);assert.deepEqual(epicPreview.planning,[b.id]);assert.ok(epicPreview.omitted.includes(a.id));
  assert.match(inspectDelivery({...automatic,delivery:{...automatic.delivery!,selection:'explicit'}},epic.id,[b.id]).blockers.join(' '),/source ownership/);
  editHeader(b.id,'depends_on: '+JSON.stringify([a.id]),'depends_on: '+JSON.stringify([external.id]));
  const deferred=inspectDelivery(automatic,epic.id);assert.equal(deferred.tickets.length,0);assert.ok(deferred.deferred?.some(ticket=>ticket.id===b.id&&ticket.reason.includes(external.id)));
  editHeader(b.id,'depends_on: '+JSON.stringify([external.id]),'depends_on: '+JSON.stringify([a.id]));
  editHeader(a.id,'depends_on: []','depends_on: '+JSON.stringify([b.id]));assert.match(inspectDelivery(project,epic.id,[a.id,b.id]).blockers.join(' '),/cycle/);
});
