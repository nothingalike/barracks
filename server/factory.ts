import {ProjectAuthority} from './project-authority.ts';
import {loadProjectTransfer} from './transfer-seed.ts';
import {adoptProjectTransfer} from './transfer-adoption.ts';
import {randomUUID} from 'node:crypto';
import {runInputSchema,ticketPlanSchema,type WorkflowRun} from '../shared/factory.ts';
import {currentState,stateInputs,transition,type HandoffResult,type WorkflowState} from '../shared/state-machine.ts';
import {runtimeSettings,pinProject,runProject} from './projects.ts';
import {Store} from './store.ts';
import {Runner} from './runner.ts';
import {DiscoveryAgent,InvalidWorkerOutput,validateAcceptance} from './discovery-agent.ts';
import {deliveryCandidate} from './delivery-candidate.ts';
import {TicketExecutors,type TicketWorker} from './ticket-executors.ts';
import {Pmt} from './pmt.ts';
import {workflows,resolveDeliveryWorkflow} from './workflow-definitions.ts';
import {personaContents} from './personas.ts';
import {ParallelDelivery} from './parallel-delivery.ts';
import {IntegrationConflict} from './parallel-source.ts';
import {inspectDelivery} from './delivery-frontier.ts';
import {validateRunEvidence} from './acceptance-evidence.ts';
import {leadDelegationUpdateSchema} from '../shared/project-policy.ts';
export {workflows} from './workflow-definitions.ts';
export class Factory {
  private jobs=new Map<string,{controller:AbortController;done:Promise<void>;phase:string;workflowId:string}>();
  private timer:ReturnType<typeof setInterval>|null=null;private closing=false;
  private store:Store;private runner:Runner;private agent:DiscoveryAgent;private tickets:TicketExecutors;
  private parallel:ParallelDelivery;private authority=new ProjectAuthority();
  constructor(store:Store,runner:Runner,agent=new DiscoveryAgent(),ticketWorker?:TicketWorker){this.store=store;this.runner=runner;this.agent=agent;this.tickets=new TicketExecutors(store,runner,ticketWorker);this.parallel=new ParallelDelivery(store);}
  create(input:unknown){
    const parsed=runInputSchema.parse(input),definitions=workflows(),requested=definitions.find(item=>item.id===parsed.workflowId);if(!requested)throw Error('Choose a configured workflow.');
    if(requested.internal)throw Error('This ticket workflow is launched only by its parent delivery.');
    const project=pinProject(this.project(parsed.projectId)),definition=resolveDeliveryWorkflow(project,requested,definitions),personaInstructions:Record<string,string>={};parsed.workflowId=definition.id;
    if(parsed.ticketConcurrency!==undefined){if(!definition.ticketWorkflowId)throw Error('Ticket concurrency applies only to parallel delivery workflows.');definition.maxConcurrentTickets=parsed.ticketConcurrency;}
    for(const id of definition.participants)personaInstructions[id]=personaContents(id);
    const artifacts:Record<string,unknown>={task:{title:parsed.title,description:parsed.description,epicId:parsed.epicId},project_snapshot:project,project:{id:project.id,name:project.name,instructions:project.instructions,reviewCriteria:project.reviewChecklist},discussion:[]};
    if(requested.id!==definition.id)artifacts.workflow_selection={requestedWorkflowId:requested.id,workflowId:definition.id,ticketWorkflowId:definition.ticketWorkflowId,reason:'Project delivery policy requires a compatible ticket review workflow.'};
    const transferred=loadProjectTransfer(project);if(transferred)artifacts.transfer_snapshot=transferred;
    if(definition.kind==='delivery'){
      if(!definition.ticketWorkflowId&&project.delivery&&(project.delivery.selection==='explicit'||project.delivery.excludeRollups||project.delivery.excludeLabels.length||project.delivery.requirePathGrants||project.delivery.reviewAxes.length||project.delivery.evidencePolicy==='explicit'||project.delivery.requireEvidenceKinds.length||project.delivery.completion==='accepted'||project.delivery.publication==='reviewed-branch'))throw Error('This project requires scoped parallel delivery so its ticket-selection policy is enforced.');
      if(parsed.ticketIds&&!definition.ticketWorkflowId)throw Error('Scoped ticket delivery requires a parallel parent workflow.');
      const epic=new Pmt(project).list().find(item=>item.id===parsed.epicId&&!item.epic);if(!epic)throw Error('Select a project epic to deliver.');artifacts.epic=epic;
      if(this.store.runs().some(run=>run.projectId===parsed.projectId&&run.epicId===parsed.epicId&&!['complete','cancelled'].includes(run.status)))throw Error('This epic already has an unfinished task.');
    }
    const now=new Date().toISOString(),run:WorkflowRun={...parsed,id:randomUUID(),definition,phase:definition.initial,status:'queued',createdAt:now,updatedAt:now,turns:[],questions:[],message:'Workflow queued.',recovery:false,attempts:[],artifacts,personaInstructions,handoffs:[]};
    if(definition.ticketWorkflowId){
      const frontier=inspectDelivery(project,parsed.epicId!,parsed.ticketIds);if(frontier.blockers.length)throw Error(frontier.blockers.join('\n'));run.artifacts.delivery_frontier=frontier;
      const ticket=definitions.find(item=>item.id===definition.ticketWorkflowId);if(!ticket||!ticket.internal||ticket.ticketWorkflowId)throw Error('Choose a nonrecursive internal ticket workflow.');
      const graphAxes=[...new Set(Object.values(ticket.states).flatMap(state=>state.reviewAxis?[state.reviewAxis]:[]))];
      if(graphAxes.length&&(!project.team||graphAxes.some(axis=>!project.delivery?.reviewAxes.includes(axis))))throw Error('Configure the project team and every Spec/Standards review axis used by this qualified workflow.');
      for(const axis of project.delivery?.reviewAxes??[])if(!Object.values(ticket.states).some(state=>state.role==='reviewer'&&state.reviewAxis===axis))throw Error('Choose a ticket workflow with the required '+axis+' review stage.');
      if(this.store.runs().some(other=>!other.parentRunId&&other.projectId===parsed.projectId&&!['complete','cancelled'].includes(other.status)))throw Error('A project delivery is already active; preserve its working-tree publication authority.');
      run.ticketDefinition=ticket;run.ticketPersonaInstructions=Object.fromEntries(ticket.participants.map(id=>[id,personaContents(id)]));
    }
    try{this.own(run,true);this.enter(run);this.store.saveRun(run);}catch(error){this.authority.release(project,run.id);throw error;}this.tick();return run;
  }
  private own(run:WorkflowRun,claim=false){
    const parent=run.parentRunId?this.store.run(run.parentRunId):run;if(!parent.definition.ticketWorkflowId)return;
    const project=runProject(parent);if(claim||parent.artifacts.coordinator_epoch===undefined){const owned=this.authority.owns(project,parent.id);parent.artifacts.coordinator_epoch=this.authority.acquire(project,parent.id);try{adoptProjectTransfer(project,parent.id,Number(parent.artifacts.coordinator_epoch));}catch(error){if(!owned)this.authority.release(project,parent.id);throw error;}if(parent.id!==run.id)this.store.saveRun(parent);}
    this.authority.assert(project,parent.id,Number(parent.artifacts.coordinator_epoch));
  }
  start(){
    for(const run of this.store.runs())if(!['complete','cancelled'].includes(run.status)&&(!run.definition.states||run.status==='running')){run.status='waiting';run.recovery=true;run.message=run.definition.states?'Runner interrupted. Reconcile the saved state before retrying.':'This task predates configured state graphs. Its records are retained; start a new configured task.';this.store.saveRun(run);}
    this.timer=setInterval(()=>this.tick(),300);this.tick();
  }
  tick(){
    if(this.closing||this.store.paused)return;
    for(const run of this.store.runs().reverse()){
      if(run.status==='waiting'&&!run.recovery&&!run.cancelRequested&&!this.jobs.has(run.id)&&run.definition.states){
        const state=currentState(run.definition,run.phase),wave=run.parallel?.wave;
        if(state.type==='human'&&state.on.children_ready&&wave?.length){
          const children=wave.map(ticket=>run.parallel!.ticketRuns[ticket]).map(id=>id?this.store.run(id):undefined);
          if(children.every(child=>child&&!child.recovery&&!child.cancelRequested&&['queued','running','complete'].includes(child.status))){
            try{this.own(run);this.accept(run,{event:'children_ready',document:'The blocked ticket workflows have resumed. Continue their configured delivery gates.'},'runner');}
            catch(error){run.status='waiting';run.recovery=true;run.message=String(error);this.store.saveRun(run);}
          }
        }
      }
      if(!['queued','running'].includes(run.status)||run.cancelRequested||this.jobs.has(run.id)||!run.definition.states)continue;
      if(run.parentRunId){const parent=this.store.run(run.parentRunId);if(parent.recovery||parent.cancelRequested||parent.status==='cancelled'||!run.artifacts.routing_ready)continue;}
      const state=currentState(run.definition,run.phase);
      if([...this.jobs.values()].filter(job=>job.workflowId===run.workflowId&&job.phase===run.phase).length>=state.parallelism)continue;
      const controller=new AbortController(),done=this.step(run,state,controller.signal).catch(error=>{if(this.closing)return;const latest=this.store.run(run.id);if(latest.status==='cancelled')return;latest.status='waiting';latest.recovery=true;latest.message=error instanceof Error?error.message:String(error);this.store.saveRun(latest);}).finally(()=>this.jobs.delete(run.id));
      this.jobs.set(run.id,{controller,done,phase:run.phase,workflowId:run.workflowId});
    }
  }
  private enter(run:WorkflowRun){
    const state=currentState(run.definition,run.phase);
    for(const id of state.requires)if(!Object.hasOwn(run.artifacts,id))throw Error('Final state requires artifact: '+id);
    run.message=state.message??(state.type==='human'?state.instructions||'Your input is needed.':state.label??'State: '+run.phase);
    if(state.type==='human'){stateInputs(state,run.artifacts);run.status='waiting';run.questions=Array.isArray(run.artifacts.questions)?run.artifacts.questions.filter((value):value is string=>typeof value==='string'):[];}
    else if(state.type==='final'){if(run.artifacts.acceptance_candidate)validateRunEvidence(run,String(run.artifacts.acceptance_candidate));if(run.ticketOrder||run.definition.kind==='delivery')this.tickets.assertComplete(run);if(run.artifacts.acceptance_candidate&&deliveryCandidate(run).candidate!==run.artifacts.acceptance_candidate)throw Error('Acceptance is stale for the final candidate.');if(run.parallel&&runProject(run).delivery?.completion==='accepted'&&!run.parallel.trackerPublished)throw Error('Accepted delivery must publish its canonical ticket completion before finishing.');if(run.parallel&&run.parallel.publication?.candidate!==run.baseCandidate)throw Error('Parallel delivery requires accepted source publication before completion.');run.status='complete';run.questions=[];if(run.definition.ticketWorkflowId)this.authority.release(runProject(run),run.id);}
    else run.status='queued';
  }
  private async step(run:WorkflowRun,state:WorkflowState,signal:AbortSignal){
    if(run.parallel?.repairPending){this.accept(run,{event:'repair_started',document:'Recovered the atomically reserved combined-source repair.'},'runner');return;}
    run.status='running';if(['retrospective','resolve-delivery'].includes(state.executor??''))run.artifacts.execution_evidence=this.tickets.evidence(run);this.store.saveRun(run);this.own(run);if(state.executor==='acceptance'&&run.parallel)this.parallel.recordSourceReviews(run);const inputs=stateInputs(state,run.artifacts);let result:HandoffResult|null;
    if(state.type==='agent'){
      try{
        const recoveryKey=run.resumeState+':'+run.baseCandidate;
        if(state.executor==='resolve-delivery'&&(run.deliveryResolutionAttempts?.[recoveryKey]??0)>=state.attemptLimit){
          result={event:'blocked',document:'The configured workflow-level Lead recovery budget was exhausted.',questions:['Resolve the repeated delivery failure before retrying the saved state.']};
        }else if(['conversation','acceptance','retrospective','resolve-delivery','integrate-tickets'].includes(state.executor??'')){
          if(state.executor==='integrate-tickets'){
            try{this.parallel.plan(run);}catch(error){run.artifacts.integration_plan={error:String(error)};result=error instanceof IntegrationConflict&&error.tree?this.parallel.repair(run,error.message,error.tree):{event:'technical_blocker',document:String(error),questions:[String(error)]};this.accept(run,result,'runner');return;}
          }
          if(state.executor==='resolve-delivery'){run.deliveryResolutionAttempts??={};run.deliveryResolutionAttempts[recoveryKey]=(run.deliveryResolutionAttempts[recoveryKey]??0)+1;this.store.saveRun(run);}
          const project=runProject(run),resources=['acceptance','integrate-tickets'].includes(state.executor??'')?project.verify.flatMap(command=>command.resources??[]):[];
          const participant=this.store.claimParticipant(project,state.role??'lead',run.id,undefined,resources);
          if(!participant){run.message='Waiting for the configured project '+(state.role??'lead')+' participant.';this.store.saveRun(run);return;}
          const expected=state.executor==='acceptance'?deliveryCandidate(run).candidate:undefined;
          let reply:Awaited<ReturnType<DiscoveryAgent['run']>>;
          try{reply=await this.agent.run(run,signal,()=>this.store.saveRun(run));this.store.releaseLeases(run.id);}catch(error){if(error&&typeof error==='object'&&'cleanupConfirmed' in error&&error.cleanupConfirmed===true)this.store.releaseLeases(run.id);throw error;}
          if(expected){
            if(deliveryCandidate(run).candidate!==expected||expected!==run.artifacts.delivery_candidate)throw Error('Acceptance candidate changed during inspection.');
            const criteria=validateAcceptance(reply,(run.artifacts.acceptance_criteria as {id:string}[]).map(item=>item.id));validateRunEvidence(run,expected,criteria);run.artifacts.acceptance_evidence=criteria;result={...reply,candidate:expected,accepted:reply.event==='acceptance_passed',document:reply.document+'\n\nAcceptance criteria:\n'+criteria.map(item=>`${item.status}: ${item.criterion}\n${item.evidence}`).join('\n\n')};
          }else{if(state.executor==='integrate-tickets'&&reply.event==='integrated')this.parallel.accept(run);result=state.executor==='integrate-tickets'&&reply.event==='changes'?this.parallel.repair(run,reply.document,run.parallel!.plan!.candidate):reply;}
        }else result=await this.tickets.execute(run,state,inputs,signal);
        if(run.outputRetries)delete run.outputRetries[run.phase];
      }
      catch(error){if(!(error instanceof InvalidWorkerOutput)||!state.on.invalid_output||(run.outputRetries?.[run.phase]??0)>=state.maxOutputRetries)throw error;run.outputRetries??={};run.outputRetries[run.phase]=(run.outputRetries[run.phase]??0)+1;result={event:'invalid_output',document:error.message,questions:[]};}
    }else if(state.type==='operation'){
      switch(state.executor){
        case 'select-ticket':result=this.tickets.select(run);break;
        case 'accept-ticket':result=this.tickets.accept(run);break;
        case 'reopen-ticket':result=run.parallel?this.parallel.repair(run,String(run.artifacts.acceptance_report)):this.tickets.reopen(run);break;
        case 'deliver-tickets':result=this.parallel.dispatch(run);break;
        case 'publish-source':result=this.parallel.publish(run);break;
        case 'publish-tickets':{
          const specification=inputs.specification,plan=ticketPlanSchema.parse(inputs.ticket_plan);if(typeof specification!=='string'||!specification.trim())throw Error('Ticket publication requires an Architect specification.');
          run.specification=specification;run.pendingPlan=plan;this.store.saveRun(run);const project=runProject(run);new Pmt(project).publish(project,run,plan,()=>this.store.saveRun(run));delete run.pendingPlan;
          result={event:'published',epic:{id:run.outputEpicId},tickets:run.outputTickets};break;
        }
        default:throw Error('Unsupported operation executor.');
      }
    }else{this.enter(run);this.store.saveRun(run);return;}
    if(signal.aborted||this.closing||this.store.run(run.id).status==='cancelled'||this.store.run(run.id).cancelRequested)return;
    if(result)this.accept(run,result);else{run.message='Waiting for configured execution capacity.';this.store.saveRun(run);}
  }
  accept(run:WorkflowRun,result:HandoffResult,origin:'worker'|'human'|'runner'='worker'){
    const from=run.phase,state=currentState(run.definition,from),next=transition(run.definition,from,result,run.artifacts,run.resumeState);
    if(state.type==='agent'&&origin==='worker'){run.turns.push({role:result.event==='invalid_output'?'runner':state.persona!,document:typeof result.document==='string'?result.document:result.event,questions:result.questions??[],at:new Date().toISOString()});}
    run.artifacts=next.artifacts;run.artifacts.discussion=run.turns;run.resumeState=next.resumeState;run.phase=next.target;run.recovery=false;
    if(result.event==='repair_started'&&run.parallel)delete run.parallel.repairPending;
    run.handoffs.push({from,event:result.event,to:run.phase,artifacts:next.emitted,at:new Date().toISOString()});
    const budget=run.definition.maxAutomaticExchanges,sinceUser=run.turns.slice(run.turns.map(turn=>turn.role).lastIndexOf('user')+1).length;
    if(budget!==null&&sinceUser>=budget&&currentState(run.definition,run.phase).type==='agent'){
      const target=run.definition.onExhausted!;run.resumeState=run.phase;run.handoffs.push({from:run.phase,event:'budget_exhausted',to:target,artifacts:['questions'],at:new Date().toISOString()});run.phase=target;run.artifacts.questions=['The configured exchange budget was reached. What direction should the team use?'];
    }
    this.enter(run);this.store.saveRun(run);
  }
  project(id:string){const project=runtimeSettings().projects.find(project=>project.id===id);if(!project)throw Error('Project configuration no longer exists.');return project;}
  adoptLeadDelegation(id:string,input:unknown){
    const update=leadDelegationUpdateSchema.parse(input);
    if(!this.store.paused)throw Error('Pause new assignments before changing delivery delegation.');
    const parent=this.store.run(id),family=this.store.runs().filter(run=>run.id===id||run.parentRunId===id);
    if(family.some(run=>this.jobs.has(run.id)))throw Error('Wait for current workflow execution to finish before changing delegation.');
    if(parent.parentRunId||!parent.definition.ticketWorkflowId||['complete','cancelled'].includes(parent.status))throw Error('Choose an unfinished parent delivery.');
    this.own(parent,true);this.store.saveRun(parent);return this.store.adoptLeadDelegation(id,update);
  }
  async resume(id:string,answer:string,event='answered'){
    const run=this.store.run(id);if(run.status!=='waiting'||!answer.trim())throw Error('Provide an answer or reconciliation note for this waiting task.');
    if(event==='children_ready')throw Error('Child progress is a runner-owned handoff.');
    if(run.cancelRequested)throw Error('Cancellation still requires cleanup. Retry cancellation before resuming.');
    if(!run.definition.states)throw Error('This historical task has no pinned state graph. Its records are retained; start a new configured task.');
    const waiting=currentState(run.definition,run.phase);
    if(waiting.type==='human'&&!Object.hasOwn(waiting.on,event))throw Error('This decision is not configured for the waiting state.');
    if(waiting.type!=='human'&&event!=='answered')throw Error('Recovery requires a reconciliation answer.');
    if(run.recovery){await this.agent.reconcile(run);this.store.releaseLeases(run.id);}
    new Pmt(runProject(run)).reconcile();
    if(run.parallel)for(const id of Object.values(run.parallel.ticketRuns)){const child=this.store.run(id);if(child.status==='waiting')await this.resume(id,answer);}
    const changed=run.parallel?false:await this.tickets.reconcile(run,answer);run.turns.push({role:'user',document:answer,questions:[],at:new Date().toISOString()});run.artifacts.discussion=run.turns;run.artifacts.answers=answer;run.questions=[];run.recovery=false;
    if(run.outputRetries)delete run.outputRetries[run.phase];
    if(!run.parentRunId)this.own(run,true);
    const state=currentState(run.definition,run.phase);
    if(state.type==='human'||changed){this.accept(run,{event:changed?'source_changed':event,answer},'human');}
    else{run.status='queued';run.message='Reconciled. Retrying the saved workflow state.';this.store.saveRun(run);}
    this.tick();return run;
  }
  async cancel(id:string){
    const run=this.store.run(id);if(['complete','cancelled'].includes(run.status))throw Error('Task is already finished.');
    run.cancelRequested=true;run.message='Cancellation requested; draining owned ticket workflows.';this.store.saveRun(run);
    const job=this.jobs.get(id);job?.controller.abort();await job?.done;const latest=this.store.run(id);
    if(latest.parallel)for(const childId of Object.values(latest.parallel.ticketRuns)){const child=this.store.run(childId);if(!['complete','cancelled'].includes(child.status))await this.cancel(childId);}
    await this.agent.reconcile(latest);this.store.releaseLeases(latest.id);await this.tickets.cancel(latest);latest.status='cancelled';latest.cancelRequested=false;latest.message='Task cancelled; source, artifacts and history retained.';if(latest.definition.ticketWorkflowId)this.authority.release(runProject(latest),latest.id);return this.store.saveRun(latest);
  }
  stop(){this.closing=true;if(this.timer)clearInterval(this.timer);for(const job of this.jobs.values())job.controller.abort();}
  async drained(){await Promise.all([...this.jobs.values()].map(job=>job.done));if(this.closing)this.authority.close();}
}
