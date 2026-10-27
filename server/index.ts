import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, extname,join } from 'node:path';
import {readActivity} from './process.ts';
import {randomUUID} from 'node:crypto';
import { configSchema, inputSchema } from '../shared/workflow.ts';
import { Store } from './store.ts';
import { Runner, SimulatedWorker } from './runner.ts';
import {CodexWorker} from './codex-worker.ts';
import {runtimeSettings,taskRoot,projectSchema} from './projects.ts';
import {ticketBoard} from '../shared/ticket-progress.ts';
import {inspectProject,saveProject,setupProjectGit} from './project-management.ts';
import {chooseFolder} from './folder-picker.ts';
import {deliveryOutput} from './delivery-output.ts';
import {Factory,workflows} from './factory.ts';
import {deliveryWorkflowFor} from './workflow-definitions.ts';
import {Pmt} from './pmt.ts';
import {listPersonas,savePersona,deletePersona} from './personas.ts';
import {listWorkflowDefinitions,saveWorkflowDefinition,deleteWorkflowDefinition} from './workflow-library.ts';
import {LibraryError} from './library-files.ts';
import {inspectDelivery} from './delivery-frontier.ts';

import {EvidenceLedger} from './evidence-ledger.ts';
import {deliveryCandidate} from './delivery-candidate.ts';
import {runProject,taskRoot as evidenceTaskRoot} from './projects.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const instance=process.env.BARRACKS_INSTANCE_ID??randomUUID();
const config = configSchema.parse(JSON.parse(readFileSync(resolve(root, 'config/workflow.json'), 'utf8')));
const port=Number(process.env.BARRACKS_PORT??4111);
if(!Number.isInteger(port)||port<1024||port>65535)throw new Error('BARRACKS_PORT must be an integer from 1024 to 65535.');
const store = new Store(resolve(root,process.env.BARRACKS_DB_PATH??'.state/barracks.db'));
const codex=new CodexWorker(),simulation=new SimulatedWorker(config.simulationDelayMs);
const worker={run:(...args:Parameters<CodexWorker['run']>)=>args[1].execution==='codex'?codex.run(...args):simulation.run(args[0],args[1],args[2]),reconcile:async(task:Parameters<CodexWorker['reconcile']>[0],assignments:Parameters<CodexWorker['reconcile']>[1])=>task.execution==='codex'?codex.reconcile(task,assignments):{}};
const runner = new Runner(store, config, worker);
const factory=new Factory(store,runner);
const allowed = new Set([`http://localhost:${port}`,`http://127.0.0.1:${port}`,'http://localhost:5174','http://127.0.0.1:5174']);
const server = createServer(async (request, response) => {
  const json = (value: unknown, status = 200) => { response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store','X-Barracks-Instance':instance }); response.end(JSON.stringify(value)); };
  try {
    if (!allowed.has(`http://${request.headers.host}`) || request.headers['sec-fetch-site'] === 'cross-site' || (request.headers.origin && !allowed.has(request.headers.origin))) { json({ error: 'Local same-origin access required.' }, 403); return; }
    if(request.headers['x-barracks-test-instance']&&request.headers['x-barracks-test-instance']!==instance){json({error:'This request targets a different test-server instance.'},409);return;}
    const url = new URL(request.url ?? '/', 'http://127.0.0.1:4111');
    if(url.pathname==='/api/personas'&&request.method==='GET'){json(listPersonas());return;}
    if(url.pathname==='/api/workflow-definitions'&&request.method==='GET'){json(listWorkflowDefinitions());return;}
    const workflowMatch=/^\/api\/workflow-definitions\/([a-z][a-z0-9_-]*)(?:\/(delete))?$/.exec(url.pathname);
    const personaMatch=/^\/api\/personas\/([a-z][a-z0-9_-]*)(?:\/(delete))?$/.exec(url.pathname);
    if (url.pathname === '/api/snapshot' && request.method === 'GET') { json({ config, projects:runtimeSettings().projects.map(({id,name,kind})=>({id,name,kind})),paused: store.paused, tasks: store.tasks(), assignments: store.assignments() }); return; }
    if(url.pathname==='/api/factory'&&request.method==='GET'){const projectId=url.searchParams.get('project'),definitions=workflows();json({workerParallelism:config.parallelism,projects:runtimeSettings().projects.map(project=>({id:project.id,name:project.name,kind:project.kind,deliveryWorkflowId:deliveryWorkflowFor(project,definitions),taskCount:store.runs().filter(run=>run.projectId===project.id).length})),workflows:definitions,runs:store.runs().filter(run=>!!projectId&&run.projectId===projectId),paused:store.paused});return;}
    if(url.pathname==='/api/tickets'&&request.method==='GET'){const project=factory.project(url.searchParams.get('project')??'');json(new Pmt(project).list());return;}
    if(url.pathname==='/api/delivery-preview'&&request.method==='GET'){const ids=url.searchParams.getAll('ticket');json(inspectDelivery(factory.project(url.searchParams.get('project')??''),url.searchParams.get('epic')??'',ids.length||url.searchParams.get('scope')==='selected'?ids:undefined));return;}
    if(url.pathname==='/api/ticket-board'&&request.method==='GET'){
      const projectId=url.searchParams.get('project')??'',pmt=new Pmt(factory.project(projectId)),assignments=store.assignments();
      json(ticketBoard(pmt.list(),pmt.statuses(),store.runs().filter(run=>run.projectId===projectId),store.tasks().filter(task=>task.projectId===projectId),id=>{const assignment=assignments.find(item=>item.taskId===id&&item.status==='running');return assignment?readActivity(join(taskRoot({id}),'attempts',assignment.id,'codex'),true):null;}));return;
    }
    const runMatch=/^\/api\/runs\/([a-f0-9-]+)(?:\/(answer|cancel|evidence|delegation))?$/.exec(url.pathname);
    if(runMatch&&request.method==='GET'){const run=store.run(runMatch[1]!);json({...run,evidence:run.artifacts.acceptance_requirements?new EvidenceLedger(run.id).list(run.baseCandidate):[],output:deliveryOutput(run,run.artifacts.project_snapshot?projectSchema.parse(run.artifacts.project_snapshot):factory.project(run.projectId)),activity:run.attempts.map(attempt=>readActivity(join(attempt,'codex'),run.status==='running'&&!run.recovery)).filter(Boolean),childrenDetails:Object.entries(run.children??{}).map(([ticketId,id])=>({ticketId,task:store.task(id),history:store.history(id),details:codex.details(store.task(id),store.assignments())}))});return;}
    const projectMatch=/^\/api\/projects\/([a-z0-9-]+)$/.exec(url.pathname);
    if(projectMatch&&request.method==='GET'){const project=runtimeSettings().projects.find(item=>item.id===projectMatch[1]);json(project??{error:'Project not found.'},project?200:404);return;}
    const match = /^\/api\/tasks\/([a-f0-9-]+)(?:\/(history|resume|cancel|details))?$/.exec(url.pathname);
    if (match?.[1] && match[2] === 'history' && request.method === 'GET') { store.task(match[1]); json(store.history(match[1])); return; }
    if(match?.[1]&&match[2]==='details'&&request.method==='GET'){const task=store.task(match[1]);json(task.execution==='codex'?codex.details(task,store.assignments()):{attempts:[]});return;}
    if (request.method === 'POST' && url.pathname.startsWith('/api/')) {
      let body = ''; for await (const chunk of request) { body += chunk.toString(); if (Buffer.byteLength(body) > 128000) throw new Error('Request exceeds 128 KB.'); }
      const input: unknown = JSON.parse(body || '{}');
      if(url.pathname==='/api/personas'){json(savePersona(input),201);return;}
      if(url.pathname==='/api/workflow-definitions'){json(saveWorkflowDefinition(input),201);return;}
      if(workflowMatch){json(workflowMatch[2]?deleteWorkflowDefinition(workflowMatch[1]!,input):saveWorkflowDefinition(input,workflowMatch[1]));return;}
      if(personaMatch){json(personaMatch[2]?deletePersona(personaMatch[1]!,input):savePersona(input,personaMatch[1]));return;}
      if(url.pathname==='/api/runs'){json(factory.create(input),201);return;}
      if(runMatch?.[2]==='delegation'){json(factory.adoptLeadDelegation(runMatch[1]!,input));return;}
      if(runMatch?.[2]==='evidence'){const run=store.run(runMatch[1]!);if(run.status!=='waiting'||!run.artifacts.acceptance_requirements||!run.artifacts.acceptance_criteria)throw Error('Evidence can be recorded only while this delivery is waiting for acceptance.');const criterion=(input as {criterion?:string})?.criterion;if(!(run.artifacts.acceptance_criteria as {id:string}[]).some(item=>item.id===criterion))throw Error('Choose a delivered criterion.');const project=runProject(run),candidate=deliveryCandidate(run).candidate;json(new EvidenceLedger(run.id).observe(input,candidate,[project.path,project.trackerPath??project.path,evidenceTaskRoot({id:run.id})]),201);return;}
      if(runMatch?.[2]==='answer'){const {answer,event='answered'}=(input??{}) as {answer?:unknown;event?:unknown};if(typeof answer!=='string'||answer.length>20000||typeof event!=='string')throw Error('Provide an answer under 20,000 characters and a configured decision.');json(await factory.resume(runMatch[1]!,answer,event));return;}
      if(runMatch?.[2]==='cancel'){json(await factory.cancel(runMatch[1]!));return;}
      if(url.pathname==='/api/tickets'){
        const value=input as {projectId?:string;id?:string;title?:string;body?:string;revision?:string};if(!value||typeof value.projectId!=='string'||typeof value.id!=='string'||typeof value.title!=='string'||typeof value.body!=='string'||typeof value.revision!=='string')throw Error('Provide the project, item, title, body and revision.');
        const pmt=new Pmt(factory.project(value.projectId)),item=pmt.list().find(item=>item.id===value.id);if(!item)throw Error('PMT item not found.');
        if(store.runs().some(run=>run.projectId===value.projectId&&run.definition.kind==='delivery'&&run.epicId===(item.epic??item.id)&&!['complete','cancelled'].includes(run.status)))throw Error('Finish or cancel the active delivery task before editing its epic or tickets.');
        json(pmt.edit(value.id,{title:value.title,body:value.body,revision:value.revision}));return;
      }
      if(url.pathname==='/api/project-folder-picker'){json(await chooseFolder((input as {path?:unknown})?.path));return;}
      if(url.pathname==='/api/projects/inspect'){json(inspectProject((input as {path?:unknown})?.path));return;}
      if(url.pathname==='/api/projects/setup-git'){json(setupProjectGit(input));return;}
      if(url.pathname==='/api/projects'||projectMatch){if(projectMatch&&store.runs().some(run=>run.projectId===projectMatch[1]&&!['complete','cancelled'].includes(run.status)))throw Error('Finish or cancel this project’s workflow tasks before changing its settings.');json(saveProject(input,projectMatch?.[1],store.tasks()),projectMatch?200:201);return;}
      if (url.pathname === '/api/tasks') {
        const parsed=inputSchema.parse(input);
        if(parsed.execution!=='codex')throw Error('Simulation is no longer available. Start a configured real workflow.');
        if(parsed.execution==='codex'&&!runtimeSettings().projects.some(project=>project.id===parsed.projectId))throw new Error('Select a configured local project.');
        json(store.create(parsed), 201);
      }
      else if (url.pathname === '/api/pause') {
        if (!input || typeof input !== 'object' || !('paused' in input) || typeof input.paused !== 'boolean') throw new Error('paused must be true or false.');
        store.pause(input.paused); json({ paused: store.paused });
      } else if (match?.[1] && match[2] === 'cancel') { await runner.cancel(match[1]); json({ ok: true }); }
      else if (match?.[1] && match[2] === 'resume') {
        if (!input || typeof input !== 'object' || !('answer' in input) || typeof input.answer !== 'string' || input.answer.length > 10000) throw new Error('Provide an answer under 10,000 characters.');
        await runner.resume(match[1], input.answer); json({ ok: true });
      } else { json({ error: 'Route not found.' }, 404); return; }
      runner.tick(); return;
    }
    if (url.pathname.startsWith('/api/')) { json({ error: 'Route not found.' }, 404); return; }
    if (request.method !== 'GET' && request.method !== 'HEAD') { json({ error: 'Method not allowed.' }, 405); return; }
    const dist = resolve(root, 'dist');
    const path = resolve(dist, '.' + decodeURIComponent(url.pathname));
    if (path !== dist && !path.startsWith(dist + '\\') && !path.startsWith(dist + '/')) { json({ error: 'Invalid path.' }, 400); return; }
    const target = path !== dist && existsSync(path) && extname(path) ? path : resolve(dist, 'index.html');
    if (!existsSync(target)) { json({ message: 'Dashboard available at http://127.0.0.1:5174 during development; npm run build enables this URL.' }, 404); return; }
    const types: Record<string,string> = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.svg':'image/svg+xml' };
    response.writeHead(200, { 'Content-Type': types[extname(target)] ?? 'application/octet-stream', 'X-Content-Type-Options':'nosniff','Cache-Control':'no-cache' });
    response.end(request.method === 'HEAD' ? undefined : readFileSync(target));
  } catch (error) { json({ error: error instanceof Error ? error.message : String(error) }, error instanceof LibraryError?error.status:400); }
});
server.on('error', error => { console.error(error.message); factory.stop();runner.stop(); store.close(); process.exitCode = 1; });
server.listen(port, '127.0.0.1', () => { runner.start();factory.start(); console.log(`Barracks runner: http://127.0.0.1:${port}`); });
function stop() { factory.stop();runner.stop(); server.close(async() => {await factory.drained();await runner.drained();store.close();}); }
process.on('SIGINT', stop); process.on('SIGTERM', stop);
