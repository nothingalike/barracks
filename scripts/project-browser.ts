import {spawn} from 'node:child_process';
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {TestServer} from './test-server.ts';
const directory=resolve('.state/project-ui',randomUUID()),source=join(directory,'sample-repository');
mkdirSync(source,{recursive:true});
const git=(args:string[],input?:string)=>execFileSync('git',['-c',`safe.directory=${source.replaceAll('\\','/')}`,'-C',source,...args],{input,encoding:'utf8',windowsHide:true}).trim();
git(['init','--initial-branch=main']);
const blob=git(['hash-object','-w','--stdin'],JSON.stringify({name:'sample-repository',scripts:{build:'node --check source.mjs',test:'node --test'}}));
const tree=git(['mktree'],`100644 blob ${blob}\tpackage.json\n`);
const commit=git(['hash-object','-t','commit','-w','--stdin'],`tree ${tree}\nauthor Fixture <fixture@invalid> 0 +0000\ncommitter Fixture <fixture@invalid> 0 +0000\n\nfixture\n`);
git(['update-ref','refs/heads/main',commit]);git(['read-tree','--reset','-u','HEAD']);
const original=readFileSync(join(source,'package.json'),'utf8');
const fresh=join(directory,'new-project'),empty=join(directory,'empty-project');mkdirSync(fresh);mkdirSync(empty);
writeFileSync(join(fresh,'README.md'),'New project\n');writeFileSync(join(fresh,'.gitignore'),'ignored.txt\n');writeFileSync(join(fresh,'ignored.txt'),'excluded fixture\n');
process.env.GIT_CEILING_DIRECTORIES=resolve('.state/project-ui');
const settingsFile=join(directory,'projects.json');
writeFileSync(settingsFile,readFileSync('config/projects.json'));
process.env.BARRACKS_PROJECTS_PATH=settingsFile;
const server=new TestServer(directory,4123);
try{
  await server.start();
  const child=spawn(process.execPath,['node_modules/@playwright/test/cli.js','test','e2e/project-settings.spec.ts','e2e/dashboard.spec.ts','e2e/projects.spec.ts','e2e/workflows.spec.ts'],{windowsHide:true,stdio:'inherit',env:{...process.env,BARRACKS_PROJECT_TESTS:'1',BARRACKS_BASE_URL:server.url,BARRACKS_PROJECT_FIXTURE:source,BARRACKS_PROJECT_NEW_FIXTURE:fresh,BARRACKS_PROJECT_EMPTY_FIXTURE:empty,BARRACKS_PROJECT_EVIDENCE:directory}});
  const code=await new Promise<number|null>((accept,reject)=>{child.once('error',reject);child.once('exit',accept);});
  if(code!==0)process.exitCode=1;
  if(code===0){await server.stop();await server.start();const saved=await server.api('/projects/sample-repository');if(saved.name!=='Renamed sample workspace'||!saved.instructions.includes('module conventions'))throw Error('Project settings did not survive a runner restart.');console.log('Project persistence across runner restart: passed.');}
  if(readFileSync(join(source,'package.json'),'utf8')!==original||git(['rev-parse','HEAD'])!==commit)throw Error('Source repository changed during project setup.');
}finally{await server.stop();console.log('Project setup evidence: '+directory);}
