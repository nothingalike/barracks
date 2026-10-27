import {runOwned} from '../../server/process.ts';
import {resolve,join} from 'node:path';
const directory=process.argv[2]!;
await runOwned({executable:process.execPath,args:[resolve('test/fixtures/heartbeat.mjs'),'root',join(directory,'heartbeat')],cwd:process.cwd(),node:process.execPath,directory:join(directory,process.argv[3]??'attempt'),timeoutMs:30000});
