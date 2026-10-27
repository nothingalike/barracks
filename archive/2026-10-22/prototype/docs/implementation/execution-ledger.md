# Local execution ledger

BRK-006 implements the first P02 storage slice. It records intent and results; it launches no worker and applies no Git or PMT effect.

`ExecutionLedger` uses Node 24.5's built-in `node:sqlite` with an absolute database path. Schema version 1 uses SQLite transactions, FULL synchronization and a connection-held exclusive database lock. A second ledger connection fails while the owner is open. Mastra storage remains separate and belongs to the same intended runtime process.

```typescript
const ledger = new ExecutionLedger(absoluteDatabasePath);
ledger.assign({ jobId, project, ticket, participant, attempt, baseSha });
// The future broker consumes the persisted launch-requested obligation.
ledger.recordResult(workerResult);
// The future dispatcher consumes the persisted result-recorded obligation.
const obligations = ledger.pending();
ledger.acknowledge(obligations[0].id);
ledger.close();
```

An assignment and its launch obligation commit together. A result and its wake-up obligation also commit together. Recording a result clears its stale launch obligation in that transaction. Duplicate submissions return the existing outcome; changing an existing job's assignment or result is refused. Result identity must match the persisted assignment, including source SHA and attempt.

The ledger refuses overlapping active assignments for a participant or ticket within a project. Participants come from the fixed four-role schema. Attempts must increase for later work on a ticket. Pause state persists across reopen, blocks new assignments and hides queued launch obligations while allowing active jobs to submit results.

Seven tests use real file-backed SQLite. They cover duplicate/conflicting delivery, capacity and identity checks, persisted pause, injected launch/result outbox failures, abrupt process exit after commit, and exclusive-owner release. The crash test exits without closing the ledger or acknowledging its notification; reopen finds one result obligation and no stale launch request.

This is partial P02. Event claiming/leases, coordinator epochs, cancellation fencing, review acceptance, external-operation reconciliation, backups and migration beyond schema 1 remain future work. A database lock does not revoke a worker's filesystem access. Consumers must revalidate current state before applying an external effect; outbox delivery is at least once and acknowledgments do not promise exactly-once effects.

Node 24.5 labels `node:sqlite` experimental. Requalify the ledger when changing the Node version. The pinned-runtime documentation is [Node 24.5 SQLite](https://nodejs.org/download/release/v24.5.0/docs/api/sqlite.html).
