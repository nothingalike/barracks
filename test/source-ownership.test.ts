import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {Store} from '../server/store.ts';
import {configSchema} from '../shared/workflow.ts';
import {projectSchema} from '../server/projects.ts';
import {assertSourceGrants,sourceGrantSchema,grantsOverlap} from '../shared/source-grants.ts';
import {ParallelDelivery} from '../server/parallel-delivery.ts';
import type {PmtItem} from '../shared/factory.ts';
import {workflows} from '../server/workflow-definitions.ts';

const config=configSchema.parse(JSON.parse(readFileSync('config/workflow.json','utf8')));
function fixture(policy:{leadDelegation?:'listed'|'project'}={},protectedPaths:string[]=[]){
  const project=projectSchema.parse({id:'ownership',name:'Ownership',path:'.',kind:'fixture',protectedPaths,reviewChecklist:'Preserve owners.',delivery:{sharedPaths:['src/shared.rs'],requirePathGrants:true,...policy},team:[{id:'lead',name:'Lead',roles:['lead']},{id:'ba',name:'BA',roles:['ba']},{id:'one',name:'One',roles:['builder','reviewer']},{id:'two',name:'Two',roles:['builder','reviewer']}]}),store=new Store(':memory:'),graph=JSON.parse(readFileSync('config/workflows.json','utf8')).find((item:{id:string})=>item.id==='ticket-delivery');
  const parent:any={id:randomUUID(),projectId:project.id,workflowId:'parent',definition:graph,phase:'triage',status:'queued',createdAt:'',updatedAt:'',title:'Parent',description:'',turns:[],questions:[],message:'',recovery:false,attempts:[],artifacts:{project_snapshot:project},personaInstructions:{},handoffs:[],baseTaskId:randomUUID(),baseCandidate:'a'.repeat(40),parallel:{commit:'b'.repeat(40),initialTree:'a'.repeat(40),initialFiles:{},excludedPrefixes:[],ticketRuns:{},wave:[]},ticketDefinition:graph,ticketPersonaInstructions:{}};store.saveRun(parent);
  const child=(id:string,ownedPaths:string[])=>store.reserveParallelTicket(parent,{id,title:id,status:'todo',path:id+'.md',body:'scope',revision:id,dependsOn:[],ownedPaths});return {store,project,child,parent};
}

test('project Lead delegation approves requested unlisted source and preserves protection and writer locks',()=>{
  const {store,child}=fixture({leadDelegation:'project'},['src/protected/']);try{
    const a=child('A',['src/platform_macos/']),b=child('B',['src/roster.rs']);
    const builder=store.claimCoordinated(a.id,'builder',false,config)!;
    store.finish(builder.id,{kind:'blocked',blockerKind:'technical',reason:'Need macOS restart coordination.',interfaceRequest:{question:'Approve the macOS restart handoff contract.',paths:['src/roster.rs','src/protected/key.rs','src/']}},config);
    const lead=store.claimCoordinated(a.id,'lead',true,config)!;
    for(const path of ['Cargo.toml','src/protected/key.rs','src/','.git/config','../outside'])assert.throws(()=>store.finish(lead.id,{kind:'resolved',resolution:'Invalid grant.',grantedPaths:[path]},config));
    store.finish(lead.id,{kind:'resolved',resolution:'Use the macOS-only restart handoff and preserve other platforms.',grantedPaths:['src/roster.rs']},config);
    assert.deepEqual(store.task(a.id).writablePaths,['src/platform_macos/','src/roster.rs']);
    assert.ok(store.claimCoordinated(a.id,'builder',false,config));assert.equal(store.claimCoordinated(b.id,'builder',false,config),null);
  }finally{store.close();}
});

test('paused delegation adoption updates retained snapshots and requeues only the obsolete delegation blocker',()=>{
  const {store,child,parent}=fixture();try{
    parent.definition=workflows().find(item=>item.id==='qualified-delivery')!;parent.workflowId=parent.definition.id;parent.phase='await_tickets';parent.status='waiting';parent.description='Use rust-refactor; leave main untouched.';store.saveRun(parent);
    const a=child('A',['src/platform_macos/']),b=child('B',['src/other.rs']),request={question:'Coordinate the restart interface.',paths:['src/roster.rs']};
    store.finish(store.claimCoordinated(a.id,'builder',false,config)!.id,{kind:'blocked',blockerKind:'technical',reason:request.question,interfaceRequest:request},config);
    const lead=store.claimCoordinated(a.id,'lead',true,config)!;store.hold(lead.id,'Invalid output under the old policy.');store.resume(a.id,'Reconciled.',{reconciled:true,retryTechnicalResolution:true});
    a.status='waiting';a.phase='await_resolution';a.resumeState='build';a.questions=[request.question];store.saveRun(a);
    const input={mode:'project',reason:'Lead owns routine coordination inside approved ticket scope.'};assert.throws(()=>store.adoptLeadDelegation(parent.id,input),/Pause/);
    const building=store.claimCoordinated(b.id,'builder',false,config)!;store.pause(true);assert.throws(()=>store.adoptLeadDelegation(parent.id,input),/Finish or reconcile/);
    store.hold(building.id,'Controlled interruption.');assert.throws(()=>store.adoptLeadDelegation(parent.id,input),/Finish or reconcile/);store.resume(b.id,'Process drained.',{reconciled:true});
    const before=store.task(b.id),receipt=store.adoptLeadDelegation(parent.id,input);
    assert.ok(store.task(b.id).resolution?.includes(before.resolution!));assert.match(store.task(b.id).resolution!,/Operator source-coordination amendment/);
    assert.equal(projectSchema.parse(receipt.run.artifacts.project_snapshot).delivery?.leadDelegation,'project');assert.equal(receipt.run.description,parent.description);assert.equal(projectSchema.parse(store.task(a.id).projectSnapshot).delivery?.leadDelegation,'project');assert.equal(projectSchema.parse(store.run(b.id).artifacts.project_snapshot).delivery?.leadDelegation,'project');
    assert.equal(store.run(a.id).phase,'resolve_technical');assert.equal(store.run(a.id).status,'queued');assert.equal(store.task(a.id).technicalAttempts,0);assert.deepEqual(store.task(a.id).writablePaths,['src/platform_macos/']);assert.deepEqual(store.task(a.id).interfaceRequest,request);assert.equal(receipt.record.reassessments[0]?.previousAttempts,1);assert.equal(store.task(b.id).state,before.state);assert.equal(store.task(b.id).candidate,before.candidate);assert.equal(store.paused,true);
    store.pause(false);const reassessment=store.claimCoordinated(a.id,'lead',true,config)!;store.finish(reassessment.id,{kind:'blocked',blockerKind:'authority',reason:'A real new product/authority decision.'},config);a.phase='await_resolution';a.status='waiting';store.saveRun(a);store.pause(true);store.adoptLeadDelegation(parent.id,input);assert.equal(store.task(a.id).technicalAttempts,1,'Repeated adoption does not reset another attempt.');assert.equal(store.run(a.id).status,'waiting');
  }finally{store.close();}
});

test('delegation adoption preserves protected blockers, completed history and invalid-input atomicity',()=>{
  const {store,child,parent}=fixture({},['src/protected/']);try{
    parent.definition=workflows().find(item=>item.id==='qualified-delivery')!;parent.status='waiting';parent.phase='await_tickets';parent.questions=['A protected-file decision remains.'];store.saveRun(parent);
    const a=child('A',['src/mac/']),completed=child('DONE',['src/done.rs']),listed=child('LISTED',['src/listed/']);
    store.finish(store.claimCoordinated(a.id,'builder',false,config)!.id,{kind:'blocked',blockerKind:'technical',reason:'Protected adapter needs authority.',interfaceRequest:{question:'Protected adapter needs authority.',paths:['src/protected/key.rs']}},config);
    const lead=store.claimCoordinated(a.id,'lead',true,config)!;store.hold(lead.id,'Controlled interruption.');store.resume(a.id,'Drained.',{reconciled:true,retryTechnicalResolution:true});a.status='waiting';a.phase='await_resolution';store.saveRun(a);
    store.finish(store.claimCoordinated(listed.id,'builder',false,config)!.id,{kind:'blocked',blockerKind:'technical',reason:'Already permitted but genuinely exhausted.',interfaceRequest:{question:'Already permitted but genuinely exhausted.',paths:['src/shared.rs']}},config);const listedLead=store.claimCoordinated(listed.id,'lead',true,config)!;store.hold(listedLead.id,'Controlled interruption.');store.resume(listed.id,'Drained.',{reconciled:true,retryTechnicalResolution:true});listed.status='waiting';listed.phase='await_resolution';store.saveRun(listed);
    store.finish(store.claimCoordinated(completed.id,'builder',false,config)!.id,{kind:'built',candidate:'c'.repeat(40),verified:true},config);const review=store.claimCoordinated(completed.id,'reviewer',false,config)!;store.finish(review.id,{kind:'reviewed',candidate:'c'.repeat(40),approved:true,notes:'Completed before policy adoption.'},config);completed.status='complete';store.saveRun(completed);
    const oldRun=JSON.stringify(store.run(completed.id)),oldTask=JSON.stringify(store.task(completed.id));store.pause(true);const before=JSON.stringify(store.run(parent.id));assert.throws(()=>store.adoptLeadDelegation(parent.id,{mode:'project',reason:'',unexpected:true}));assert.equal(JSON.stringify(store.run(parent.id)),before);
    const result=store.adoptLeadDelegation(parent.id,{mode:'project',reason:'Coordinate ordinary source files.'});assert.deepEqual(result.record.reassessments,[]);assert.equal(store.run(a.id).status,'waiting');assert.equal(store.task(a.id).technicalAttempts,1);assert.equal(store.run(listed.id).status,'waiting');assert.equal(store.task(listed.id).technicalAttempts,1);assert.equal(JSON.stringify(store.run(completed.id)),oldRun);assert.equal(JSON.stringify(store.task(completed.id)),oldTask);assert.deepEqual(result.run.questions,['A protected-file decision remains.']);
    const final=store.run(parent.id);final.status='complete';store.saveRun(final);assert.throws(()=>store.adoptLeadDelegation(parent.id,{mode:'project',reason:'No terminal changes.'}),/unfinished parent/);
  }finally{store.close();}
});
test('overlapping source ownership serializes writers and an interface request needs bounded Lead delegation',()=>{
  const {store,child}=fixture();try{
    const a=child('A',['src/items/']),b=child('B',['src/items/child.rs']);
    const first=store.claimCoordinated(a.id,'builder',false,config)!;assert.equal(store.claimCoordinated(b.id,'builder',false,config),null);assert.equal(store.leases().filter(lease=>lease.resource.startsWith('participant:')).length,1,'Failed source reservation releases its participant.');
    store.finish(first.id,{kind:'blocked',blockerKind:'technical',reason:'Need the shared export contract.',interfaceRequest:{question:'May this ticket expose the agreed type?',paths:['src/shared.rs']}},config);
    const lead=store.claimCoordinated(a.id,'lead',true,config)!;assert.equal(lead.participantId,'lead');
    assert.throws(()=>store.finish(lead.id,{kind:'resolved',resolution:'Too broad',grantedPaths:['Cargo.toml']},config),/exceeds/);
    store.finish(lead.id,{kind:'resolved',resolution:'Use the agreed source-backed export.',grantedPaths:['src/shared.rs']},config);assert.deepEqual(store.task(a.id).writablePaths,['src/items/','src/shared.rs']);assert.equal(store.task(a.id).state,'implementing');
    assert.ok(store.claimCoordinated(b.id,'builder',false,config));
    assert.throws(()=>assertSourceGrants({'src/shared.rs':'before'},{'src/shared.rs':'after'},['src/items/']),/owner grant/);assertSourceGrants({'src/shared.rs':'before'},{'src/shared.rs':'after'},store.task(a.id).writablePaths);
    assert.ok(grantsOverlap('src/items/','src/items/child.rs'));assert.equal(grantsOverlap('src/items','src/items-extra.rs'),false);assert.equal(sourceGrantSchema.safeParse('../outside').success,false);
  }finally{store.close();}
});
test('host resources serialize across projects until explicitly released',()=>{
  const {store,project}=fixture();try{
    assert.ok(store.claimParticipant(project,'lead','first',undefined,['host:gpu']));const other={...project,id:'other-project'};assert.equal(store.claimParticipant(other,'lead','second',undefined,['host:gpu']),null);assert.equal(store.leases().some(lease=>lease.owner==='second'),false);store.releaseLeases('first');assert.ok(store.claimParticipant(other,'lead','second',undefined,['host:gpu']));
  }finally{store.close();}
});
test('combined repair inherits concrete path grants but not every delegatable shared file',()=>{
  const {store,project,child,parent}=fixture();try{
    project.delivery!.sharedPaths.push('src/undelegated.rs');parent.artifacts.project_snapshot=project;
    const a=child('A',['src/a.rs']),b=child('B',['src/b.rs']);parent.artifacts.ticket_catalog=[store.run(a.id).artifacts.ticket,store.run(b.id).artifacts.ticket] as PmtItem[];parent.parallel.wave=['A','B'];store.saveRun(parent);
    const builder=store.claimCoordinated(a.id,'builder',false,config)!;store.finish(builder.id,{kind:'blocked',blockerKind:'technical',reason:'Need shared export.',interfaceRequest:{question:'Delegate export?',paths:['src/shared.rs']}},config);const lead=store.claimCoordinated(a.id,'lead',true,config)!;store.finish(lead.id,{kind:'resolved',resolution:'Export is approved.',grantedPaths:['src/shared.rs']},config);
    new ParallelDelivery(store).repair(parent,'Combine the approved paths.');const repair=store.task(parent.children.B);assert.ok(repair.writablePaths!.includes('src/shared.rs'));assert.ok(repair.writablePaths!.includes('src/a.rs'));assert.equal(repair.writablePaths!.includes('src/undelegated.rs'),false);
  }finally{store.close();}
});
