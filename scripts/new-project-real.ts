import {mkdirSync,writeFileSync,readFileSync,readdirSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {TestServer,waitFor} from './test-server.ts';
const directory=resolve('.state/new-project-real',randomUUID()),source=join(directory,'empty-project');mkdirSync(source,{recursive:true});
process.env.GIT_CEILING_DIRECTORIES=resolve('.state/new-project-real');
const config=join(directory,'projects.json');writeFileSync(config,readFileSync('config/projects.json'));process.env.BARRACKS_PROJECTS_PATH=config;
const server=new TestServer(directory,4124);
try{
  await server.start();
  await server.api('/projects/setup-git',{path:source,action:'initialize',confirmed:true});
  const inspected=await server.api('/projects/setup-git',{path:source,action:'initial-commit',confirmed:true,files:[],name:'Fixture',email:'fixture@invalid'});
  const project={...inspected.project,id:'empty-real',instructions:'Start from the empty folder. Use plain JavaScript ES modules with Node built-in tests and no external dependencies. Provide meaningful automated verification for the requested behavior.'};
  await server.api('/projects',project);
  const task=await server.api('/tasks',{title:'Build a greeting utility from scratch',description:'Create greeting.mjs exporting greet(name), returning Hello, <trimmed name>! or Hello, world! for an empty or whitespace-only name. Add meaningful node:test tests for named, padded, empty and whitespace inputs. This is a brand-new project with no files or configured verification commands. Establish its verification commands and independently review the implementation. Use no dependencies or package installation.',execution:'codex',projectId:project.id,specificationReady:true,requestChangesOnce:false});
  console.log('New project real task: '+task.id);
  const final=await waitFor(()=>server.api('/snapshot'),snapshot=>snapshot.tasks.some((item:{id:string;state:string})=>item.id===task.id&&['complete','blocked','cancelled'].includes(item.state)),300000);
  const result=final.tasks.find((item:{id:string})=>item.id===task.id);
  writeFileSync(join(directory,'result.json'),JSON.stringify(result,null,2));
  if(result.state!=='complete')throw Error('New-project task did not complete: '+result.blocker);
  const plan=JSON.parse(readFileSync(resolve('.state/tasks',task.id,'verification.json'),'utf8'));if(!plan.length)throw Error('No independent verification plan recorded.');
  if(readdirSync(source).some(name=>name!=='.git'))throw Error('New project source received task writes.');
  console.log('PASS: empty registration, real Lead/Builder/Reviewer, recorded independent verification, completion and source isolation.');
}finally{await server.stop();console.log('Evidence: '+directory);}
