import test from 'node:test';
import assert from 'node:assert/strict';
import {deliveryWorkflowFor,resolveDeliveryWorkflow,workflows} from '../server/workflow-definitions.ts';
import {projectSchema} from '../server/projects.ts';
import {workflowDefinitionSchema} from '../shared/state-machine.ts';

test('epic default chooses a delivery graph with the configured independent reviews',()=>{
  const definitions=workflows(),misleading=workflowDefinitionSchema.parse({...definitions.find(item=>item.kind==='discovery')!,id:'discovery-with-ticket-metadata',ticketWorkflowId:'qualified-ticket'});
  const project=projectSchema.parse({id:'epic-default',name:'Epic default',kind:'fixture',path:process.cwd(),reviewChecklist:'Preserve independent reviews.',delivery:{selection:'epic',reviewAxes:['spec','standards']},team:[{id:'lead',name:'Lead',roles:['lead']},{id:'ba',name:'BA',roles:['ba','reviewer'],reviewAxes:['spec']},{id:'builder-a',name:'A',roles:['builder','reviewer'],reviewAxes:['standards']},{id:'builder-b',name:'B',roles:['builder','reviewer'],reviewAxes:['standards']}]});
  assert.equal(deliveryWorkflowFor(project,[misleading,...definitions]),'qualified-delivery');
  assert.equal(deliveryWorkflowFor({...project,delivery:undefined},definitions),undefined);
  const generic=definitions.find(item=>item.id==='parallel-delivery')!,qualified=definitions.find(item=>item.id==='qualified-delivery')!,discovery=definitions.find(item=>item.kind==='discovery')!,internal=definitions.find(item=>item.id==='qualified-ticket')!;
  assert.equal(resolveDeliveryWorkflow(project,generic,definitions),qualified);
  assert.equal(resolveDeliveryWorkflow(project,definitions.find(item=>item.id==='delivery')!,definitions),qualified,'A legacy sequential delivery choice uses the same compatible policy.');
  assert.equal(resolveDeliveryWorkflow(project,qualified,definitions),qualified,'Preserve a compatible explicit workflow choice.');
  assert.equal(resolveDeliveryWorkflow(project,discovery,definitions),discovery);
  assert.equal(resolveDeliveryWorkflow(project,internal,definitions),internal,'Public launch validation retains ownership of the internal-workflow guard.');
  assert.equal(resolveDeliveryWorkflow({...project,delivery:undefined},generic,definitions),generic);
  assert.equal(resolveDeliveryWorkflow({...project,delivery:{...project.delivery!,selection:'explicit'}},generic,definitions),generic);
  assert.throws(()=>resolveDeliveryWorkflow(project,generic,definitions.filter(item=>item.id!==qualified.id)),/No configured delivery workflow/);
  const missingSpec=workflowDefinitionSchema.parse({...internal,states:Object.fromEntries(Object.entries(internal.states).map(([id,state])=>{if(state.reviewAxis!=='spec')return [id,state];const {reviewAxis,...remaining}=state;return [id,remaining];}))});
  const invalid=definitions.map(item=>item.id===missingSpec.id?missingSpec:item);assert.equal(deliveryWorkflowFor(project,invalid),undefined,'A configured ticket graph without Spec review is incompatible.');
  assert.throws(()=>resolveDeliveryWorkflow(project,generic,invalid),/No configured delivery workflow/);
});
