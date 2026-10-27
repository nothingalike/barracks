import { qualifyWindowsProcesses } from './qualification/windows-process.ts';
const scenarios = process.argv.slice(2);
console.log(JSON.stringify(await qualifyWindowsProcesses(scenarios.length ? scenarios : undefined), null, 2));
