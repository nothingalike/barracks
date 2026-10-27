const { writeFileSync } = require('node:fs');
const [receipt, jobId] = process.argv.slice(2);
writeFileSync(receipt, JSON.stringify({ pid: process.pid, jobId }));
// Bound the disposable child even when its parent experiment fails.
setTimeout(() => process.exit(0), 20000);
