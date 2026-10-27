import { z } from 'zod';
import type { Assignment, ExecutionLedger } from '../ledger/execution-ledger.ts';
import type { LaunchRecord, LaunchSpec, ProcessIdentity } from './contracts.ts';

export interface FixtureRuntime {
  launch(assignment: Assignment): Promise<ProcessIdentity>;
  inspect(identity: ProcessIdentity): Promise<'same-running' | 'exited' | 'identity-mismatch' | 'unknown'>;
}

/** Durable launch boundary; only qualification-fixture adapters are accepted in this slice. */
export class LaunchBroker {
  private readonly pending = new Map<string, Promise<LaunchRecord>>();
  private readonly ledger: ExecutionLedger;
  private readonly runtime: FixtureRuntime;
  constructor(ledger: ExecutionLedger, runtime: FixtureRuntime) { this.ledger = ledger; this.runtime = runtime; }
  ensureJob(jobId: string, spec: LaunchSpec): Promise<LaunchRecord> {
    const existing = this.pending.get(jobId);
    if (existing) {
      // Validate a concurrent caller's immutable spec as well as sharing the in-flight launch.
      this.ledger.reserveLaunch(jobId, spec);
      return existing;
    }
    const promise = this.ensure(jobId, spec);
    this.pending.set(jobId, promise);
    const clear = () => { if (this.pending.get(jobId) === promise) this.pending.delete(jobId); };
    promise.then(clear, clear);
    return promise;
  }
  private async ensure(jobId: string, spec: LaunchSpec): Promise<LaunchRecord> {
    const { created, record } = this.ledger.reserveLaunch(jobId, spec);
    if (record.state === 'terminal' || record.state === 'reconciliation-required') return record;
    if (created) {
      try {
        const assignment = this.ledger.get(jobId)!.assignment;
        const identity = await this.runtime.launch(assignment);
        return this.ledger.recordProcess(jobId, identity);
      } catch {
        return this.ledger.requireReconciliation(jobId, 'Launch may have occurred; reconcile owned processes before retrying.');
      }
    }
    if (!record.identity) return this.ledger.requireReconciliation(jobId,
      'Persisted launch reservation has no process receipt; automatic replay is refused.');
    let observation: string;
    try { observation = z.enum(['same-running', 'exited', 'identity-mismatch', 'unknown']).parse(await this.runtime.inspect(record.identity)); }
    catch { observation = 'unknown'; }
    if (observation === 'same-running') return record;
    return this.ledger.requireReconciliation(jobId, `Process observation is ${observation}; no replacement launched.`);
  }
}
