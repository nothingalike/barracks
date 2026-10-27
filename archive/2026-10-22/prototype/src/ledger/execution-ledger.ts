import { mkdirSync } from 'node:fs';
import { dirname, isAbsolute } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { participantId, workerResult } from '../contracts/team.ts';
import { launchSpec, processIdentity } from '../broker/contracts.ts';
import type { LaunchRecord } from '../broker/contracts.ts';

const assignmentSchema = z.object({
  jobId: z.string().min(1), project: z.string().min(1), ticket: z.string().min(1),
  participant: participantId, attempt: z.number().int().positive(),
  baseSha: z.string().regex(/^[a-f0-9]{40}$/),
}).strict();
export type Assignment = z.infer<typeof assignmentSchema>;
export interface Obligation {
  id: string; kind: 'launch-requested' | 'result-recorded'; jobId: string;
  payload: Assignment | z.infer<typeof workerResult>;
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') {
    return '{' + Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => JSON.stringify(key) + ':' + canonical(item)).join(',') + '}';
  }
  return JSON.stringify(value);
}

/** Single-owner local ledger. External processes and Git effects need their own fencing. */
export class ExecutionLedger {
  private readonly db: DatabaseSync;
  constructor(path: string) {
    if (!isAbsolute(path)) throw new Error('Ledger path must be absolute.');
    mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path, { timeout: 0 });
    try {
      // Hold an actual SQLite exclusive lock for this connection's lifetime.
      this.db.exec('PRAGMA locking_mode=EXCLUSIVE; PRAGMA synchronous=FULL; BEGIN EXCLUSIVE;');
      const version = this.db.prepare('PRAGMA user_version').get()?.user_version;
      if (version !== 0 && version !== 1 && version !== 2) throw new Error(`Unsupported ledger schema version ${version}.`);
      if (version === 0) this.db.exec(`
        CREATE TABLE jobs (
          id TEXT PRIMARY KEY, project TEXT NOT NULL, ticket TEXT NOT NULL,
          participant TEXT NOT NULL, attempt INTEGER NOT NULL, assignment TEXT NOT NULL,
          result TEXT, UNIQUE(project,ticket,attempt)
        ) STRICT;
        CREATE UNIQUE INDEX busy_participant ON jobs(project,participant) WHERE result IS NULL;
        CREATE UNIQUE INDEX busy_ticket ON jobs(project,ticket) WHERE result IS NULL;
        CREATE TABLE outbox (
          sequence INTEGER PRIMARY KEY, id TEXT NOT NULL UNIQUE,
          kind TEXT NOT NULL, job_id TEXT NOT NULL REFERENCES jobs(id),
          payload TEXT NOT NULL, acknowledged INTEGER NOT NULL DEFAULT 0
        ) STRICT;
        CREATE TABLE controls (project TEXT PRIMARY KEY, paused INTEGER NOT NULL) STRICT;
        PRAGMA user_version=1;
      `);
      if (version === 0 || version === 1) this.db.exec(`
        CREATE TABLE launches (
          job_id TEXT PRIMARY KEY REFERENCES jobs(id), spec TEXT NOT NULL,
          state TEXT NOT NULL, identity TEXT, reason TEXT
        ) STRICT;
        PRAGMA user_version=2;
      `);
      this.db.exec('COMMIT;');
    } catch (error) {
      if (this.db.isTransaction) this.db.exec('ROLLBACK;');
      this.db.close();
      throw error;
    }
  }
  private transaction<T>(operation: () => T): T {
    this.db.exec('BEGIN IMMEDIATE;');
    try {
      const result = operation(); this.db.exec('COMMIT;'); return result;
    } catch (error) { this.db.exec('ROLLBACK;'); throw error; }
  }
  assign(input: unknown): 'created' | 'duplicate' {
    const assignment = assignmentSchema.parse(input);
    const serialized = canonical(assignment);
    return this.transaction(() => {
      const existing = this.db.prepare('SELECT assignment FROM jobs WHERE id=?').get(assignment.jobId);
      if (existing) {
        if (existing.assignment !== serialized) throw new Error(`jobId ${assignment.jobId} already has a different assignment.`);
        return 'duplicate';
      }
      if (this.isPaused(assignment.project)) throw new Error(`Project ${assignment.project} is paused.`);
      const busy = this.db.prepare(`SELECT id FROM jobs WHERE project=? AND result IS NULL
        AND (participant=? OR ticket=?)`).get(assignment.project, assignment.participant, assignment.ticket);
      if (busy) throw new Error(`Assignment conflicts with active job ${busy.id}.`);
      const latest = this.db.prepare('SELECT MAX(attempt) AS attempt FROM jobs WHERE project=? AND ticket=?')
        .get(assignment.project, assignment.ticket)?.attempt;
      if (typeof latest === 'number' && assignment.attempt <= latest) throw new Error(`attempt must exceed ${latest} for ${assignment.ticket}.`);
      this.db.prepare('INSERT INTO jobs(id,project,ticket,participant,attempt,assignment) VALUES(?,?,?,?,?,?)')
        .run(assignment.jobId, assignment.project, assignment.ticket, assignment.participant, assignment.attempt, serialized);
      this.db.prepare('INSERT INTO outbox(id,kind,job_id,payload) VALUES(?,?,?,?)')
        .run(`launch:${assignment.jobId}`, 'launch-requested', assignment.jobId, serialized);
      return 'created';
    });
  }
  recordResult(input: unknown): 'recorded' | 'duplicate' {
    const result = workerResult.parse(input);
    const serialized = canonical(result);
    return this.transaction(() => {
      const row = this.db.prepare('SELECT assignment,result FROM jobs WHERE id=?').get(result.jobId);
      if (!row) throw new Error(`Unknown jobId ${result.jobId}. Persist the assignment before launch.`);
      const assignment = assignmentSchema.parse(JSON.parse(String(row.assignment)));
      for (const key of ['project', 'ticket', 'participant', 'attempt', 'baseSha'] as const) {
        if (assignment[key] !== result[key]) throw new Error(`Result ${key} differs from assignment ${result.jobId}.`);
      }
      if (row.result !== null) {
        if (row.result !== serialized) throw new Error(`jobId ${result.jobId} already has a different result.`);
        return 'duplicate';
      }
      this.db.prepare('UPDATE jobs SET result=? WHERE id=?').run(serialized, result.jobId);
      this.db.prepare("UPDATE launches SET state='terminal',reason=NULL WHERE job_id=?").run(result.jobId);
      // A terminal result proves launch happened, even if its acknowledgment was lost.
      this.db.prepare('UPDATE outbox SET acknowledged=1 WHERE id=?').run(`launch:${result.jobId}`);
      this.db.prepare('INSERT INTO outbox(id,kind,job_id,payload) VALUES(?,?,?,?)')
        .run(`result:${result.jobId}`, 'result-recorded', result.jobId, serialized);
      return 'recorded';
    });
  }
  pending(): Obligation[] {
    return this.db.prepare(`SELECT o.id,o.kind,o.job_id,o.payload FROM outbox o
      JOIN jobs j ON j.id=o.job_id LEFT JOIN controls c ON c.project=j.project
      WHERE o.acknowledged=0 AND (o.kind!='launch-requested' OR COALESCE(c.paused,0)=0)
      ORDER BY o.sequence`).all().map(row => ({
        id: String(row.id), kind: row.kind as Obligation['kind'], jobId: String(row.job_id),
        payload: JSON.parse(String(row.payload)),
      }));
  }
  acknowledge(id: string) {
    const changed = this.db.prepare('UPDATE outbox SET acknowledged=1 WHERE id=?').run(id);
    if (!changed.changes) throw new Error(`Unknown obligation ${id}.`);
  }
  setPaused(project: string, paused: boolean) {
    z.string().min(1).parse(project);
    this.db.prepare(`INSERT INTO controls(project,paused) VALUES(?,?)
      ON CONFLICT(project) DO UPDATE SET paused=excluded.paused`).run(project, paused ? 1 : 0);
  }
  isPaused(project: string) { return this.db.prepare('SELECT paused FROM controls WHERE project=?').get(project)?.paused === 1; }
  getLaunch(jobId: string): LaunchRecord | undefined {
    const row = this.db.prepare('SELECT * FROM launches WHERE job_id=?').get(jobId);
    return row ? { jobId, spec: launchSpec.parse(JSON.parse(String(row.spec))), state: row.state as LaunchRecord['state'],
      identity: row.identity === null ? null : processIdentity.parse(JSON.parse(String(row.identity))),
      reason: row.reason === null ? null : String(row.reason) } : undefined;
  }
  reserveLaunch(jobId: string, input: unknown): { created: boolean; record: LaunchRecord } {
    const spec = launchSpec.parse(input);
    return this.transaction(() => {
      const existing = this.getLaunch(jobId);
      if (existing) {
        if (canonical(existing.spec) !== canonical(spec)) throw new Error(`Launch spec differs for jobId ${jobId}.`);
        return { created: false, record: existing };
      }
      const job = this.get(jobId);
      if (!job) throw new Error(`Unknown jobId ${jobId}. Persist assignment before reserving launch.`);
      if (job.result) return { created: false, record: { jobId, spec, state: 'terminal', identity: null, reason: null } };
      if (this.isPaused(job.assignment.project)) throw new Error(`Project ${job.assignment.project} is paused.`);
      this.db.prepare("INSERT INTO launches(job_id,spec,state) VALUES(?,?,'reserved')").run(jobId, canonical(spec));
      return { created: true, record: this.getLaunch(jobId)! };
    });
  }
  recordProcess(jobId: string, input: unknown): LaunchRecord {
    const identity = processIdentity.parse(input);
    return this.transaction(() => {
      const record = this.getLaunch(jobId);
      if (!record) throw new Error(`No launch reservation for jobId ${jobId}.`);
      if (record.identity && canonical(record.identity) !== canonical(identity)) throw new Error(`Process identity differs for jobId ${jobId}.`);
      const state = record.state === 'reserved' ? 'running' : record.state;
      this.db.prepare('UPDATE launches SET identity=?,state=? WHERE job_id=?').run(canonical(identity), state, jobId);
      this.db.prepare('UPDATE outbox SET acknowledged=1 WHERE id=?').run(`launch:${jobId}`);
      return this.getLaunch(jobId)!;
    });
  }
  requireReconciliation(jobId: string, reason: string): LaunchRecord {
    z.string().min(1).parse(reason);
    return this.transaction(() => {
      if (!this.getLaunch(jobId)) throw new Error(`No launch reservation for jobId ${jobId}.`);
      this.db.prepare("UPDATE launches SET state='reconciliation-required',reason=? WHERE job_id=? AND state!='terminal'")
        .run(reason, jobId);
      return this.getLaunch(jobId)!;
    });
  }
  get(jobId: string) {
    const row = this.db.prepare('SELECT assignment,result FROM jobs WHERE id=?').get(jobId);
    return row ? { assignment: assignmentSchema.parse(JSON.parse(String(row.assignment))),
      result: row.result === null ? null : workerResult.parse(JSON.parse(String(row.result))) } : undefined;
  }
  close() { this.db.close(); }
}
