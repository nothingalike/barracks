import {z} from 'zod';
import {reviewAxisSchema} from './participants.ts';
const reserved=new Set(['__proto__','prototype','constructor']);
const identifier=z.string().regex(/^[a-z][a-z0-9_-]*$/).refine(value=>!reserved.has(value),'Reserved identifier.');
const target=z.string().refine(value=>value==='$resume'||identifier.safeParse(value).success,'Use a state ID or $resume.');
const source=z.string().regex(/^[a-z][a-zA-Z0-9_.-]*$/).refine(value=>value.split('.').every(part=>!reserved.has(part)),'Reserved artifact path.');
export const handoffSchema=z.object({target,outputs:z.record(identifier,source).default({}),clear:z.array(identifier).default([]),guard:z.enum(['document','questions','ticket-plan','verified','approved','acceptance']).optional(),remember:z.boolean().default(false)}).strict();
const edgeSchema=z.union([target.transform(target=>handoffSchema.parse({target})),handoffSchema]);
export const stateSchema=z.object({
  type:z.enum(['agent','human','operation','final']),label:z.string().optional(),persona:identifier.optional(),
  executor:z.enum(['conversation','ticket','resolve-technical','resolve-delivery','acceptance','retrospective','integrate-tickets','deliver-tickets','publish-source','publish-tickets','select-ticket','accept-ticket','reopen-ticket']).optional(),
  role:z.enum(['lead','ba','builder','reviewer']).optional(),instructions:z.string().default(''),
  reviewAxis:reviewAxisSchema.optional(),
  inputs:z.array(identifier).default([]),optionalInputs:z.array(identifier).default([]),requires:z.array(identifier).default([]),
  parallelism:z.number().int().min(1).max(32).default(1),attemptLimit:z.number().int().min(0).max(10).default(1),
  maxOutputRetries:z.number().int().min(0).max(5).default(0),
  assignmentTimeoutMs:z.number().int().min(1000).max(2147483647).nullable().optional(),
  on:z.record(identifier,edgeSchema).default({}),message:z.string().optional(),
}).strict();
export const workflowDefinitionSchema=z.object({
  schemaVersion:z.literal(2).default(2),id:identifier,name:z.string().min(1),kind:z.enum(['discovery','delivery']),description:z.string(),
  participants:z.array(identifier).default([]),initial:identifier,states:z.record(identifier,stateSchema),
  maxAutomaticExchanges:z.number().int().min(1).nullable().default(null),
  onExhausted:identifier.optional(),
  internal:z.boolean().optional(),ticketWorkflowId:identifier.optional(),maxConcurrentTickets:z.number().int().min(1).max(8).optional(),
}).strict().superRefine((definition,context)=>{
  const ids=Object.keys(definition.states),personas=[...new Set(Object.values(definition.states).flatMap(state=>state.persona?[state.persona]:[]))];
  const issue=(message:string,path:(string|number)[]=[])=>context.addIssue({code:'custom',message,path});
  if(!definition.states[definition.initial])issue('Initial state does not exist.',['initial']);
  if(definition.maxAutomaticExchanges!==null&&(!definition.onExhausted||definition.states[definition.onExhausted]?.type!=='human'))issue('An exchange budget requires an onExhausted human state.',['onExhausted']);
  if(definition.participants.length&&(personas.some(id=>!definition.participants.includes(id))||definition.participants.some(id=>!personas.includes(id))||new Set(definition.participants).size!==definition.participants.length))issue('Participants must match the personas assigned by states.',['participants']);
  for(const [id,state] of Object.entries(definition.states)){
    if(state.reviewAxis&&(state.executor!=='ticket'||state.role!=='reviewer'))issue('Review axes belong to ticket Reviewer states.',['states',id,'reviewAxis']);
    if(state.type==='agent'&&(!state.persona||!['conversation','ticket','resolve-technical','resolve-delivery','acceptance','retrospective','integrate-tickets'].includes(state.executor??'')))issue('Agent states require a persona and worker executor.',['states',id]);
    if(state.type==='agent'&&['ticket','resolve-technical'].includes(state.executor??'')&&!state.role)issue('Ticket executors require an execution role.',['states',id,'role']);
    if(['ticket','resolve-technical','resolve-delivery','acceptance','retrospective','select-ticket','accept-ticket','reopen-ticket'].includes(state.executor??'')&&definition.kind!=='delivery')issue('Ticket execution requires delivery kind and an epic input.',['states',id,'executor']);
    if(state.executor==='resolve-technical'&&state.role!=='lead')issue('Technical resolution uses the Lead execution role.',['states',id,'role']);
    if(state.type==='operation'&&!['publish-tickets','select-ticket','accept-ticket','reopen-ticket','deliver-tickets','publish-source'].includes(state.executor??''))issue('Operation states require an operation executor.',['states',id]);
    if(['deliver-tickets','integrate-tickets','publish-source'].includes(state.executor??'')&&definition.kind!=='delivery')issue('Parallel delivery executors require a delivery workflow.',['states',id]);
    if(state.executor==='deliver-tickets'&&!definition.ticketWorkflowId)issue('Parallel delivery requires a configured ticket workflow.',['ticketWorkflowId']);
    if(state.type!=='agent'&&state.persona)issue('Only agent states assign personas.',['states',id,'persona']);
    if(state.type==='final'&&Object.keys(state.on).length)issue('Final states have no outgoing handoffs.',['states',id,'on']);
    if(state.type!=='final'&&!Object.keys(state.on).length)issue('Working and human states require handoffs.',['states',id,'on']);
    if(state.type==='human'&&!state.on.answered)issue('Human states require an answered handoff.',['states',id,'on']);
    if(state.maxOutputRetries>0&&!state.on.invalid_output)issue('Output retries require an invalid_output handoff.',['states',id,'on']);
    for(const [event,handoff] of Object.entries(state.on)){
      if(handoff.target!=='$resume'&&!definition.states[handoff.target])issue('Handoff target does not exist.',['states',id,'on',event]);
      if([...Object.keys(handoff.outputs),...handoff.clear].some(key=>['task','project','discussion'].includes(key)))issue('Task/project/discussion are runner-owned context.',['states',id,'on',event,'outputs']);
    }
  }
  const reached=new Set<string>(),visit=(id:string)=>{if(reached.has(id)||!definition.states[id])return;reached.add(id);for(const handoff of Object.values(definition.states[id]!.on))if(handoff.target!=='$resume')visit(handoff.target);};visit(definition.initial);if(definition.onExhausted)visit(definition.onExhausted);
  for(const id of ids)if(!reached.has(id))issue('State is unreachable from initial.',['states',id]);
  if(![...reached].some(id=>definition.states[id]!.type==='final'))issue('The workflow must reach a final state.',['states']);
  const resumable=ids.filter(id=>Object.values(definition.states[id]!.on).some(edge=>edge.remember));
  if(!resumable.length&&ids.some(id=>Object.values(definition.states[id]!.on).some(edge=>edge.target==='$resume')))issue('$resume requires a handoff that remembers its source state.',['states']);
  const canFinish=new Set(ids.filter(id=>definition.states[id]!.type==='final'));let changed=true;
  while(changed){changed=false;for(const id of ids)if(!canFinish.has(id)&&Object.values(definition.states[id]!.on).some(edge=>edge.target==='$resume'?resumable.some(target=>canFinish.has(target)):canFinish.has(edge.target))){canFinish.add(id);changed=true;}}
  for(const id of ids)if(!canFinish.has(id))issue('State has no route to a final state.',['states',id]);
}).transform(definition=>({...definition,participants:definition.participants.length?definition.participants:[...new Set(Object.values(definition.states).flatMap(state=>state.persona?[state.persona]:[]))]}));
export type WorkflowDefinition=z.infer<typeof workflowDefinitionSchema>;
export type WorkflowState=z.infer<typeof stateSchema>;
export interface HandoffResult {event:string;document?:string;questions?:string[];plan?:unknown;[key:string]:unknown}
export function currentState(definition:WorkflowDefinition,id:string){const state=definition.states?.[id];if(!state)throw Error('Workflow state does not exist: '+id);return state;}
export function stateInputs(state:WorkflowState,artifacts:Record<string,unknown>){
  const inputs:Record<string,unknown>={};for(const id of state.inputs){if(!Object.hasOwn(artifacts,id))throw Error('Required handoff artifact is missing: '+id);inputs[id]=artifacts[id];}for(const id of state.optionalInputs)if(Object.hasOwn(artifacts,id))inputs[id]=artifacts[id];return inputs;
}
function valueAt(result:HandoffResult,path:string):unknown{let value:unknown=result;for(const key of path.split('.')){if(reserved.has(key)||!value||typeof value!=='object'||!Object.hasOwn(value,key))throw Error('Handoff output is missing: '+path);value=(value as Record<string,unknown>)[key];}return value;}
export function transition(definition:WorkflowDefinition,from:string,result:HandoffResult,artifacts:Record<string,unknown>,resumeState?:string){
  const state=currentState(definition,from),handoff=state.on[result.event];if(!handoff)throw Error(`Event ${result.event} is not allowed in state ${from}.`);
  if(handoff.guard==='document'&&(typeof result.document!=='string'||!result.document.trim()))throw Error('This handoff requires a document.');
  if(handoff.guard==='questions'&&(!Array.isArray(result.questions)||!result.questions.length))throw Error('This handoff requires concrete user questions.');
  if(handoff.guard==='ticket-plan'&&(!result.plan||typeof result.plan!=='object'))throw Error('This handoff requires a ticket plan.');
  if(handoff.guard==='verified'&&result.verified!==true)throw Error('This handoff requires independently verified source.');
  if(handoff.guard==='approved'&&result.approved!==true)throw Error('This handoff requires independent review approval.');
  if(handoff.guard==='acceptance'&&(result.accepted!==true||typeof result.candidate!=='string'||result.candidate!==artifacts.delivery_candidate))throw Error('This handoff requires acceptance of the exact delivery candidate.');
  const target=handoff.target==='$resume'?resumeState:handoff.target;if(!target||!definition.states[target])throw Error('The handoff has no valid saved resume state.');
  const next={...artifacts};for(const name of handoff.clear)delete next[name];for(const [name,path] of Object.entries(handoff.outputs))next[name]=structuredClone(valueAt(result,path));
  return {target,artifacts:next,emitted:Object.keys(handoff.outputs),resumeState:handoff.remember?from:handoff.target==='$resume'?undefined:resumeState};
}
