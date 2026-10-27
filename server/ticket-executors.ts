import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import type {WorkflowRun} from '../shared/factory.ts';
import type {WorkflowState,HandoffResult} from '../shared/state-machine.ts';
import {configSchema,type Assignment,type Task,type WorkerResult} from '../shared/workflow.ts';
import {Store} from './store.ts';
import {Runner} from './runner.ts';
import {CodexWorker} from './codex-worker.ts';
import {runProject,prepare,candidate,taskRoot} from './projects.ts';
import {Pmt} from './pmt.ts';
import {assertFrontierCurrent,type DeliveryFrontier} from './delivery-frontier.ts';
export interface TicketWorker {
  run(assignment:Assignment,task:Task,signal:AbortSignal,instructions?:{persona:string;assignment:string;timeoutMs?:number|null}):Promise<WorkerResult>;
  reconcile(task:Task,assignments:Assignment[]):Promise<{restartImplementation?:boolean}>;
}
export class TicketExecutors {
  private store:Store;private runner:Runner;private worker:TicketWorker;
  private config=configSchema.parse(JSON.parse(readFileSync(resolve('config/workflow.json'),'utf8')));
  constructor(store:Store,runner:Runner,worker:TicketWorker=new CodexWorker()){this.store=store;this.runner=runner;this.worker=worker;}
  private project(run:WorkflowRun){return runProject(run);}
  private active(run:WorkflowRun){const entry=Object.entries(run.children??{}).find(([id])=>!run.completedTickets?.includes(id));if(!entry)throw Error('This state requires a selected unfinished ticket.');return {ticketId:entry[0],task:this.store.task(entry[1])};}
  select(run:WorkflowRun):HandoffResult{
    const pmt=new Pmt(this.project(run)),items=pmt.list();
    if(!run.ticketOrder){const tickets=items.filter(item=>item.epic===run.epicId);if(!tickets.length)throw Error('This epic has no tickets.');run.ticketOrder=tickets.map(item=>item.id);run.children={};run.completedTickets=[];const base=prepare({id:run.id,projectId:run.projectId,projectSnapshot:this.project(run)});run.baseTaskId=run.id;run.baseCandidate=candidate(base.root);}
    const active=Object.entries(run.children!).find(([id])=>!run.completedTickets!.includes(id));
    if(active){const ticket=items.find(item=>item.id===active[0]);if(!ticket)throw Error('The active ticket was removed from PMT.');pmt.move(ticket.id,'in-progress');return {event:'ticket_selected',ticket:{...ticket,status:'in-progress'}};}
    const remaining=run.ticketOrder.filter(id=>!run.completedTickets!.includes(id));if(!remaining.length){
      const tickets=run.ticketOrder.map(id=>{const item=items.find(item=>item.id===id);if(!item)throw Error('A delivered ticket was removed before acceptance.');return item;});
      const criteria=tickets.flatMap(ticket=>{
        const section=/^##\s+Acceptance Criteria\s*\r?\n([\s\S]*?)(?=^##\s|$(?![\s\S]))/im.exec(ticket.body)?.[1]??'';
        const values=section.split(/\r?\n/).filter(line=>/^\s*[-*]\s+/.test(line)).map(line=>line.replace(/^\s*[-*]\s+(?:\[[ xX]\]\s*)?/,''));
        if(!values.length)throw Error('Ticket '+ticket.id+' needs explicit acceptance criteria before cumulative acceptance.');
        return values.map((description,index)=>({id:ticket.id+':'+(index+1),description}));
      });
      return {event:'all_done',candidate:run.baseCandidate,tickets,criteria};
    }
    const ticket=remaining.map(id=>items.find(item=>item.id===id)).find(item=>item&&item.dependsOn.every(id=>items.find(other=>other.id===id)?.status==='complete'||run.completedTickets!.includes(id)));
    if(!ticket)throw Error('Remaining tickets have unresolved dependencies or were removed. Review PMT and reconcile.');
    if(ticket.status==='complete'){run.completedTickets!.push(ticket.id);return this.select(run);}
    this.store.reserveWorkflowTicket(run,ticket.id,{title:ticket.title,description:`Deliver ticket ${ticket.id} in epic ${run.epicId}. Full approved scope is supplied through the configured workflow handoff inputs. Preserve the approved predecessor source.`,projectId:run.projectId,execution:'codex',specificationReady:false,requestChangesOnce:false},ticket);
    pmt.move(ticket.id,'in-progress');
    return {event:'ticket_selected',ticket:{...ticket,status:'in-progress'}};
  }
  async execute(run:WorkflowRun,state:WorkflowState,inputs:Record<string,unknown>,signal:AbortSignal):Promise<HandoffResult|null>{
    const {task}=this.active(run),resolving=state.executor==='resolve-technical';
    if(!state.role||!state.persona)throw Error('Ticket state requires role and persona.');
    if(state.role==='reviewer'&&task.state==='implementing'&&!task.verified){
      if(!state.on.source_changed)throw Error('The review state needs a source_changed handoff to rebuild the candidate after Lead resolution.');
      return {event:'source_changed',document:'Lead resolution requires implementation and verification before fresh review.'};
    }
    if(resolving&&(task.technicalAttempts??0)>=state.attemptLimit)return {event:'blocked',document:'The configured technical-resolution budget was exhausted.',questions:[task.blocker??'Provide the resolution for this ticket.']};
    const assignment=this.store.claimCoordinated(task.id,state.role,resolving,this.config,state.reviewAxis);if(!assignment){const held=this.store.task(task.id);if(held.state==='blocked'&&held.blockerKind==='technical')return {event:'technical_blocker',document:held.blocker!,questions:[held.blocker!]};return null;}
    try{
      const delivery=run.parentRunId?this.store.run(run.parentRunId):run;
      const operatorInstructions=delivery.description.trim()?'\nOperator instructions for this delivery (apply alongside ticket scope and the project authority/review gates):\n'+delivery.description:'';
      const result=await this.worker.run(assignment,this.store.task(task.id),signal,{persona:run.personaInstructions[state.persona]!,assignment:state.instructions+'\nHandoff inputs: '+JSON.stringify(inputs)+operatorInstructions,timeoutMs:state.assignmentTimeoutMs});
      if(signal.aborted)throw Error('Worker stopped; reconcile its owned process before retrying.');
      this.store.finish(assignment.id,result,this.config);
      const after=this.store.task(task.id);
      if(after.state==='blocked'&&result.kind!=='blocked'&&result.kind!=='resolved')return {event:after.blockerKind==='technical'?'technical_blocker':'blocked',document:after.blocker??'Ticket execution needs direction.',questions:[after.blocker??'Resolve the ticket blocker.']};
      switch(result.kind){
        case 'triaged':return {event:after.specificationReady?'ready':'refine',document:result.summary??'Lead assessment completed.'};
        case 'refined':return after.state==='blocked'?{event:'technical_blocker',document:after.blocker??'Readiness handoff is incomplete.',questions:[after.blocker??'Complete the readiness handoff.']}:{event:'refined',document:result.summary??'BA readiness verified.'};
        case 'built':return {event:'implemented',candidate:result.candidate,verified:result.verified};
        case 'reviewed':return {event:result.approved?'approved':'changes',document:result.notes,approved:result.approved,candidate:result.candidate};
        case 'blocked':return {event:!resolving&&result.blockerKind==='technical'?'technical_blocker':'blocked',document:result.reason,questions:[result.reason]};
        case 'resolved':return {event:'resolved',document:result.resolution};
      }
    }catch(error){this.store.hold(assignment.id,error instanceof Error?error.message:String(error));throw error;}
  }
  accept(run:WorkflowRun):HandoffResult{
    const {ticketId,task}=this.active(run);if(task.state!=='complete'||!task.verified||!task.candidate||task.reviewCycles<1)throw Error('Only an independently verified and approved ticket can be accepted.');
    for(const axis of this.project(run).delivery?.reviewAxes??[]){const verdict=task.reviewVerdicts?.[axis];if(!verdict?.approved||verdict.candidate!==task.candidate||verdict.reviewer===task.author)throw Error('Ticket acceptance requires current independent '+axis+' review.');}
    if(task.baseTaskId!==run.baseTaskId||candidate(taskRoot(task))!==task.candidate)throw Error('Accepted source or its predecessor changed; reconcile before continuing.');
    const pmt=new Pmt(this.project(run)),frontier=run.artifacts.delivery_frontier as DeliveryFrontier|undefined;if(frontier)assertFrontierCurrent(frontier,pmt.list(),[ticketId]);
    if(!run.parentRunId||this.project(run).delivery?.completion!=='accepted')pmt.move(ticketId,'complete');run.completedTickets!.push(ticketId);run.baseTaskId=task.id;run.baseCandidate=task.candidate;return {event:'accepted',ticketId,candidate:task.candidate};
  }
  assertComplete(run:WorkflowRun){if(!run.ticketOrder||run.ticketOrder.some(id=>!run.completedTickets?.includes(id)))throw Error('The epic has unfinished or unreviewed tickets.');}
  reopen(run:WorkflowRun):HandoffResult{
    const owner=Object.entries(run.children??{}).find(([,id])=>id===run.baseTaskId);
    const ticketId=owner?.[0],childId=owner?.[1];
    if(!ticketId||!childId)throw Error('Acceptance changes require a delivered ticket. Create a follow-up ticket for previously completed source.');
    const task=this.store.task(childId),report=run.artifacts.acceptance_report;
    if(typeof report!=='string'||!report.trim()||task.candidate!==run.artifacts.delivery_candidate||candidate(taskRoot(task))!==task.candidate)throw Error('Acceptance findings must refer to the unchanged delivered candidate.');
    const ticket=new Pmt(this.project(run)).list().find(item=>item.id===ticketId);if(!ticket)throw Error('The acceptance repair ticket no longer exists.');
    new Pmt(this.project(run)).move(ticketId,'in-progress');
    this.store.reopenForAcceptance(task.id,report);
    run.completedTickets=run.completedTickets!.filter(id=>id!==ticketId);run.baseTaskId=task.baseTaskId;run.baseCandidate=task.baseCandidate;
    return {event:'reopened',ticket,plan:task.plan??'Repair the supplied acceptance findings within the agreed epic scope; preserve all earlier behavior.',document:report};
  }
  evidence(run:WorkflowRun){return {handoffs:run.handoffs,turns:run.turns,attempts:run.attempts,children:Object.entries(run.children??{}).map(([ticketId,id])=>({ticketId,task:this.store.task(id),assignments:this.store.assignments().filter(assignment=>assignment.taskId===id),history:this.store.history(id)}))};}
  async reconcile(run:WorkflowRun,answer:string){let sourceChanged=false;for(const id of Object.values(run.children??{})){const task=this.store.task(id);if(task.state==='cancelled')throw Error('Cancelled tickets require a new delivery task.');if(task.state==='blocked'){const before=task.resumeState;const result=await this.worker.reconcile(task,this.store.assignments().filter(assignment=>assignment.taskId===id));const retryTechnicalResolution=run.definition.states[run.phase]?.executor==='resolve-technical'&&task.blockerKind==='recovery';this.store.resume(id,answer,{reconciled:true,...result,retryTechnicalResolution});sourceChanged ||= result.restartImplementation===true||before==='reviewing'&&this.store.task(id).state==='implementing';}}return sourceChanged;}
  async cancel(run:WorkflowRun){for(const id of Object.values(run.children??{})){
    const task=this.store.task(id);if(['complete','cancelled'].includes(task.state))continue;
    if(task.coordinated){
      const assignments=this.store.assignments().filter(item=>item.taskId===id);
      if(assignments.some(item=>item.status==='running'))throw Error('The owning workflow must drain its assignment before ticket cancellation.');
      if(assignments.length)await this.worker.reconcile(task,assignments);
      this.store.cancel(id);
    }else await this.runner.cancel(id);
  }}
}
