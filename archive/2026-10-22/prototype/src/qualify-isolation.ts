import { qualifyWriteIsolation } from './qualification/write-isolation.ts';
const report = await qualifyWriteIsolation();
console.log(JSON.stringify(report, null, 2));
if (report.status !== 'passed') process.exitCode = 1;
