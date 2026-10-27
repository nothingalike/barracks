import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {ticketBoard} from '../shared/ticket-progress.ts';
import {Pmt} from '../server/pmt.ts';
import {projectSchema} from '../server/projects.ts';
import type {PmtItem,WorkflowRun} from '../shared/factory.ts';
const definitions=JSON.parse(readFileSync('config/workflows.json','utf8'));
const item=(id:string,status='backlog',dependsOn:string[]=[]):PmtItem=>({id,title:id,status,epic:'E01',dependsOn,path:id+'.md',body:'Acceptance criteria.',revision:'v1'});
const run=(changes:Partial<WorkflowRun>={}):WorkflowRun=>({id:'run',projectId:'project',workflowId:'delivery',epicId:'E01',title:'Delivery',description:'',definition:definitions.find((definition:{id:string})=>definition.id==='delivery'),status:'running',phase:'review',createdAt:'2026-10-24',updatedAt:'2026-10-24',turns:[],questions:[],message:'Reviewing.',recovery:false,attempts:[],artifacts:{ticket:{id:'T1'}},personaInstructions:{reviewer:'# Reviewer'},handoffs:[],...changes});

test('board preserves PMT columns and separates persona stages, dependencies and intervention',()=>{
  const tickets=[item('T1','in-progress'),item('T2','backlog',['T1']),item('T3','custom')];
  const result=ticketBoard(tickets,['backlog','todo','in-progress','complete'],[run()],[]);
  assert.deepEqual(result.statuses,['backlog','todo','in-progress','complete','custom']);
  assert.equal(result.items[0]!.status,'in-progress');assert.equal(result.items[0]!.progress?.stage,'Reviewer');
  assert.equal(result.items[1]!.progress?.attention,'blocked');assert.match(result.items[1]!.progress!.message!,/T1/);
  assert.equal(result.items[1]!.progress?.stage,undefined);
  const waiting=ticketBoard(tickets,[],[run({status:'waiting',recovery:true,questions:['Inspect the worker.']})],[]);
  assert.equal(waiting.items[0]!.progress?.attention,'inspect');assert.equal(waiting.items[0]!.progress?.message,'Inspect the worker.');
  const human=ticketBoard(tickets,[],[run({status:'waiting',questions:['Choose scope.']})],[]);
  assert.equal(human.items[0]!.progress?.attention,'waiting');
  assert.equal(tickets[0]!.status,'in-progress');
});

test('completed tickets show cumulative epic gates and latest attempts own the progress projection',()=>{
  const tickets=[item('T1','complete')];
  const acceptance=run({phase:'acceptance',ticketOrder:['T1'],completedTickets:['T1'],personaInstructions:{'acceptance-tester':'# Acceptance Tester'}});
  assert.match(ticketBoard(tickets,[],[acceptance],[]).items[0]!.progress!.stage!,/^Epic · Acceptance Tester$/);
  const old=run({id:'old',createdAt:'2026-10-23'});
  const latest=run({id:'new',status:'complete',createdAt:'2026-10-24'});
  const projection=ticketBoard(tickets,[],[old,latest],[]).items[0]!.progress!;
  assert.equal(projection.runId,'new');assert.equal(projection.stage,undefined);
});

test('PMT workflow columns are read from inline and block state configuration',()=>{
  const root=resolve('.state/ticket-board-tests',randomUUID());mkdirSync(join(root,'.workspace'),{recursive:true});
  const pmt=new Pmt(projectSchema.parse({id:'board',name:'Board',kind:'fixture',path:root,reviewChecklist:'Review.'}));
  const file=join(root,'.workspace/pm-toolbox.yml');
  writeFileSync(file,'workflow:\n  states: ["backlog", "todo", "in-progress", "complete"]\n');
  assert.deepEqual(pmt.statuses(),['backlog','todo','in-progress','complete']);
  writeFileSync(file,"workflow:\n  states:\n    - backlog\n    - 'review' # custom stage\n    - complete\n  allow_reopen: true\n");
  assert.deepEqual(pmt.statuses(),['backlog','review','complete']);
});

test('parallel cards show their own worker stages and depend on integrated predecessors',()=>{
  const root=run({id:'parent',phase:'dispatch_tickets',ticketOrder:['T1','T2','T3'],children:{T1:'child-a',T2:'child-b'},completedTickets:[],parallel:{commit:'a'.repeat(40),initialTree:'b'.repeat(40),initialFiles:{},excludedPrefixes:[],ticketRuns:{T1:'child-a',T2:'child-b'},wave:['T1','T2']}});
  const a=run({id:'child-a',parentRunId:'parent',phase:'build',createdAt:'2026-10-25',personaInstructions:{builder:'# Builder'}}),b=run({id:'child-b',parentRunId:'parent',phase:'review',createdAt:'2026-10-25',personaInstructions:{reviewer:'# Reviewer'}});
  const items=[item('T1','in-progress'),item('T2','in-progress'),item('T3','backlog',['T1'])];
  const first=ticketBoard(items,[],[root,a,b],[]);assert.equal(first.items[0]!.progress?.stage,'Builder');assert.equal(first.items[1]!.progress?.stage,'Reviewer');assert.equal(first.items[0]!.progress?.runId,'parent');
  a.status='complete';items[0]!.status='complete';const second=ticketBoard(items,[],[root,a,b],[]);assert.equal(second.items[0]!.progress?.stage,'Awaiting Lead integration');assert.equal(second.items[2]!.progress?.attention,'blocked');
});
