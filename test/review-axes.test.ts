import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {Store} from '../server/store.ts';
import {configSchema} from '../shared/workflow.ts';
import {projectSchema} from '../server/projects.ts';
import {workflowDefinitionSchema} from '../shared/state-machine.ts';

test('Spec and Standards require distinct qualified peers on the exact candidate and rebuilding clears old verdicts',()=>{
  const project=projectSchema.parse({id:'axes',name:'Axes',path:'.',kind:'fixture',reviewChecklist:'Both axes.',delivery:{reviewAxes:['spec','standards']},team:[{id:'lead',name:'Lead',roles:['lead']},{id:'ba',name:'BA',roles:['ba','reviewer'],reviewAxes:['spec']},{id:'one',name:'One',roles:['builder','reviewer'],reviewAxes:['standards']},{id:'two',name:'Two',roles:['builder','reviewer'],reviewAxes:['standards']}]}),store=new Store(':memory:'),config=configSchema.parse(JSON.parse(readFileSync('config/workflow.json','utf8')));
  const graphs=JSON.parse(readFileSync('test/fixtures/qualified-workflows.json','utf8')).map((value:unknown)=>workflowDefinitionSchema.parse(value)),graph=graphs.find((item:{id:string})=>item.id==='qualified-ticket')!;
  try{
    const parent:any={id:randomUUID(),projectId:project.id,workflowId:'parent',definition:graph,phase:'triage',status:'queued',createdAt:'',updatedAt:'',title:'Parent',description:'',turns:[],questions:[],message:'',recovery:false,attempts:[],artifacts:{project_snapshot:project},personaInstructions:{},handoffs:[],baseTaskId:randomUUID(),baseCandidate:'a'.repeat(40),parallel:{commit:'b'.repeat(40),initialTree:'a'.repeat(40),initialFiles:{},excludedPrefixes:[],ticketRuns:{},wave:[]},ticketDefinition:graph,ticketPersonaInstructions:{}};store.saveRun(parent);
    const child=store.reserveParallelTicket(parent,{id:'A',title:'A',status:'todo',path:'A.md',body:'scope',revision:'A',dependsOn:[]}),build=store.claimCoordinated(child.id,'builder',false,config)!;
    store.finish(build.id,{kind:'built',candidate:'c'.repeat(40),verified:true},config);
    const spec=store.claimCoordinated(child.id,'reviewer',false,config,'spec')!;assert.equal(spec.participantId,'ba');store.finish(spec.id,{kind:'reviewed',candidate:'c'.repeat(40),approved:true,notes:'Spec passed.'},config);assert.equal(store.task(child.id).state,'reviewing');
    const standards=store.claimCoordinated(child.id,'reviewer',false,config,'standards')!;assert.equal(standards.participantId,'two');assert.notEqual(standards.participantId,build.participantId);store.finish(standards.id,{kind:'reviewed',candidate:'c'.repeat(40),approved:false,notes:'Fix the ownership breach.'},config);assert.equal(store.task(child.id).state,'implementing');
    const correction=store.claimCoordinated(child.id,'builder',false,config)!;store.finish(correction.id,{kind:'built',candidate:'d'.repeat(40),verified:true},config);assert.equal(store.task(child.id).reviewVerdicts,undefined);
    for(const axis of ['spec','standards'] as const){const assignment=store.claimCoordinated(child.id,'reviewer',false,config,axis)!;store.finish(assignment.id,{kind:'reviewed',candidate:'d'.repeat(40),approved:true,notes:axis+' passed.'},config);}
    assert.equal(store.task(child.id).state,'complete');assert.equal(store.task(child.id).reviewVerdicts!.spec!.candidate,'d'.repeat(40));
    const loop=store.reserveParallelTicket(parent,{id:'C',title:'C',status:'todo',path:'C.md',body:'scope',revision:'C',dependsOn:[]});
    for(let round=0;round<3;round++){
      const builder=store.claimCoordinated(loop.id,'builder',false,config)!;store.finish(builder.id,{kind:'built',candidate:'e'.repeat(40),verified:true},config);
      const spec=store.claimCoordinated(loop.id,'reviewer',false,config,'spec')!;store.finish(spec.id,{kind:'reviewed',candidate:'e'.repeat(40),approved:true,notes:'Spec still passes.'},config);
      const standards=store.claimCoordinated(loop.id,'reviewer',false,config,'standards')!;store.finish(standards.id,{kind:'reviewed',candidate:'e'.repeat(40),approved:false,notes:'The unchanged implementation still has defect wording '+round},config);
    }
    assert.equal(store.task(loop.id).state,'blocked');assert.equal(store.task(loop.id).blockerKind,'technical');assert.equal(store.task(loop.id).unchangedCandidateReviews,3);
    assert.throws(()=>projectSchema.parse({...project,team:project.team!.filter(person=>person.id!=='two')}),/different independent/);
    const flexible=projectSchema.parse({...project,id:'flexible',team:[{id:'lead',name:'Lead',roles:['lead']},{id:'author',name:'Author',roles:['builder']},{id:'both',name:'Both axes',roles:['reviewer']},{id:'spec-only',name:'BA Spec',roles:['ba','reviewer'],reviewAxes:['spec']}]});
    const other={...parent,id:randomUUID(),projectId:flexible.id,artifacts:{project_snapshot:flexible},parallel:{...parent.parallel,ticketRuns:{},wave:[]},children:{}};store.saveRun(other);const flexibleChild=store.reserveParallelTicket(other,{id:'D',title:'D',status:'todo',path:'D.md',body:'scope',revision:'D',dependsOn:[]});const author=store.claimCoordinated(flexibleChild.id,'builder',false,config)!;store.finish(author.id,{kind:'built',candidate:'f'.repeat(40),verified:true},config);
    const flexibleSpec=store.claimCoordinated(flexibleChild.id,'reviewer',false,config,'spec')!;assert.equal(flexibleSpec.participantId,'spec-only');store.finish(flexibleSpec.id,{kind:'reviewed',candidate:'f'.repeat(40),approved:true,notes:'Spec approved.'},config);const flexibleStandards=store.claimCoordinated(flexibleChild.id,'reviewer',false,config,'standards')!;assert.equal(flexibleStandards.participantId,'both');
  }finally{store.close();}
});
