import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { advance, inputSchema, resultSchema, roleFor, type Assignment, type HistoryEntry, type Stage, type Task, type TaskInput, type WorkflowConfig } from '../shared/workflow.ts';
import type {WorkflowRun,PmtItem} from '../shared/factory.ts';
import {projectSchema,type Project} from './projects.ts';
import {grantsOverlap,leadMayGrant,sourceDelegationInstructions} from '../shared/source-grants.ts';
import {leadDelegationUpdateSchema} from '../shared/project-policy.ts';
import {planReviewers,type ReviewAxis} from '../shared/participants.ts';
import {validateRequirements} from '../shared/evidence.ts';
import {ticketCriteria} from '../shared/ticket-criteria.ts';

export class Store {
  private db: DatabaseSync;
  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    try {
      this.db.exec(`PRAGMA locking_mode=EXCLUSIVE; PRAGMA synchronous=FULL;
        BEGIN EXCLUSIVE;
        CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY, state TEXT NOT NULL, data TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS assignments (id TEXT PRIMARY KEY, task_id TEXT NOT NULL, stage TEXT NOT NULL, status TEXT NOT NULL, data TEXT NOT NULL);
        CREATE UNIQUE INDEX IF NOT EXISTS one_running_task ON assignments(task_id) WHERE status='running';
        CREATE TABLE IF NOT EXISTS history (id INTEGER PRIMARY KEY AUTOINCREMENT, task_id TEXT NOT NULL, at TEXT NOT NULL, message TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS workflow_runs (id TEXT PRIMARY KEY, data TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS work_leases (project_id TEXT NOT NULL, resource TEXT NOT NULL, owner TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(project_id,resource));
        INSERT OR IGNORE INTO settings VALUES ('paused','false');
        COMMIT;`);
    } catch (error) { this.db.close(); throw error; }
  }
  close() { this.db.close(); }
  reopenForAcceptance(id:string,findings:string){this.atomic(()=>{
    const task=this.task(id);
    if(task.state==='implementing'&&!task.verified&&task.reviewNotes===findings)return;
    if(task.state!=='complete'||!task.verified||!task.candidate)throw Error('Only a reviewed candidate can be reopened for acceptance fixes.');
    this.save({...task,state:'implementing',verified:false,reviewNotes:findings,updatedAt:new Date().toISOString()});
    this.log(id,'Acceptance requested changes; Builder must fix, verify and obtain independent review again.');
  });}
  runs():WorkflowRun[]{return this.db.prepare('SELECT data FROM workflow_runs ORDER BY rowid DESC').all().map(row=>JSON.parse(row.data as string));}
  run(id:string):WorkflowRun{const run=this.runs().find(run=>run.id===id);if(!run)throw Error('Workflow task not found.');return run;}
  saveRun(run:WorkflowRun){run.updatedAt=new Date().toISOString();this.db.prepare('INSERT INTO workflow_runs VALUES (?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').run(run.id,JSON.stringify(run));return run;}
  adoptLeadDelegation(id:string,input:unknown){
    const update=leadDelegationUpdateSchema.parse(input);
    return this.atomic(()=>{
      if(!this.paused)throw Error('Pause new assignments before changing delivery delegation.');
      const parent=this.run(id);if(parent.parentRunId||!parent.definition.ticketWorkflowId||['complete','cancelled'].includes(parent.status))throw Error('Choose an unfinished parent delivery.');
      const family=[parent,...this.runs().filter(run=>run.parentRunId===id)],ids=new Set(family.map(run=>run.id)),tasks=new Map(this.tasks().map(task=>[task.id,task]));
      if(this.assignments().some(assignment=>ids.has(assignment.taskId)&&['running','interrupted'].includes(assignment.status)))throw Error('Finish or reconcile existing assignments before changing delegation.');
      const at=new Date().toISOString(),reassessments:{ticketId?:string;runId:string;previousPhase:string;previousAttempts:number}[]=[],changedTasks:string[]=[],changedRuns:string[]=[];
      const revised=(snapshot:unknown)=>{const project=projectSchema.parse(snapshot);return projectSchema.parse({...project,delivery:{...project.delivery,leadDelegation:update.mode}});};
      for(const run of family.filter(run=>!['complete','cancelled'].includes(run.status))){
        const previous=projectSchema.parse(run.artifacts.project_snapshot),project=revised(previous);run.artifacts.project_snapshot=project;changedRuns.push(run.id);
        const task=tasks.get(run.id);
        if(task&&!['complete','cancelled'].includes(task.state)){
          task.projectSnapshot=revised(task.projectSnapshot);changedTasks.push(task.id);
          if(previous.delivery?.leadDelegation!==update.mode)task.resolution=[task.resolution,'Operator source-coordination amendment at '+at+': '+sourceDelegationInstructions(project)+' This supersedes earlier source-delegation holds only. Preserve other operator/product decisions and follow the current assigned-role response contract.'].filter(Boolean).join('\n\n');
          const resolution=Object.entries(run.definition.states).find(([,state])=>state.executor==='resolve-technical'&&state.role==='lead');
          if(update.mode==='project'&&previous.delivery?.leadDelegation!=='project'&&run.status==='waiting'&&!run.recovery&&run.definition.states[run.phase]?.type==='human'&&task.state==='blocked'&&!task.cleanupRequired&&['technical','authority'].includes(task.blockerKind??'')&&task.interfaceRequest?.paths.length&&task.interfaceRequest.paths.every(path=>leadMayGrant(task.projectSnapshot as Project,path))&&task.interfaceRequest.paths.some(path=>!leadMayGrant(previous,path))&&resolution){
            reassessments.push({ticketId:run.ticketId,runId:run.id,previousPhase:run.phase,previousAttempts:task.technicalAttempts??0});
            task.technicalAttempts=0;task.blockerKind='technical';task.blocker=task.interfaceRequest.question;
            run.handoffs.push({from:run.phase,event:'delegation_updated',to:resolution[0],artifacts:['delivery_delegation'],at});run.phase=resolution[0];run.status='queued';run.questions=[];run.message='Lead will reassess the requested interface under the adopted delegation.';
          }
          this.save(task);this.log(task.id,'Operator adopted '+update.mode+' Lead delegation: '+update.reason);
        }
        run.artifacts.delivery_delegation={mode:update.mode,reason:update.reason,at,parentRunId:id};
        if(run.id!==id)this.saveRun(run);
      }
      const record={at,...update,changedRuns,changedTasks,reassessments};
      parent.artifacts.lead_delegation_history=[...(parent.artifacts.lead_delegation_history as unknown[]??[]),record];
      if(reassessments.length&&this.runs().filter(run=>run.parentRunId===id).every(run=>['queued','complete','cancelled'].includes(run.status))&&parent.definition.states[parent.phase]?.on.children_ready){parent.questions=[];parent.artifacts.questions=[];parent.message='Delegation updated. Ready to resume the paused delivery.';}
      this.saveRun(parent);return {run:parent,record};
    });
  }
  private atomic<T>(operation: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = operation(); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  private save(task: Task) {
    this.db.prepare('INSERT INTO tasks VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET state=excluded.state,data=excluded.data').run(task.id, task.state, JSON.stringify(task));
  }
  private saveAssignment(assignment: Assignment) {
    this.db.prepare('INSERT INTO assignments VALUES (?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status,data=excluded.data').run(assignment.id, assignment.taskId, assignment.stage, assignment.status, JSON.stringify(assignment));
  }
  private log(taskId: string, message: string) {
    this.db.prepare('INSERT INTO history(task_id,at,message) VALUES (?,?,?)').run(taskId, new Date().toISOString(), message);
  }
  task(id: string): Task {
    const row = this.db.prepare('SELECT data FROM tasks WHERE id=?').get(id);
    if (!row) throw new Error('Task not found.');
    return {execution:'simulation',projectId:'demo',...JSON.parse(row.data as string)} as Task;
  }
  tasks(): Task[] { return this.db.prepare('SELECT id FROM tasks ORDER BY rowid DESC').all().map(row => this.task(row.id as string)); }
  assignments(): Assignment[] { return this.db.prepare('SELECT data FROM assignments ORDER BY rowid DESC').all().map(row => JSON.parse(row.data as string) as Assignment); }
  history(id: string): HistoryEntry[] {
    return this.db.prepare('SELECT id,task_id AS taskId,at,message FROM history WHERE task_id=? ORDER BY id').all(id) as unknown as HistoryEntry[];
  }
  get paused(): boolean { return this.db.prepare("SELECT value FROM settings WHERE key='paused'").get()?.value === 'true'; }
  pause(paused: boolean) { this.db.prepare("UPDATE settings SET value=? WHERE key='paused'").run(String(paused)); }
  leases(projectId?:string):{projectId:string;resource:string;owner:string;acquiredAt:string}[]{return this.db.prepare('SELECT data FROM work_leases').all().map(row=>JSON.parse(row.data as string)).filter(lease=>!projectId||lease.projectId===projectId);}
  private participant(project:Project,role:Assignment['role'],owner:string,author?:string|null,axis?:ReviewAxis,excluded:string[]=[],reviewer?:string):{participantId?:string}|null{
    if(!project.team)return {};
    const held=this.leases(project.id),existing=held.find(lease=>lease.owner===owner&&lease.resource.startsWith('participant:'));
    if(existing)return {participantId:existing.resource.slice('participant:'.length)};
    const candidates=project.team.filter(person=>person.roles.includes(role)&&(role!=='reviewer'||person.id!==author)&&!excluded.includes(person.id)&&(!axis||!person.reviewAxes||person.reviewAxes.includes(axis))&&(!reviewer||person.id===reviewer));
    const person=candidates.find(person=>!held.some(lease=>lease.resource==='participant:'+person.id));if(!person)return null;
    const lease={projectId:project.id,resource:'participant:'+person.id,owner,acquiredAt:new Date().toISOString()};this.db.prepare('INSERT INTO work_leases VALUES (?,?,?,?)').run(project.id,lease.resource,owner,JSON.stringify(lease));return {participantId:person.id};
  }
  private resources(projectId:string,resources:string[],paths:string[],owner:string){
    const held=this.leases();
    for(const resource of resources)if(held.some(lease=>lease.owner!==owner&&lease.resource==='resource:'+resource&&(lease.projectId===projectId||resource.startsWith('host:'))))return false;
    for(const path of paths)if(held.some(lease=>lease.owner!==owner&&lease.projectId===projectId&&lease.resource.startsWith('path:')&&grantsOverlap(path,lease.resource.slice(5))))return false;
    for(const resource of [...resources.map(name=>'resource:'+name),...paths.map(path=>'path:'+path.toLowerCase().replace(/\/$/,''))]){
      const lease={projectId,resource,owner,acquiredAt:new Date().toISOString()},scope=resource.startsWith('resource:host:')?'@host':projectId;
      this.db.prepare('INSERT OR IGNORE INTO work_leases VALUES (?,?,?,?)').run(scope,resource,owner,JSON.stringify(lease));
    }return true;
  }
  claimParticipant(project:Project,role:Assignment['role'],owner:string,author?:string|null,resources:string[]=[]){return this.atomic(()=>{const participant=this.participant(project,role,owner,author);if(!participant)return null;if(!this.resources(project.id,resources,[],owner)){this.releaseLeases(owner);return null;}return participant;});}
  releaseLeases(owner:string){this.db.prepare('DELETE FROM work_leases WHERE owner=?').run(owner);}
  private taskParticipant(task:Task,role:Assignment['role'],owner:string,axis?:ReviewAxis){
    const project=task.projectSnapshot?projectSchema.parse(task.projectSnapshot):undefined;if(role==='builder'&&project?.delivery?.requirePathGrants&&!task.writablePaths?.length)throw Error('This ticket needs source ownership before implementation.');
    if(role==='builder'&&project?.delivery?.evidencePolicy==='explicit'&&(!task.specificationReady||!validateRequirements(task.acceptanceCriteria??[],task.evidenceRequirements,[...new Set(['command' as const,...project.delivery.requireEvidenceKinds])])))throw Error('This ticket needs a complete acceptance-evidence plan before implementation.');
    const excluded=axis?Object.entries(task.reviewVerdicts??{}).filter(([name,verdict])=>name!==axis&&verdict?.approved&&verdict.candidate===task.candidate).map(([,verdict])=>verdict!.reviewer):[];
    let reviewer:string|undefined;
    if(axis&&project?.team){
      const fixed=Object.fromEntries(Object.entries(task.reviewVerdicts??{}).filter(([,verdict])=>verdict?.approved&&verdict.candidate===task.candidate).map(([axis,verdict])=>[axis,verdict!.reviewer]));
      const occupied=this.leases(project.id).filter(lease=>lease.resource.startsWith('participant:')).map(lease=>lease.resource.slice(12)),available=new Set(project.team.filter(person=>!occupied.includes(person.id)).map(person=>person.id));
      const plan=planReviewers({team:project.team,axes:[...project.delivery?.reviewAxes??[],axis],author:task.author??'',fixed,available:{axis,ids:available}});if(!plan)return null;reviewer=plan[axis];
    }
    const participant=project?this.participant(project,role,owner,task.author,axis,excluded,role==='builder'?task.transferContext?.participantId:reviewer):{};if(!participant)return null;
    const resources=project&&['builder','reviewer'].includes(role)?project.verify.flatMap(command=>command.resources??[]):[];
    if(!this.resources(task.projectId,resources,role==='builder'?task.writablePaths??[]:[],owner)){this.releaseLeases(owner);return null;}return participant;
  }
  private newTask(input:TaskInput,base?:{baseTaskId:string;baseCandidate:string;coordinated?:boolean}):Task{
    const parsed = inputSchema.parse(input);
    const now = new Date().toISOString();
    const task: Task = { ...parsed,...base, id: randomUUID(), state: 'queued', createdAt: now, updatedAt: now, candidate: null, verified: false, author: null, reviewCycles: 0, resumeState: null, blocker: null };
    return task;
  }
  create(input: TaskInput,base?:{baseTaskId:string;baseCandidate:string;coordinated?:boolean}): Task {
    const task=this.newTask(input,base);
    return this.atomic(() => { this.save(task); this.log(task.id, 'Task queued.'); return task; });
  }
  reserveWorkflowTicket(run:WorkflowRun,ticketId:string,input:TaskInput,ticket?:PmtItem):Task{
    return this.atomic(()=>{
      const saved=this.run(run.id).children?.[ticketId];
      if(saved){run.children={...this.run(run.id).children};return this.task(saved);}
      if(!run.baseTaskId||!run.baseCandidate)throw Error('A workflow source baseline is required before reserving a ticket.');
      const task=this.newTask(input,{baseTaskId:run.baseTaskId,baseCandidate:run.baseCandidate,coordinated:true});
      task.projectSnapshot=run.artifacts.project_snapshot;
      task.writablePaths=ticket?.ownedPaths;task.acceptanceCriteria=ticket?ticketCriteria(ticket):undefined;task.evidenceRequirements=ticket?.evidenceRequirements;
      this.save(task);this.log(task.id,'Task queued.');
      run.children??={};run.children[ticketId]=task.id;this.saveRun(run);return task;
    });
  }
  reserveParallelTicket(run:WorkflowRun,ticket:PmtItem,replace=false,repair?:{seedTree:string;verification:unknown[];wave:string[];findings:string}):WorkflowRun{
    return this.atomic(()=>{
      const existing=this.run(run.id).parallel?.ticketRuns[ticket.id];if(existing&&!replace)return this.run(existing);
      if(!run.parallel||!run.ticketDefinition||!run.ticketPersonaInstructions||!run.baseCandidate)throw Error('Parallel delivery has no pinned ticket workflow or baseline.');
      if(replace&&!repair)throw Error('Replacement tickets require their complete repair checkpoint.');
      const task=this.newTask({title:ticket.title,description:`Deliver ${ticket.id} for epic ${run.epicId}. Full scope is in the workflow handoff.`,projectId:run.projectId,execution:'codex',requestChangesOnce:false},{baseTaskId:run.id,baseCandidate:run.baseCandidate,coordinated:true});
      task.projectSnapshot=run.artifacts.project_snapshot;task.writablePaths=ticket.ownedPaths;task.acceptanceCriteria=ticketCriteria(ticket);task.evidenceRequirements=ticket.evidenceRequirements;task.worktree={runId:run.id,commit:run.parallel.commit};this.save(task);this.log(task.id,'Ticket queued in a managed Git worktree.');
      const now=new Date().toISOString(),child:WorkflowRun={id:task.id,parentRunId:run.id,ticketId:ticket.id,projectId:run.projectId,workflowId:run.ticketDefinition.id,epicId:run.epicId,title:ticket.id+' Â· '+ticket.title,description:'Ticket execution owned by '+run.id,definition:run.ticketDefinition,phase:run.ticketDefinition.initial,status:'queued',createdAt:now,updatedAt:now,turns:[],questions:[],message:'Ticket workflow queued.',recovery:false,attempts:[],artifacts:{task:{title:ticket.title,description:ticket.body},project:run.artifacts.project,project_snapshot:run.artifacts.project_snapshot,delivery_frontier:run.artifacts.delivery_frontier,epic:run.artifacts.epic,ticket,routing_ready:false},personaInstructions:run.ticketPersonaInstructions,handoffs:[],children:{[ticket.id]:task.id},ticketOrder:[ticket.id],completedTickets:[],baseTaskId:run.id,baseCandidate:run.baseCandidate};
      if(existing){run.parallel.historyRuns??=[];run.parallel.historyRuns.push(existing);}
      if(repair){
        child.artifacts.seed_tree=repair.seedTree;child.artifacts.repair_verification=repair.verification;child.artifacts.integration_findings=repair.findings;
        run.parallel.wave=repair.wave;run.parallel.repairTicketId=ticket.id;run.parallel.repairPending=true;delete run.parallel.plan;run.completedTickets=run.completedTickets?.filter(id=>id!==ticket.id);
      }
      run.children??={};run.children[ticket.id]=task.id;run.parallel.ticketRuns[ticket.id]=child.id;this.saveRun(child);this.saveRun(run);return child;
    });
  }
  recordTransferSeed(child:WorkflowRun,context:NonNullable<Task['transferContext']>,files:Record<string,string>){return this.atomic(()=>{
    if(this.assignments().some(assignment=>assignment.taskId===child.id))throw Error('Transferred progress must be seeded before assignments start.');
    const task=this.task(child.id);task.transferContext=context;this.save(task);child.artifacts.transfer_seed=context;child.artifacts.transfer_seed_files=files;this.saveRun(child);this.log(task.id,'Retained transferred progress seeded; prior reviews remain context for fresh scoped verification.');
  });}
  claim(id: string, config: WorkflowConfig): Assignment | null {
    return this.atomic(() => {
      if (this.paused) return null;
      const task = this.task(id);
      if(task.coordinated)return null;
      const technical=task.state==='blocked'&&task.blockerKind==='technical'&&(task.technicalAttempts??0)<config.maxTechnicalResolutions;
      if (task.cancelRequested || task.cleanupRequired || (!technical&&!['queued','refining','ready','implementing','reviewing'].includes(task.state))) return null;
      if (this.db.prepare("SELECT id FROM assignments WHERE task_id=? AND status='running'").get(id)) return null;
      const stage: Stage = task.state === 'ready' ? 'implementing' : task.state as Stage;
      const running = this.db.prepare("SELECT COUNT(*) AS count FROM assignments WHERE stage=? AND status IN ('running','interrupted')").get(stage)?.count as number;
      if (running >= config.parallelism[stage]) return null;
      const assignmentId=randomUUID(),participant=this.taskParticipant(task,roleFor[stage],assignmentId);if(!participant)return null;
      const assignment: Assignment = { id: assignmentId,...participant,taskId: id, stage, role: roleFor[stage], worker: participant.participantId??`${roleFor[stage]}-${randomUUID().slice(0,8)}`, candidate: task.candidate, status: 'running', startedAt: new Date().toISOString() };
      this.save({ ...task, state: stage,technicalAttempts:technical?(task.technicalAttempts??0)+1:task.technicalAttempts, updatedAt: assignment.startedAt });
      this.saveAssignment(assignment);
      this.log(id, `${assignment.role} started ${stage} (${assignment.id.slice(0,8)}).`);
      return assignment;
    });
  }
  claimCoordinated(id:string,role:Assignment['role'],resolving:boolean,config:WorkflowConfig,axis?:ReviewAxis):Assignment|null{
    return this.atomic(()=>{
      const task=this.task(id);if(!task.coordinated)throw Error('This execution is not owned by the workflow state machine.');
      if(this.paused||task.cancelRequested||task.cleanupRequired)return null;
      if(this.db.prepare("SELECT id FROM assignments WHERE task_id=? AND status IN ('running','interrupted')").get(id))return null;
      const stage:Stage=resolving?'blocked':({lead:'queued',ba:'refining',builder:'implementing',reviewer:'reviewing'} as const)[role];
      if(resolving&&(role!=='lead'||task.state!=='blocked'))throw Error('Only a blocked ticket can receive Lead resolution.');
      if(role==='reviewer'&&(!task.candidate||!task.verified))throw Error('Review requires independently verified candidate source.');
      if(role==='builder'&&task.projectSnapshot&&projectSchema.parse(task.projectSnapshot).delivery?.requirePathGrants&&!task.writablePaths?.length){
        this.save({...task,state:'blocked',resumeState:task.state==='blocked'?task.resumeState:'ready',blockerKind:'technical',blocker:'The project Lead must plan explicit source ownership before this ticket can build.'});this.log(id,'Builder held for Lead source ownership planning.');return null;
      }
      const running=this.db.prepare("SELECT COUNT(*) AS count FROM assignments WHERE stage=? AND status IN ('running','interrupted')").get(stage)?.count as number;
      if(running>=config.parallelism[stage])return null;
      if(axis&&role!=='reviewer')throw Error('A review axis requires Reviewer execution.');
      const assignmentId=randomUUID(),participant=this.taskParticipant(task,role,assignmentId,axis);if(!participant)return null;
      const assignment:Assignment={id:assignmentId,...participant,reviewAxis:axis,taskId:id,stage,role,worker:participant.participantId??role+'-'+randomUUID().slice(0,8),candidate:task.candidate,status:'running',startedAt:new Date().toISOString()};
      this.save({...task,state:stage,technicalAttempts:resolving?(task.technicalAttempts??0)+1:task.technicalAttempts,updatedAt:assignment.startedAt});this.saveAssignment(assignment);this.log(id,`${role} started ${stage} (${assignment.id.slice(0,8)}).`);return assignment;
    });
  }
  finish(id: string, rawResult: unknown, config: WorkflowConfig): boolean {
    return this.atomic(() => {
      const row = this.db.prepare('SELECT data,status FROM assignments WHERE id=?').get(id);
      if (!row) throw new Error('Assignment not found.');
      if (row.status !== 'running') return false;
      const assignment = JSON.parse(row.data as string) as Assignment;
      let before = this.task(assignment.taskId);
      if(before.cancelRequested)return false;
      let result = resultSchema.parse(rawResult);
      const policy=before.projectSnapshot?projectSchema.parse(before.projectSnapshot).delivery:undefined;
      if((result.kind==='triaged'||result.kind==='resolved')&&result.ownedPaths?.length){
        if(assignment.role!=='lead')throw Error('Only the project Lead can plan source ownership.');
        if(before.writablePaths?.length&&JSON.stringify([...before.writablePaths].sort())!==JSON.stringify([...new Set(result.ownedPaths)].sort()))throw Error('Existing source ownership uses the shared-interface decision path.');
        const protectedPaths=before.projectSnapshot?projectSchema.parse(before.projectSnapshot).protectedPaths:[];
        if(result.ownedPaths.some(path=>protectedPaths.some(protectedPath=>grantsOverlap(path,protectedPath))))throw Error('Planned source ownership overlaps protected source.');
        before={...before,writablePaths:[...new Set(result.ownedPaths)]};
      }
      if(policy?.evidencePolicy==='explicit'&&(result.kind==='triaged'||result.kind==='refined')){
        const requirements=result.requirements??before.evidenceRequirements,valid=validateRequirements(before.acceptanceCriteria??[],requirements,[...new Set(['command' as const,...policy.requireEvidenceKinds])]);
        if(!valid)result=result.kind==='triaged'?{...result,specificationReady:false,requirements:undefined}:{kind:'blocked',blockerKind:'technical',reason:'The readiness handoff must map every assigned acceptance criterion to concrete evidence kinds, including the required command evidence.'};
      }
      if(before.baseTaskId&&!before.coordinated&&before.state==='queued'&&result.kind==='triaged')result={...result,specificationReady:false};
      // For coordinated tickets this validates executor facts and review identity.
      // claim() never dispatches them: only the configured graph selects the next worker.
      const after = advance(before, assignment, result, config);
      if(result.kind==='reviewed'&&assignment.reviewAxis){
        after.reviewVerdicts={...before.reviewVerdicts,[assignment.reviewAxis]:{candidate:result.candidate,approved:result.approved,reviewer:assignment.worker,assignmentId:assignment.id,notes:result.notes}};
        const required=before.projectSnapshot?projectSchema.parse(before.projectSnapshot).delivery?.reviewAxes??[]:[];
        if(result.approved&&required.some(axis=>!after.reviewVerdicts?.[axis]?.approved||after.reviewVerdicts[axis]!.candidate!==result.candidate))Object.assign(after,{state:'reviewing',reviewNotes:before.reviewNotes,repeatedReviewFindings:before.repeatedReviewFindings,lastRejectedCandidate:before.lastRejectedCandidate,unchangedCandidateReviews:before.unchangedCandidateReviews});
      }
      this.save(after);
      this.saveAssignment({ ...assignment, status: 'finished' });
      this.releaseLeases(assignment.id);
      this.log(after.id, `${before.state} â†’ ${after.state}. ${result.kind === 'reviewed' ? result.notes : result.kind === 'blocked' ? result.reason : result.kind === 'built' ? `Verified candidate ${result.candidate.slice(0,12)}.` : 'Assignment result accepted.'}`);
      return true;
    });
  }
  cancel(id: string) {
    this.atomic(() => {
      const task = this.task(id);
      if(task.state==='cancelled')return;
      if (task.state==='complete') throw new Error('Task is already complete.');
      for (const assignment of this.assignments().filter(item => item.taskId === id && ['running','interrupted'].includes(item.status))){this.saveAssignment({ ...assignment, status: 'cancelled' });this.releaseLeases(assignment.id);}
      this.save({ ...task, state: 'cancelled', resumeState: null, blocker: null,cancelRequested:false,cleanupRequired:false, updatedAt: new Date().toISOString() });
      this.log(id, 'Operator cancelled the task. Late assignment results will be ignored.');
    });
  }
  requestCancel(id:string){this.atomic(()=>{const task=this.task(id);if(['complete','cancelled'].includes(task.state))throw new Error('Task is already terminal.');this.save({...task,cancelRequested:true});this.log(id,'Cancellation requested; capacity stays reserved until process cleanup is confirmed.');});}
  hold(assignmentId:string,reason:string){this.atomic(()=>{const assignment=this.assignments().find(item=>item.id===assignmentId);if(!assignment||assignment.status!=='running')return;const task=this.task(assignment.taskId);this.saveAssignment({...assignment,status:'interrupted'});this.save({...task,state:'blocked',resumeState:task.state==='blocked'?task.resumeState:task.state,blocker:reason,blockerKind:'recovery',cleanupRequired:task.execution==='codex'});this.log(task.id,reason);});}
  resume(id: string, answer: string, options:{reconciled?:boolean;restartImplementation?:boolean;retryTechnicalResolution?:boolean}={}) {
    if (!answer.trim()) throw new Error('Provide a blocker answer or reconciliation note.');
    this.atomic(() => {
      const task = this.task(id);
      if (task.state !== 'blocked' || !task.resumeState) throw new Error('Task has no resumable blocker.');
      if(this.assignments().some(item=>item.taskId===id&&item.status==='running'))throw new Error('A worker is resolving this blocker. Pause or cancel that assignment before overriding it.');
      if(task.cleanupRequired&&!options.reconciled)throw new Error('Process reconciliation is required before resuming.');
      if(options.retryTechnicalResolution&&task.blockerKind!=='recovery')throw Error('Only an interrupted technical resolution can retain its pending blocker.');
      for(const assignment of this.assignments().filter(item=>item.taskId===id&&item.status==='interrupted')){this.saveAssignment({...assignment,status:'finished'});this.releaseLeases(assignment.id);}
      this.save({ ...task, state: options.retryTechnicalResolution?'blocked':options.restartImplementation?'implementing':task.resumeState,verified:options.restartImplementation?false:task.verified, resumeState: options.retryTechnicalResolution?task.resumeState:null, blocker: options.retryTechnicalResolution?(task.interfaceRequest?.question??answer.trim()):null,blockerKind:options.retryTechnicalResolution?'technical':task.blockerKind,cleanupRequired:false,cancelRequested:false,resolution:answer.trim(), updatedAt: new Date().toISOString() });
      this.log(id, `Operator resolved blocker: ${answer.trim()}`);
    });
  }
  recover(): number {
    return this.atomic(() => {
      const interrupted = this.assignments().filter(item => item.status === 'running');
      for (const assignment of interrupted) {
        const task = this.task(assignment.taskId);
        this.saveAssignment({ ...assignment, status: 'interrupted' });
        this.save({ ...task, state: 'blocked', resumeState: task.state==='blocked'?task.resumeState:task.state,blockerKind:'recovery', cleanupRequired:task.execution==='codex',blocker: 'Runner interrupted. Reconcile the existing attempt before retrying.', updatedAt: new Date().toISOString() });
        this.log(task.id, 'Interrupted assignment held for reconciliation; no replacement launched.');
      }
      return interrupted.length;
    });
  }
}
