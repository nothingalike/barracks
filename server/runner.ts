import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import type { Assignment, Task, WorkerResult, WorkflowConfig } from '../shared/workflow.ts';
import { Store } from './store.ts';
import { StoppedError } from './process.ts';

export interface Worker {
  run(assignment: Assignment, task: Task, signal: AbortSignal): Promise<WorkerResult>;
  reconcile?(task:Task,assignments:Assignment[]):Promise<{restartImplementation?:boolean}>;
}
export class SimulatedWorker implements Worker {
  private delayMs: number;
  constructor(delayMs: number) { this.delayMs = delayMs; }
  async run(assignment: Assignment, task: Task, signal: AbortSignal): Promise<WorkerResult> {
    await delay(this.delayMs, undefined, { signal });
    switch (assignment.stage) {
      case 'queued': return { kind: 'triaged', specificationReady: task.specificationReady };
      case 'refining': return { kind: 'refined' };
      case 'implementing': return { kind: 'built', candidate: createHash('sha1').update(assignment.id).digest('hex'), verified: true };
      case 'reviewing': return { kind: 'reviewed', candidate: assignment.candidate!, approved: !task.requestChangesOnce || task.reviewCycles > 0, notes: task.requestChangesOnce && task.reviewCycles === 0 ? 'Simulation: request one revision to exercise the fix loop.' : 'Simulation: independent review passed.' };
      case 'blocked':return {kind:'resolved',resolution:'Simulated Lead technical resolution.'};
    }
  }
}
export class Runner {
  private store: Store;
  private config: WorkflowConfig;
  private worker: Worker;
  private jobs = new Map<string, {controller:AbortController;done:Promise<void>}>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private closing = false;
  constructor(store: Store, config: WorkflowConfig, worker: Worker) { this.store = store; this.config = config; this.worker = worker; }
  start() { this.store.recover(); this.timer = setInterval(() => this.tick(), 200); this.tick(); }
  tick() {
    if (this.closing || this.store.paused) return;
    // Oldest first so newer arrivals cannot starve work already waiting.
    for (const task of this.store.tasks().reverse()) {
      const assignment = this.store.claim(task.id, this.config);
      if (!assignment) continue;
      const controller = new AbortController();
      const done=this.worker.run(assignment, this.store.task(task.id), controller.signal)
        .then(result => { if (!this.closing) {if(this.store.task(task.id).cancelRequested)this.store.cancel(task.id);else this.store.finish(assignment.id, result, this.config);} })
        .catch(error => {
          if(this.closing)return;
          if(controller.signal.aborted&&(error instanceof StoppedError||task.execution!=='codex'))this.store.cancel(task.id);
          else if(task.execution==='codex')this.store.hold(assignment.id,error instanceof Error?error.message:String(error));
          else this.store.finish(assignment.id, { kind: 'blocked', reason: error instanceof Error ? error.message : String(error) }, this.config);
        }).finally(() => this.jobs.delete(assignment.id));
      this.jobs.set(assignment.id,{controller,done});
    }
  }
  async cancel(taskId: string) {
    const active = this.store.assignments().filter(item => item.taskId === taskId && item.status === 'running');
    if(!active.length){
      const task=this.store.task(taskId);
      if(task.cleanupRequired){if(!this.worker.reconcile)throw new Error('Process reconciliation is unavailable; cancellation remains held.');await this.worker.reconcile(task,this.store.assignments().filter(item=>item.taskId===taskId));}
      this.store.cancel(taskId);return;
    }
    this.store.requestCancel(taskId);
    for (const assignment of active) this.jobs.get(assignment.id)?.controller.abort();
    await Promise.all(active.map(assignment=>this.jobs.get(assignment.id)?.done));
    if(this.store.task(taskId).state!=='cancelled')throw new Error('Cancellation needs process reconciliation. Existing work remains held.');
  }
  async resume(taskId:string,answer:string){
    const task=this.store.task(taskId);
    if(task.state!=='blocked')throw new Error('Task is not blocked.');
    if(task.execution==='codex'&&!this.worker.reconcile)throw new Error('Real-worker reconciliation is unavailable.');
    const result=await this.worker.reconcile?.(task,this.store.assignments().filter(item=>item.taskId===taskId));
    if(task.cancelRequested)this.store.cancel(taskId);
    else this.store.resume(taskId,answer,{reconciled:!!this.worker.reconcile,...result});
  }
  stop() {
    this.closing = true;
    if (this.timer) clearInterval(this.timer);
    for (const job of this.jobs.values()) job.controller.abort();
    // Persisted assignments remain interrupted candidates for next startup reconciliation.
  }
  async drained(){await Promise.all([...this.jobs.values()].map(job=>job.done));}
}
