import { ExecutionLedger } from '../../src/ledger/execution-ledger.ts';
const [path, input] = process.argv.slice(2);
const { assignment, result } = JSON.parse(input);
const ledger = new ExecutionLedger(path);
ledger.assign(assignment);
ledger.recordResult(result);
// Abrupt exit after durable COMMIT; no shutdown or notification acknowledgment.
process.exit(23);
