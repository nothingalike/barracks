const { spawn } = require('node:child_process');
const { writeFileSync } = require('node:fs');
const { join } = require('node:path');
const [directory, jobId, depth] = process.argv.slice(2);
const level = Number(depth);
writeFileSync(join(directory, `member-${level}.json`), JSON.stringify({ pid: process.pid, jobId, level }));
writeFileSync(join(directory, `heartbeat-${level}`), '0');
if (level < 2) spawn(process.execPath, [__filename, directory, jobId, String(level + 1)], {
  windowsHide: true, stdio: 'ignore', detached: level === 1,
});
let ticks = 0;
setInterval(() => writeFileSync(join(directory, `heartbeat-${level}`), String(++ticks)), 100);
