import {spawn} from 'node:child_process';
import {resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {TestServer} from './test-server.ts';
const server=new TestServer(resolve('.state/real-tests/browser',randomUUID()),4121);
try{
  await server.start();console.log(`Isolated real-test server: ${server.url}`);
  const child=spawn(process.execPath,['node_modules/@playwright/test/cli.js','test','e2e/real-worker.spec.ts'],{windowsHide:true,stdio:'inherit',env:{...process.env,BARRACKS_REAL_TESTS:'1',BARRACKS_BASE_URL:server.url}});
  const code=await new Promise<number|null>((accept,reject)=>{child.once('error',reject);child.once('exit',accept);});if(code!==0)process.exitCode=1;
}finally{await server.stop();console.log('Server evidence: '+server.directory);console.log('Task evidence: .state/real-tests/browser-real-result.json');}
