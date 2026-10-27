import {mkdirSync,writeFileSync,readFileSync,readdirSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {chromium} from '@playwright/test';
import {TestServer,waitFor} from './test-server.ts';
const directory=resolve('.state/factory-real',randomUUID()),source=join(directory,'project');mkdirSync(source,{recursive:true});
process.env.GIT_CEILING_DIRECTORIES=resolve('.state/factory-real');
const settings=join(directory,'projects.json');writeFileSync(settings,readFileSync('config/projects.json'));process.env.BARRACKS_PROJECTS_PATH=settings;
const server=new TestServer(directory,4125);let browser:Awaited<ReturnType<typeof chromium.launch>>|undefined;
try{
  await server.start();await server.api('/projects/setup-git',{path:source,action:'initialize',confirmed:true});
  const inspected=await server.api('/projects/setup-git',{path:source,action:'initial-commit',confirmed:true,files:[],name:'Fixture',email:'fixture@invalid'});
  await server.api('/projects',{...inspected.project,id:'factory-real',name:'Factory qualification',instructions:'Use dependency-free Node ES modules and node:test. This is a tiny, fully specified fixture, not a web app. Produce exactly two sequential tickets: implement greet(name), then add greetLoud(name) while preserving greet and its tests. Keep code in greeting.mjs with tests in greeting.test.mjs. Configure no external accounts, installations, Git remotes or source commits.'});
  browser=await chromium.launch({channel:'msedge',headless:true});const page=await browser.newPage({viewport:{width:1440,height:1000}});await page.goto(server.url+'/?project=factory-real');
  await page.getByRole('button',{name:'New task',exact:false}).click();await page.getByLabel('Task title').fill('Specify two greeting behaviors');await page.getByLabel('Description',{exact:true}).fill('Design exactly two dependent tickets for a dependency-free JavaScript module. Ticket 1: export greet(name), trim a string name, return Hello, <name>! or Hello, world! for empty/whitespace-only input. Ticket 2 depends on 1: export greetLoud(name), returning the exact greet(name) output uppercased, preserving the first behavior and tests. Both use Node built-in tests for named, padded, empty and whitespace input; string input only. Named ES module exports in greeting.mjs. No UI, dependencies, storage, networking or other requirements. All product decisions are specified; use routine technical judgment. Run an Architect challenge exchange with the Product Owner, then produce a spec and exactly two small tickets.');await page.getByRole('button',{name:'Start workflow',exact:true}).click();
  const discovery=await waitFor(()=>server.api('/factory?project=factory-real'),value=>value.runs.length>0,10000).then(value=>value.runs[0]);console.log('Real discovery: '+discovery.id);
  let discovered=await waitFor(()=>server.api('/runs/'+discovery.id),run=>['complete','waiting'].includes(run.status),600000);
  for(const phase of ['review_specification','review_tickets']){
    if(discovered.phase!==phase||discovered.status!=='waiting'||discovered.recovery)throw Error('Expected fixture review gate '+phase+': '+discovered.message);
    if((await server.api('/tickets?project=factory-real')).length)throw Error('Tickets were published before both fixture review gates.');
    await page.reload();await page.getByLabel('Your answer or direction').fill(phase==='review_specification'?'Fixture approval: specified string behavior and Node test seams are accepted.':'Fixture approval: exactly two vertical slices and their blocking dependency are accepted.');
    await page.getByRole('button',{name:'Continue workflow'}).click();
    discovered=await waitFor(()=>server.api('/runs/'+discovery.id),run=>['complete','waiting'].includes(run.status)&&run.phase!==phase,600000);
  }
  writeFileSync(join(directory,'discovery.json'),JSON.stringify(discovered,null,2));if(discovered.status!=='complete')throw Error('Discovery needs input: '+discovered.message+' '+discovered.questions.join('; '));
  if((await server.api('/snapshot')).tasks.length)throw Error('Discovery launched coding before ticket review.');
  const items=await server.api('/tickets?project=factory-real');const tickets=items.filter((item:{epic?:string})=>item.epic===discovered.outputEpicId);if(tickets.length!==2)throw Error('Qualification expected exactly two tickets.');
  await page.getByRole('button',{name:'Tickets',exact:true}).click();await page.getByRole('button',{name:new RegExp(tickets[0].id)}).click();await page.getByRole('button',{name:'Edit details',exact:true}).click();await page.getByLabel('Ticket / epic content').fill(tickets[0].body+'\n\nOperator review: retain named exports and all existing tests.\n');await page.getByRole('button',{name:'Save item',exact:true}).click();
  await page.screenshot({path:join(directory,'reviewed-tickets.png'),fullPage:true});
  await page.getByRole('button',{name:'Deliver epic',exact:true}).click();await page.getByLabel('Task title').fill('Deliver the reviewed greeting epic');await page.getByRole('button',{name:'Start workflow',exact:true}).click();
  const delivery=await waitFor(()=>server.api('/factory?project=factory-real'),value=>value.runs.some((run:{definition:{kind:string}})=>run.definition.kind==='delivery'),10000).then(value=>value.runs.find((run:{definition:{kind:string};parentRunId?:string})=>run.definition.kind==='delivery'&&!run.parentRunId));console.log('Real epic delivery: '+delivery.id);
  const delivered=await waitFor(()=>server.api('/runs/'+delivery.id),run=>['complete','waiting'].includes(run.status),900000);writeFileSync(join(directory,'delivery.json'),JSON.stringify(delivered,null,2));if(delivered.status!=='complete')throw Error('Delivery needs input: '+delivered.message);
  const children=delivered.childrenDetails;if(children.length!==2||children.some((child:{task:{state:string};history:{message:string}[]})=>child.task.state!=='complete'||!child.history.some(entry=>entry.message.includes('ba started'))))throw Error('Each ticket must pass BA and complete independently.');
  const final=children.at(-1),workspace=final.details.workspace;execFileSync(process.execPath,['--test','greeting.test.mjs'],{cwd:workspace,windowsHide:true,stdio:'pipe'});
  const contents=readFileSync(join(workspace,'greeting.mjs'),'utf8');if(!contents.includes('greetLoud')||!contents.includes('greet'))throw Error('Final source lost one ticket behavior.');
  const sourceNames=readdirSync(source);if(!sourceNames.includes('greeting.mjs')||!sourceNames.includes('greeting.test.mjs'))throw Error('Accepted workflow source was not returned to its project folder.');
  const finalItems=await server.api('/tickets?project=factory-real');if(finalItems.filter((item:{epic?:string;status:string})=>item.epic===discovered.outputEpicId).some((item:{status:string})=>item.status!=='complete'))throw Error('PMT ticket completion did not persist.');
  if(delivered.artifacts.acceptance_candidate!==delivered.baseCandidate||!delivered.artifacts.retrospective)throw Error('Delivery lacks exact-candidate acceptance or retrospective.');
  await page.reload();await page.getByText('The assembled candidate passed acceptance',{exact:false}).waitFor({timeout:10000});await page.screenshot({path:join(directory,'delivery-complete.png'),fullPage:true});
  console.log('PASS: real discovery, fixture specification/ticket review gates, explicit delivery, two BA/build/review tickets, cumulative candidate acceptance and retrospective.');
}finally{await browser?.close();await server.stop();console.log('Factory evidence: '+directory);}
