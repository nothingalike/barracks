import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdirSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {Store} from '../server/store.ts';
import {projectSchema} from '../server/projects.ts';
import {configSchema} from '../shared/workflow.ts';
import type {WorkflowRun} from '../shared/factory.ts';
const config=configSchema.parse(JSON.parse(readFileSync('config/workflow.json','utf8')));

test('epic delivery plans ownership through Lead and holds all Builder writes until granted',()=>{
  const root=resolve('.state/epic-planning-tests',randomUUID());mkdirSync(root,{recursive:true});
  const project=projectSchema.parse({id:'epic-planning',name:'Epic planning',kind:'fixture',path:root,protectedPaths:['protected/key'],reviewChecklist:'Scope stays within the ticket.',delivery:{selection:'epic',requirePathGrants:true}});
  const definition=JSON.parse(readFileSync('config/workflows.json','utf8')).find((item:{id:string})=>item.id==='qualified-ticket');
  const parent:WorkflowRun={id:randomUUID(),projectId:project.id,workflowId:'qualified-delivery',definition,phase:'dispatch_tickets',status:'queued',createdAt:'',updatedAt:'',title:'Epic only',description:'',turns:[],questions:[],message:'',recovery:false,attempts:[],artifacts:{project_snapshot:project},personaInstructions:{},handoffs:[],baseTaskId:randomUUID(),baseCandidate:'a'.repeat(40),parallel:{commit:'b'.repeat(40),initialTree:'a'.repeat(40),initialFiles:{},excludedPrefixes:[],ticketRuns:{},wave:[]},ticketDefinition:definition,ticketPersonaInstructions:{}};
  const store=new Store(join(root,'state.db'));store.saveRun(parent);
  const make=(id:string,ownedPaths?:string[])=>store.reserveParallelTicket(parent,{id,title:id,status:'backlog',path:id+'.md',revision:id,dependsOn:[],body:'## Acceptance Criteria\n- The behavior is verified.',ownedPaths});
  try{
    const child=make('T1'),lead=store.claimCoordinated(child.id,'lead',false,config)!;
    store.finish(lead.id,{kind:'triaged',specificationReady:true},config);
    assert.equal(store.claimCoordinated(child.id,'builder',false,config),null);assert.equal(store.task(child.id).state,'blocked');assert.equal(store.assignments().some(item=>item.role==='builder'),false);
    const resolve=store.claimCoordinated(child.id,'lead',true,config)!;
    assert.throws(()=>store.finish(resolve.id,{kind:'resolved',resolution:'Unsafe scope.',ownedPaths:['protected/']},config),/protected/);
    assert.equal(store.task(child.id).writablePaths,undefined);
    store.finish(resolve.id,{kind:'resolved',resolution:'Implement the named capability only.',ownedPaths:['src/tasks/']},config);
    assert.deepEqual(store.task(child.id).writablePaths,['src/tasks/']);assert.ok(store.claimCoordinated(child.id,'builder',false,config));
    const next=make('T2',['src/owned/']),nextLead=store.claimCoordinated(next.id,'lead',false,config)!;
    assert.throws(()=>store.finish(nextLead.id,{kind:'triaged',specificationReady:true,ownedPaths:['src/other/']},config),/shared-interface/);
    store.finish(nextLead.id,{kind:'triaged',specificationReady:false,ownedPaths:[]},config);
    const ba=store.claimCoordinated(next.id,'ba',false,config)!;
    assert.throws(()=>store.finish(ba.id,{kind:'refined',ownedPaths:['src/other/']},config),/Unrecognized/);
  }finally{store.close();}
});
