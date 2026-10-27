import { ExecutionLedger } from '../../src/ledger/execution-ledger.ts';
const [path, input] = process.argv.slice(2);
const { assignment, spec } = JSON.parse(input);
const ledger = new ExecutionLedger(path);
ledger.assign(assignment);
ledger.reserveLaunch(assignment.jobId, spec);
process.exit(23);
