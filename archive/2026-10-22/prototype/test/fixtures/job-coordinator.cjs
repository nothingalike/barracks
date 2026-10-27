const { spawn } = require('node:child_process');
const { writeFileSync, openSync, closeSync, existsSync, readFileSync } = require('node:fs');
const { dirname, join } = require('node:path');
const [powershell, host, manifest, receipt] = process.argv.slice(2);
const output = openSync(join(dirname(receipt), 'host.log'), 'a');
const broker = spawn(powershell, ['-NoProfile', '-NonInteractive', '-File', host, '-Manifest', manifest], {
  windowsHide: true, stdio: ['ignore', output, output],
});
closeSync(output);
broker.once('exit', (code, signal) => writeFileSync(join(dirname(receipt), 'host-exit.json'), JSON.stringify({ code, signal })));
broker.once('error', error => { writeFileSync(receipt, JSON.stringify({ error: error.message })); process.exit(24); });
broker.once('spawn', () => {
  broker.unref();
  writeFileSync(receipt, JSON.stringify({ brokerPid: broker.pid }));
  const config = JSON.parse(readFileSync(manifest, 'utf8'));
  const deadline = Date.now() + 8000;
  const poll = setInterval(() => {
    // Crash after the independent host has acknowledged ownership, without shutdown.
    if (existsSync(config.receipt) && [0, 1, 2].every(level => existsSync(join(config.cwd, `member-${level}.json`)))) {
      clearInterval(poll); process.exit(23);
    }
    if (Date.now() > deadline) { clearInterval(poll); process.exit(24); }
  }, 25);
});
