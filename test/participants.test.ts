import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {Store} from '../server/store.ts';
import {configSchema} from '../shared/workflow.ts';
import {projectSchema} from '../server/projects.ts';
import {teamSchema} from '../shared/participants.ts';

const team=teamSchema.parse([{id:'lead',name:'Lead',roles:['lead']},{id:'ba',name:'BA',roles:['ba']},{id:'session',name:'Builder Session',roles:['builder','reviewer']},{id:'view',name:'Builder View',roles:['builder','reviewer']}]);
test('project participant leases bind tickets to one fixed roster and preserve independent peer review',()=>{
  const root=resolve('.state/participant-tests',randomUUID());mkdirSync(root,{recursive:true});const db=join(root,'state.db'),source=join(root,'source');mkdirSync(source);writeFileSync(join(source,'source.txt'),'fixed source');
  const project=projectSchema.parse({id:'team-proof',name:'Team proof',kind:'fixture',path:source,reviewChecklist:'Independent review.',team}),config=configSchema.parse(JSON.parse(readFileSync('config/workflow.json','utf8')));
  const store=new Store(db);
  try{
    const graph=JSON.parse(readFileSync('config/workflows.json','utf8')).find((item:{id:string})=>item.id==='ticket-delivery');
    const parent:any={id:randomUUID(),projectId:project.id,workflowId:'parent',definition:graph,phase:'triage',status:'queued',createdAt:'',updatedAt:'',title:'Parent',description:'',turns:[],questions:[],message:'',recovery:false,attempts:[],artifacts:{project_snapshot:project},personaInstructions:{},handoffs:[],baseTaskId:randomUUID(),baseCandidate:'a'.repeat(40),parallel:{commit:'b'.repeat(40),initialTree:'a'.repeat(40),initialFiles:{},excludedPrefixes:[],ticketRuns:{},wave:[]},ticketDefinition:graph,ticketPersonaInstructions:{}};
    store.saveRun(parent);const tickets=['A','B','C'].map(id=>({id,title:id,status:'todo',path:id+'.md',body:'scope',revision:id,dependsOn:[]}));
    const children=tickets.map(ticket=>store.reserveParallelTicket(parent,ticket));
    const first=store.claimCoordinated(children[0]!.id,'builder',false,config)!,second=store.claimCoordinated(children[1]!.id,'builder',false,config)!;
    assert.notEqual(first.participantId,second.participantId);assert.equal(store.claimCoordinated(children[2]!.id,'builder',false,config),null);
    store.finish(first.id,{kind:'built',candidate:'c'.repeat(40),verified:true},config);
    assert.equal(store.claimCoordinated(children[0]!.id,'reviewer',false,config),null,'The independent peer is still implementing; the author cannot review itself.');
    store.finish(second.id,{kind:'built',candidate:'d'.repeat(40),verified:true},config);
    const review=store.claimCoordinated(children[0]!.id,'reviewer',false,config)!;assert.equal(review.participantId,second.participantId);assert.notEqual(review.worker,first.worker);
    store.hold(review.id,'Interrupted review');assert.ok(store.leases(project.id).some(lease=>lease.owner===review.id));
    store.resume(children[0]!.id,'Reconciled synthetic review',{reconciled:true});assert.equal(store.leases(project.id).some(lease=>lease.owner===review.id),false);
    const holder=store.claimParticipant(project,'lead','project-decision');assert.equal(holder!.participantId,'lead');assert.equal(store.claimParticipant(project,'lead','other-decision'),null);store.releaseLeases('project-decision');assert.ok(store.claimParticipant(project,'lead','other-decision'));store.releaseLeases('other-decision');
    assert.throws(()=>teamSchema.parse(team.filter(person=>person.id!=='view')),/independent review/);
  }finally{store.close();}
  const reopened=new Store(db);try{assert.equal(reopened.leases().length,0);}finally{reopened.close();}
});
