import {z} from 'zod';
export {workflowDefinitionSchema,type WorkflowDefinition} from './state-machine.ts';
import type {WorkflowDefinition} from './state-machine.ts';
import type {EvidenceRequirement} from './evidence.ts';
export const runInputSchema=z.object({projectId:z.string().regex(/^[a-z0-9-]+$/),workflowId:z.string().regex(/^[a-z][a-z0-9_-]*$/),title:z.string().trim().min(1).max(160),description:z.string().max(20000).default(''),epicId:z.string().max(80).optional(),ticketConcurrency:z.number().int().min(1).max(8).optional(),ticketIds:z.array(z.string().min(1).max(80)).min(1).max(1000).refine(ids=>new Set(ids).size===ids.length,'Choose each ticket once.').optional()}).strict();
export interface DiscussionTurn {role:string;document:string;questions:string[];at:string}
export interface WorkflowRun extends z.infer<typeof runInputSchema> {
  id:string;definition:WorkflowDefinition;status:'queued'|'running'|'waiting'|'complete'|'cancelled';phase:string;
  createdAt:string;updatedAt:string;turns:DiscussionTurn[];questions:string[];message:string;recovery:boolean;attempts:string[];
  specification?:string;outputEpicId?:string;outputTickets?:string[];ticketOrder?:string[];children?:Record<string,string>;baseTaskId?:string;baseCandidate?:string;
  completedTickets?:string[];pendingPlan?:TicketPlan;
  artifacts:Record<string,unknown>;personaInstructions:Record<string,string>;resumeState?:string;
  handoffs:{from:string;event:string;to:string;artifacts:string[];at:string}[];
  outputRetries?:Record<string,number>;
  deliveryResolutionAttempts?:Record<string,number>;
  parentRunId?:string;ticketId?:string;ticketDefinition?:WorkflowDefinition;ticketPersonaInstructions?:Record<string,string>;
  cancelRequested?:boolean;
  parallel?:{commit:string;initialTree:string;initialFiles:Record<string,string>;excludedPrefixes:string[];ticketRuns:Record<string,string>;wave:string[];historyRuns?:string[];repairTicketId?:string;repairPending?:boolean;trackerPublished?:boolean;plan?:{taskId:string;candidate:string;commit:string;tickets:string[]};publication?:{candidate:string;projectPath:string;files:string[]}};
}
export const ticketPlanSchema=z.object({epic:z.object({title:z.string().min(1).max(160),description:z.string().min(1)}).strict(),tickets:z.array(z.object({title:z.string().min(1).max(160),description:z.string().min(1),acceptanceCriteria:z.array(z.string().min(1)).min(1),dependsOn:z.array(z.number().int().min(0))}).strict()).min(1).max(30)}).strict().superRefine((plan,context)=>{plan.tickets.forEach((ticket,index)=>{if(ticket.dependsOn.some(dependency=>dependency>=index))context.addIssue({code:'custom',message:'Ticket dependencies must reference earlier tickets.',path:['tickets',index,'dependsOn']});});});
export type TicketPlan=z.infer<typeof ticketPlanSchema>;
export interface PmtItem {id:string;title:string;status:string;path:string;epic?:string;dependsOn:string[];body:string;revision:string;labels?:string[];priority?:string;itemType?:string;ownedPaths?:string[];evidenceRequirements?:EvidenceRequirement[]}
