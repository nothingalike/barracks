import type {WorkflowRun,PmtItem} from '../shared/factory.ts';
import type {HandoffResult} from '../shared/state-machine.ts';
import {Store} from './store.ts';
import {Pmt} from './pmt.ts';
import {runProject} from './projects.ts';
import {prepare,git,taskRoot,inventory,candidate} from './projects.ts';
import {verificationPlan} from './verification.ts';
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {initializeParallelSource,planParallelIntegration,acceptParallelIntegration,publishParallelSource} from './parallel-source.ts';
import {assertFrontierCurrent,type DeliveryFrontier} from './delivery-frontier.ts';
import {ticketCriteria} from '../shared/ticket-criteria.ts';
import {validateRequirements,type EvidenceRequirement} from '../shared/evidence.ts';

import {validateRunEvidence} from './acceptance-evidence.ts';
import {seedTransferredTicket} from './transfer-seed.ts';
import {completeTransferredAssignments} from './transfer-adoption.ts';
import {EvidenceLedger} from './evidence-ledger.ts';

export class ParallelDelivery {
  private store:Store;
  constructor(store:Store){this.store=store;}
  private project(run:WorkflowRun){return runProject(run);}
  private route(run:WorkflowRun,child:WorkflowRun,pmt:Pmt){
    if(child.artifacts.routing_ready)return;
    if(typeof child.artifacts.seed_tree==='string'){const context=prepare(this.store.task(child.id));git(context.root,['read-tree','--reset','-u',child.artifacts.seed_tree]);if(Array.isArray(child.artifacts.repair_verification)&&child.artifacts.repair_verification.length)writeFileSync(join(context.root,'verification.json'),JSON.stringify(child.artifacts.repair_verification));}
    else{const task=this.store.task(child.id),context=seedTransferredTicket(run,child,task,this.project(run));if(context)this.store.recordTransferSeed(child,context,inventory(prepare(task).workspace));}
    pmt.move(child.ticketId!,'in-progress');child.artifacts.routing_ready=true;this.store.saveRun(child);
  }
  dispatch(run:WorkflowRun):HandoffResult|null{
    const project=this.project(run),pmt=new Pmt(project);
    if(!run.parallel){
      const current=pmt.list(),frontier=run.artifacts.delivery_frontier as DeliveryFrontier|undefined;
      const tickets=frontier?.tickets??current.filter(item=>item.epic===run.epicId);if(!tickets.length)throw Error('This epic has no tickets.');
      if(frontier)assertFrontierCurrent(frontier,current,tickets.map(ticket=>ticket.id));
      const ids=new Set(tickets.map(ticket=>ticket.id)),visited=new Set<string>(),visiting=new Set<string>();
      const visit=(id:string)=>{if(visiting.has(id))throw Error('Ticket dependency cycle: '+id);if(visited.has(id))return;visiting.add(id);for(const dependency of tickets.find(item=>item.id===id)!.dependsOn)if(ids.has(dependency))visit(dependency);visiting.delete(id);visited.add(id);};for(const id of ids)visit(id);
      initializeParallelSource(run,project);run.ticketOrder=tickets.map(item=>item.id);run.artifacts.ticket_catalog=tickets;
      // Existing complete scope belongs to the captured project baseline; acceptance still covers it.
      run.completedTickets=tickets.filter(ticket=>ticket.status==='complete').map(ticket=>ticket.id);this.store.saveRun(run);
    }
    const parallel=run.parallel!,tickets=run.artifacts.ticket_catalog as PmtItem[];
    if(parallel.wave.length){
      // Reservations are individually transactional; reconcile a wave interrupted between children.
      for(const id of parallel.wave)if(!parallel.ticketRuns[id]){const ticket=tickets.find(item=>item.id===id);if(!ticket)throw Error('A reserved ticket is missing from the pinned catalog.');this.store.reserveParallelTicket(run,ticket);}
      const children=parallel.wave.map(id=>this.store.run(parallel.ticketRuns[id]!));
      for(const child of children)this.route(run,child,pmt);
      const blocked=children.filter(child=>child.status==='waiting'||child.status==='cancelled');
      if(blocked.length)return {event:'blocked',document:'Ticket workflows need resolution.',questions:blocked.map(child=>child.title+': '+(child.questions.join(' ')||child.message)+' (workflow '+child.id+')')};
      if(children.every(child=>child.status==='complete'))return {event:'wave_ready',document:'Every ticket in this batch passed independent review. Lead integration is next.'};
      return null;
    }
    const completed=new Set(run.completedTickets),remaining=tickets.filter(ticket=>!completed.has(ticket.id));
    if(!remaining.length){
      if(project.delivery?.evidencePolicy==='explicit'){
        const requirements=tickets.flatMap(ticket=>{const id=run.children?.[ticket.id];return id?this.store.task(id).evidenceRequirements??[]:ticket.evidenceRequirements??[];});
        if(!validateRequirements(tickets.flatMap(ticketCriteria),requirements,[...new Set(['command' as const,...project.delivery.requireEvidenceKinds])]))throw Error('Delivered scope needs complete criterion/evidence mapping before acceptance.');
        run.artifacts.acceptance_requirements=requirements;
      }else if(project.delivery?.requireEvidenceKinds.length)run.artifacts.acceptance_requirements=tickets.flatMap(ticketCriteria).map(criterion=>({criterion:criterion.id,kinds:project.delivery!.requireEvidenceKinds} satisfies EvidenceRequirement));
      const criteria=tickets.flatMap(ticket=>{
        const section=/^##\s+Acceptance Criteria\s*\r?\n([\s\S]*?)(?=^##\s|$(?![\s\S]))/im.exec(ticket.body)?.[1]??'';
        const values=section.split(/\r?\n/).filter(line=>/^\s*[-*]\s+/.test(line)).map(line=>line.replace(/^\s*[-*]\s+(?:\[[ xX]\]\s*)?/,''));
        if(!values.length)throw Error('Ticket '+ticket.id+' needs explicit acceptance criteria.');return values.map((description,index)=>({id:ticket.id+':'+(index+1),description}));
      });return {event:'all_done',candidate:run.baseCandidate,tickets,criteria};
    }
    const catalogIds=new Set(tickets.map(ticket=>ticket.id)),external=pmt.list();
    const ready=remaining.filter(ticket=>ticket.dependsOn.every(id=>catalogIds.has(id)?completed.has(id):external.find(item=>item.id===id)?.status==='complete')).slice(0,run.definition.maxConcurrentTickets??1);
    if(!ready.length)throw Error('No dependency-ready ticket is available. Resolve missing/external dependencies.');
    const frontier=run.artifacts.delivery_frontier as DeliveryFrontier|undefined;if(frontier)assertFrontierCurrent(frontier,external,ready.map(ticket=>ticket.id));
    parallel.wave=ready.map(ticket=>ticket.id);
    for(const ticket of ready){const child=this.store.reserveParallelTicket(run,ticket);this.route(run,child,pmt);}
    this.store.saveRun(run);return null;
  }
  plan(run:WorkflowRun){
    const ids=run.parallel!.repairTicketId?[run.parallel!.repairTicketId]:run.parallel!.wave;
    const tasks=ids.map(id=>this.store.task(run.children![id]!));
    const plan=planParallelIntegration(run,tasks,this.project(run));
    run.artifacts.integration_plan={candidate:plan.candidate,baseline:run.baseCandidate,tickets:plan.tickets,scope:run.artifacts.ticket_catalog};this.store.saveRun(run);return plan;
  }
  accept(run:WorkflowRun){acceptParallelIntegration(run);}
  recordSourceReviews(run:WorkflowRun){
    const requested=(run.artifacts.acceptance_requirements as EvidenceRequirement[]|undefined)?.filter(item=>item.kinds.includes('source'))??[];if(!requested.length)return;
    if(!run.baseCandidate)throw Error('Source evidence requires an exact candidate.');
    const ledger=new EvidenceLedger(run.id),existing=ledger.list(run.baseCandidate);
    const required=requested.filter(item=>!existing.some(receipt=>(!receipt.criterion||receipt.criterion===item.criterion)&&((receipt.status==='passed'&&(receipt.kind==='source'||receipt.origin==='operator'&&receipt.kind==='adjudication'&&receipt.covers?.includes('source')))||(receipt.origin==='operator'&&receipt.kind==='waiver'&&receipt.status==='waived'))));if(!required.length)return;
    if(!run.parallel||run.parallel.wave.length||run.parallel.plan||!run.baseCandidate||candidate(taskRoot({id:run.id}))!==run.baseCandidate||typeof run.artifacts.integration_review!=='string'||!run.artifacts.integration_review.trim())throw Error('Source evidence requires the unchanged Lead-reviewed combined candidate.');
    const axes=this.project(run).delivery?.reviewAxes??[],assignments=this.store.assignments();
    const owners=(run.artifacts.ticket_catalog as PmtItem[]).filter(ticket=>ticketCriteria(ticket).some(criterion=>required.some(requirement=>requirement.criterion===criterion.id)));
    if(required.some(requirement=>!owners.some(ticket=>ticketCriteria(ticket).some(criterion=>criterion.id===requirement.criterion))))throw Error('Source evidence requires the owning delivered criterion.');
    const tickets=owners.map(({id:ticketId})=>{
      if(!run.completedTickets?.includes(ticketId)||!run.children?.[ticketId])throw Error('Source evidence requires every ticket to be integrated.');
      const task=this.store.task(run.children[ticketId]!);if(task.state!=='complete'||!task.verified||!task.candidate||!task.author||candidate(taskRoot(task))!==task.candidate)throw Error('Source review candidate changed before acceptance.');
      const reviews=axes.length?axes.map(axis=>{const verdict=task.reviewVerdicts?.[axis];if(!verdict?.approved||verdict.candidate!==task.candidate)throw Error('Source evidence requires all configured review axes.');return verdict;}):assignments.filter(item=>item.taskId===task.id&&item.role==='reviewer'&&item.status==='finished'&&item.candidate===task.candidate).slice(0,1).map(item=>({candidate:task.candidate!,reviewer:item.worker,assignmentId:item.id,approved:true,notes:task.reviewNotes??''}));
      for(const review of reviews)if(!assignments.some(item=>item.id===review.assignmentId&&item.taskId===task.id&&item.role==='reviewer'&&item.status==='finished'&&item.worker===review.reviewer&&item.candidate===task.candidate))throw Error('Source evidence requires completed independent review assignments.');
      return {ticketId,candidate:task.candidate,author:task.author,reviews:reviews.map(({candidate,reviewer,assignmentId,approved,notes})=>({candidate,reviewer,assignmentId,approved,notes}))};
    });
    for(const requirement of required)ledger.sourceReview(run.baseCandidate,requirement.criterion,{candidate:run.baseCandidate,integrationReview:run.artifacts.integration_review,tickets});
  }
  repair(run:WorkflowRun,document:string,seedTree?:string):HandoffResult{
    if(!run.parallel)throw Error('Integration repair requires parallel delivery.');
    const catalog=run.artifacts.ticket_catalog as PmtItem[],wave=run.parallel.wave.length?[...run.parallel.wave]:[...run.completedTickets??[]].slice(-1);
    const target=wave.at(-1),ticket=catalog.find(ticket=>ticket.id===target);if(!ticket)throw Error('Integration repair has no ticket scope.');
    const commands=[...verificationPlan(this.project(run),taskRoot({id:run.id})),...wave.flatMap(id=>{const taskId=run.children?.[id];return taskId?verificationPlan(this.project(run),taskRoot({id:taskId})):[];})];
    const scope=catalog.map(item=>item.id+' · '+item.title+'\n'+item.body).join('\n\n');
    const concrete=Object.values(run.children??{}).map(id=>this.store.task(id).writablePaths);
    const ownedPaths=catalog.some(item=>item.ownedPaths!==undefined)||concrete.some(paths=>paths!==undefined)?[...new Set([...catalog.flatMap(item=>item.ownedPaths??[]),...concrete.flatMap(paths=>paths??[])])]:undefined;
    this.store.reserveParallelTicket(run,{...ticket,ownedPaths,title:('Repair integration: '+ticket.title).slice(0,160),body:ticket.body+'\n\n## Combined integration repair\n'+document+'\nPreserve all previously approved behavior. The repair is reviewed against the whole epic scope:\n'+scope},true,{seedTree:seedTree??run.baseCandidate!,verification:commands,wave,findings:document});
    return {event:'repair_started',document:'The configured Lead/BA/Builder/Reviewer ticket workflow owns this combined-source repair. '+document};
  }
  publish(run:WorkflowRun):HandoffResult{try{
    const project=this.project(run),pmt=new Pmt(project),frontier=run.artifacts.delivery_frontier as DeliveryFrontier|undefined;if(frontier)assertFrontierCurrent(frontier,pmt.list(),run.ticketOrder??[]);
    validateRunEvidence(run,run.baseCandidate!);
    const publication=publishParallelSource(run,project);
    if(project.delivery?.completion==='accepted'){for(const id of run.ticketOrder??[])pmt.move(id,'complete');run.parallel!.trackerPublished=true;}
    completeTransferredAssignments(run,project);
    return {event:'published',publication,document:project.delivery?.publication==='reviewed-branch'?'Reviewed branch integration and accepted Source files verified.':'Accepted source returned to the configured project folder as uncommitted changes.'};
  }catch(error){return {event:'blocked',document:String(error),questions:[String(error)]};}}
}
