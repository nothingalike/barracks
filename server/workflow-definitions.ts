import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {workflowDefinitionSchema,type WorkflowDefinition} from '../shared/state-machine.ts';
import type {Project} from './projects.ts';
function supportsDelivery(project:Project,definition:WorkflowDefinition,definitions:WorkflowDefinition[]){
  if(definition.kind!=='delivery'||definition.internal||!definition.ticketWorkflowId)return false;
  const ticket=definitions.find(item=>item.id===definition.ticketWorkflowId);
  if(!ticket?.internal||ticket.kind!=='delivery'||ticket.ticketWorkflowId)return false;
  const axes=project.delivery?.reviewAxes??[],states=Object.values(ticket.states),graphAxes=states.flatMap(state=>state.reviewAxis?[state.reviewAxis]:[]);
  return axes.every(axis=>states.some(state=>state.role==='reviewer'&&state.reviewAxis===axis))&&(!graphAxes.length||!!project.team&&graphAxes.every(axis=>axes.includes(axis)));
}
export function deliveryWorkflowFor(project:Project,definitions:ReturnType<typeof workflowDefinitionSchema.parse>[]){
  if(!project.delivery)return undefined;
  return definitions.find(definition=>supportsDelivery(project,definition,definitions))?.id;
}
export function resolveDeliveryWorkflow(project:Project,requested:WorkflowDefinition,definitions:WorkflowDefinition[]){
  if(project.delivery?.selection!=='epic'||requested.kind!=='delivery'||requested.internal||supportsDelivery(project,requested,definitions))return requested;
  const compatible=deliveryWorkflowFor(project,definitions);
  if(!compatible)throw Error('No configured delivery workflow supports this project\'s required independent reviews. Add a compatible delivery workflow to the workflow library.');
  return definitions.find(definition=>definition.id===compatible)!;
}
export const workflowFile=()=>resolve(process.env.BARRACKS_WORKFLOWS_PATH??'config/workflows.json');
export function validateTicketWorkflows(definitions:ReturnType<typeof workflowDefinitionSchema.parse>[]){
  for(const definition of definitions)if(definition.ticketWorkflowId){const ticket=definitions.find(item=>item.id===definition.ticketWorkflowId);if(definition.internal||!ticket||!ticket.internal||ticket.kind!=='delivery'||ticket.ticketWorkflowId)throw Error('Workflow '+definition.id+' requires a nonrecursive internal delivery ticket workflow.');}
}
export function workflows(){
  const parsed=workflowDefinitionSchema.array().safeParse(JSON.parse(readFileSync(workflowFile(),'utf8')));
  if(!parsed.success)throw Error('Invalid workflow configuration: '+parsed.error.issues.map(issue=>issue.path.join('.')+': '+issue.message).join('; '));
  const definitions=parsed.data;if(new Set(definitions.map(definition=>definition.id)).size!==definitions.length)throw Error('Workflow IDs must be unique.');validateTicketWorkflows(definitions);return definitions;
}
