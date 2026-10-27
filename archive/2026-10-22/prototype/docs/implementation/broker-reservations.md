# Durable launch reservations

BRK-007 adds a fixture-only launch boundary. Ledger schema 2 adds immutable launch specifications, reserved/running/reconciliation-required/terminal states and PID/start identities. Opening schema 1 migrates it transactionally while preserving jobs, outbox and pause state.

`LaunchBroker.ensureJob(jobId, spec)` commits a reservation before invoking its fixture runtime. Concurrent calls share one in-flight launch. Reopening a running attempt inspects its exact PID/start identity. A missing receipt, exited process, mismatched identity or failed inspection requires reconciliation and never launches a replacement automatically. An early terminal result remains terminal when its process receipt arrives.

The runtime interface accepts qualification fixtures only. It is not wired to a live CLI provider, OS sandbox, Windows service or dispatcher. Seven tests include real children, duplicate ensures, a launch whose receipt is lost, abrupt exit after reservation, identity mismatch, pause, early results and schema migration. Together with the prior suites, all 26 tests passed; the final focused broker rerun passed all seven tests.

## Runtime findings

The npm Codex 0.162.1 sandbox failed while its setup step attempted an ACL update on in-use `node_repl.exe` (Windows error 32). This was confirmed in the dated sandbox log. The existing app-bundled 0.163.0 executable passed the same read-only control without changing CLI configuration. `BARRACKS_CODEX_PATH` now accepts an explicit native executable; the default remains unchanged.

Using that explicit 0.163.0 path, `npm run qualify:isolation` passed a permitted read and workspace write, and refused canonical tracked-file/ref writes, a child `cmd` overwrite and a junction-alias overwrite. Canonical file/ref hashes and the real disposable Git main ref remained unchanged. Evidence: `.barracks/isolation-boundary/4b8bd4e1-baa0-4db5-b0d0-1648d1c71bc4/result.json`. This is specific fixture proof, not authenticated tool-bearing worker or cross-provider qualification.

Waiting for all three process generations did not fix coordinator-loss lifetime. The experiment failed waiting for further heartbeat progress. Persistent host/coordinator survival remains unqualified.

## Mastra Factory comparison

The user identified the official Mastra Factory starter during this slice. A fit assessment should precede further custom orchestration infrastructure. This is a recommendation; adoption has not been decided and the approved CLI-worker/team contracts remain in force.

The current starter provides a Factory server/UI, lifecycle rules, background dispatch, integrations and storage. Its entry imports `MastraFactory` and the Code SDK, supports local-development libSQL, and configures sandbox providers. Verify existing external CLI-worker adaptation, the fixed four-role roster, PMT/HQ authority and Windows lifecycle before choosing which custom modules to retain.

- [Factory starter](https://github.com/mastra-ai/softwarefactory-template).
- [Setup and self-hosting](https://factory.mastra.ai/).
- [Current entry source](https://github.com/mastra-ai/softwarefactory-template/blob/main/src/mastra/index.ts).
- [Sandbox providers](https://factory.mastra.ai/configure/sandboxes).
