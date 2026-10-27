import {test,expect} from '@playwright/test';
test('acceptance shows retained failures and records an explicit candidate-bound operator waiver',async({page})=>{
  const snapshot=await (await page.request.get('/api/factory?project=slug')).json(),definition=snapshot.workflows.find((item:any)=>item.id==='parallel-delivery');
  const id='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',candidate='a'.repeat(40);let submitted:any;
  const run:any={id,projectId:'slug',workflowId:'parallel-delivery',title:'Observe missing physical acceptance',description:'',definition,phase:'await_acceptance',status:'waiting',baseCandidate:candidate,recovery:false,turns:[],questions:['Physical input is unverified.'],childrenDetails:[],attempts:[],handoffs:[],message:'Record the required observation or explicit waiver.',artifacts:{acceptance_requirements:[{criterion:'SW1:1',kinds:['physical']}],acceptance_criteria:[{id:'SW1:1',description:'Physical input works.'}]},evidence:[{id:'ffffffff-ffff-4fff-8fff-ffffffffffff',candidate,kind:'native',status:'failed',origin:'runner',note:'Strict image metric remains FAIL.',artifacts:[]}]};
  await page.route('**/api/factory?*',route=>route.fulfill({json:{...snapshot,runs:[run]}}));await page.route('**/api/runs/'+id+'**',async route=>{if(route.request().method()==='POST')submitted=route.request().postDataJSON();await route.fulfill({json:run});});
  await page.goto('/?project=slug');await expect(page.getByRole('heading',{name:'Acceptance evidence'})).toBeVisible();await page.getByText('failed · native · Candidate check',{exact:true}).click();await expect(page.getByText('Strict image metric remains FAIL.')).toBeVisible();await page.getByText('Record an observation or waiver',{exact:true}).click();await page.getByLabel('Observation type').selectOption('waiver');await page.getByLabel('Steps, observations and bounded rationale').fill('Explicit test waiver: physical controller check deferred.');await page.getByRole('button',{name:'Record evidence',exact:true}).click();await expect.poll(()=>submitted?.status).toBe('waived');expect(submitted.candidate).toBe(candidate);expect(submitted.criterion).toBe('SW1:1');expect(submitted.kind).toBe('waiver');
  if(process.env.BARRACKS_LIBRARY_EVIDENCE)await page.screenshot({path:process.env.BARRACKS_LIBRARY_EVIDENCE+'/acceptance-evidence-desktop.png',fullPage:true});await page.setViewportSize({width:520,height:1000});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);if(process.env.BARRACKS_LIBRARY_EVIDENCE)await page.screenshot({path:process.env.BARRACKS_LIBRARY_EVIDENCE+'/acceptance-evidence-narrow.png',fullPage:true});
});
test('inactivity raises a visible warning while the agent remains running',async({page})=>{
  const snapshot=await (await page.request.get('/api/factory?project=slug')).json();const definition=snapshot.workflows.find((item:any)=>item.id==='grilling');
  const run={id:'cccccccc-cccc-cccc-cccc-cccccccccccc',projectId:'slug',workflowId:'grilling',title:'Quiet active agent',description:'Observe without terminating.',definition,phase:'specify',status:'running',recovery:false,turns:[],questions:[],childrenDetails:[],attempts:[],message:'Agent assignment running.',activity:[{startedAt:new Date().toISOString(),lastActivityAt:new Date().toISOString(),elapsedMs:1200000,idleMs:600000,outputEvents:4,workspaceChanges:2,completedCommands:3,repeatedFailures:0,attention:true,reason:'inactivity',ended:false}]};
  await page.route('**/api/factory?*',route=>route.fulfill({json:{...snapshot,runs:[run]}}));await page.route(/\/api\/runs\/cccccccc-/,route=>route.fulfill({json:run}));
  await page.goto('/?project=slug');await expect(page.getByText('Agent running · Elapsed 20m',{exact:false})).toBeVisible();await expect(page.getByText('The agent is still running',{exact:false})).toBeVisible();await expect(page.getByRole('button',{name:'Cancel workflow',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Continue workflow',exact:true})).toHaveCount(0);
  if(process.env.BARRACKS_LIBRARY_EVIDENCE)await page.screenshot({path:process.env.BARRACKS_LIBRARY_EVIDENCE+'/agent-activity-desktop.png',fullPage:true});await page.setViewportSize({width:520,height:1000});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);if(process.env.BARRACKS_LIBRARY_EVIDENCE)await page.screenshot({path:process.env.BARRACKS_LIBRARY_EVIDENCE+'/agent-activity-narrow.png',fullPage:true});
});
test('specification and ticket reviews show artifacts and submit explicit revision or approval decisions',async({page})=>{
  const definition=(await (await page.request.get('/api/workflow-definitions')).json()).definitions.find((item:any)=>item.id==='grilling');
  let submitted:any;
  let run:any={id:'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',projectId:'slug',workflowId:'grilling',title:'Review the offline specification',description:'Bounded review.',status:'waiting',phase:'review_specification',definition,artifacts:{specification:'The app must retain notes offline. Test through the local repository interface.'},turns:[],questions:[],message:definition.states.review_specification.instructions,recovery:false,attempts:[],childrenDetails:[]};
  const snapshot=await (await page.request.get('/api/factory?project=slug')).json();
  await page.route('**/api/factory?*',route=>route.fulfill({json:{...snapshot,runs:[run]}}));
  await page.route(/\/api\/runs\/bbbbbbbb-/,async route=>{if(route.request().method()==='POST'){submitted=route.request().postDataJSON();run={...run,status:'queued',message:'Revision recorded.'};}await route.fulfill({json:run});});
  await page.goto('/?project=slug');await expect(page.getByText('The app must retain notes offline.',{exact:false})).toBeVisible();
  if(process.env.BARRACKS_LIBRARY_EVIDENCE)await page.screenshot({path:process.env.BARRACKS_LIBRARY_EVIDENCE+'/specification-review.png',fullPage:true});
  await page.getByLabel('Decision',{exact:true}).selectOption('changes');await page.getByLabel('Your answer or direction').fill('Include restart persistence.');await page.getByRole('button',{name:'Continue workflow'}).click();
  await expect.poll(()=>submitted?.event).toBe('changes');
  run={...run,status:'waiting',phase:'review_tickets',message:definition.states.review_tickets.instructions,artifacts:{specification:'Accepted spec.',ticket_breakdown:'Two complete vertical slices.',ticket_plan:{epic:{title:'Offline notes',description:'Retain notes.'},tickets:[{title:'Save a note',description:'Persist the first note.',acceptanceCriteria:['A saved note survives restart.'],dependsOn:[]},{title:'Edit a note',description:'Update a saved note.',acceptanceCriteria:['Edits survive restart.'],dependsOn:[0]}]}}};
  await page.reload();await expect(page.getByText('Blocked by: Save a note',{exact:true})).toBeVisible();
  await page.setViewportSize({width:520,height:1000});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  if(process.env.BARRACKS_LIBRARY_EVIDENCE)await page.screenshot({path:process.env.BARRACKS_LIBRARY_EVIDENCE+'/ticket-review-narrow.png',fullPage:true});
  await page.getByLabel('Your answer or direction').fill('Approve both vertical slices.');await page.getByRole('button',{name:'Continue workflow'}).click();await expect.poll(()=>submitted?.event).toBe('answered');
});
test('waiting workflow questions accept user direction in the selected project',async({page})=>{
  let submitted='';let run:any={id:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',projectId:'slug',workflowId:'grilling',title:'Specify an offline app',description:'A scoped product brief.',status:'waiting',phase:'architect',definition:{name:'Product discovery / grilling',kind:'discovery',participants:['product-owner','architect','project-manager']},turns:[{role:'product-owner',document:'User brief and proposed scope.',questions:[],at:new Date().toISOString()}],questions:['Should this work offline?'],message:'The team needs your decisions.',recovery:false,attempts:[],childrenDetails:[]};
  const snapshot=await (await page.request.get('/api/factory?project=slug')).json();await page.route('**/api/factory?*',route=>route.fulfill({json:{...snapshot,runs:[run]}}));
  await page.route(/\/api\/runs\/aaaaaaaa-/,async route=>{if(route.request().method()==='POST'){submitted=route.request().postDataJSON().answer;run={...run,status:'queued',questions:[],message:'Your direction was supplied to the workflow.'};}await route.fulfill({json:run});});
  await page.goto('/?project=slug');await expect(page.getByText('Should this work offline?',{exact:true})).toBeVisible();await page.getByLabel('Your answer or direction').fill('Yes, support offline use.');await page.getByRole('button',{name:'Continue workflow'}).click();await expect.poll(()=>submitted).toContain('offline');await expect(page.getByText('Your direction was supplied to the workflow.',{exact:true})).toBeVisible();
});
test('tickets can be edited before a separate epic workflow starts',async({page})=>{
  const epic={id:'APP-E01',title:'Build the app',status:'planned',path:'project/app/epic.md',dependsOn:[],body:'# Build the app\n\nAgreed specification.',revision:'epic-v1'};
  let ticket={id:'APP-001',epic:epic.id,title:'Build the first screen',status:'backlog',path:'project/app/stories/backlog/APP-001.md',dependsOn:[],body:'# First screen\n\n## Acceptance Criteria\n\n- Works offline.',revision:'ticket-v1'};
  let saved=false;
  await page.route('**/api/ticket-board?*',route=>route.fulfill({json:{items:[epic,ticket],statuses:['backlog','todo','in-progress','complete']}}));await page.route('**/api/tickets?*',route=>route.fulfill({json:[epic,ticket]}));await page.route('**/api/tickets',async route=>{const input=route.request().postDataJSON();expect(input.projectId).toBe('slug');expect(input.revision).toBe('ticket-v1');ticket={...ticket,title:input.title,body:input.body,revision:'ticket-v2'};saved=true;await route.fulfill({json:ticket});});
  await page.goto('/?project=slug');await page.getByRole('button',{name:'Tickets',exact:true}).click();await page.getByRole('button',{name:/APP-001/}).click();await page.getByRole('button',{name:'Edit details',exact:true}).click();await page.getByLabel('Title',{exact:true}).fill('Build the revised screen');await expect(page.getByRole('button',{name:'Deliver epic'})).toBeDisabled();await page.getByRole('button',{name:'Save item',exact:true}).click();await expect(page.getByRole('button',{name:'Deliver epic'})).toBeEnabled();expect(saved).toBe(true);await page.getByRole('button',{name:'Deliver epic'}).click();await expect(page.getByLabel('Workflow',{exact:true})).toHaveValue('parallel-delivery');await expect(page.getByLabel('Epic to deliver')).toHaveValue('APP-E01');await expect(page.getByLabel('Project',{exact:true})).toHaveCount(0);
});

test('board refresh moves cards without losing a drawer draft or overwriting changed saved content',async({page})=>{
  const epic={id:'APP-E01',title:'Offline notes',status:'planned',path:'epic.md',dependsOn:[],body:'Confirmed scope.',revision:'e1'};
  let ticket={id:'APP-001',epic:epic.id,title:'Save a note',status:'backlog',path:'ticket.md',dependsOn:[],body:'## Acceptance Criteria\n- Survives restart.',revision:'v1'};
  const second={...ticket,id:'APP-002',title:'Edit a note',dependsOn:['APP-001']};
  await page.route('**/api/ticket-board?*',route=>route.fulfill({json:{items:[epic,ticket,second],statuses:['backlog','todo','in-progress','complete']}}));
  await page.goto('/?project=slug');await page.getByRole('button',{name:'Tickets',exact:true}).click();
  const card=page.getByRole('button',{name:'APP-001 Save a note',exact:true});
  await expect(page.getByRole('region',{name:'Backlog',exact:true}).getByRole('button',{name:'APP-001 Save a note',exact:true})).toBeVisible();
  await card.click();const drawer=page.getByRole('dialog');await expect(drawer.getByText('Survives restart.',{exact:false})).toBeVisible();
  if(process.env.BARRACKS_LIBRARY_EVIDENCE)await page.screenshot({path:process.env.BARRACKS_LIBRARY_EVIDENCE+'/ticket-drawer-desktop.png',fullPage:true});
  await drawer.getByRole('button',{name:'Edit details'}).click();await drawer.getByLabel('Title',{exact:true}).fill('My preserved draft');
  ticket={...ticket,status:'in-progress',revision:'v2',body:'Updated by another editor.'};
  await expect(page.getByRole('region',{name:'In Progress',exact:true}).getByRole('button',{name:'APP-001 Save a note',exact:true})).toBeVisible();
  await expect(drawer.getByLabel('Title',{exact:true})).toHaveValue('My preserved draft');await expect(drawer.getByText('Your draft is preserved.',{exact:false})).toBeVisible();await expect(drawer.getByRole('button',{name:'Save item'})).toBeDisabled();
  page.once('dialog',dialog=>dialog.dismiss());await page.getByRole('button',{name:'Tasks',exact:true}).click();await expect(drawer).toBeVisible();
  await drawer.getByRole('button',{name:'Cancel editing'}).click();await page.keyboard.press('Escape');await expect(drawer).toHaveCount(0);await expect(card).toBeFocused();
  if(process.env.BARRACKS_LIBRARY_EVIDENCE)await page.screenshot({path:process.env.BARRACKS_LIBRARY_EVIDENCE+'/ticket-board-desktop.png',fullPage:true});
});

test('rebuilt ticket board remains usable on a runner that has not restarted',async({page})=>{
  const ticket={id:'APP-001',epic:'APP-E01',title:'Existing runner ticket',status:'todo',path:'ticket.md',dependsOn:[],body:'Keep existing work running.',revision:'v1'};
  await page.route('**/api/ticket-board?*',route=>route.fulfill({status:404,json:{error:'Not found'}}));
  await page.route('**/api/tickets?*',route=>route.fulfill({json:[ticket]}));
  await page.goto('/?project=slug');await page.getByRole('button',{name:'Tickets',exact:true}).click();
  await expect(page.getByRole('region',{name:'To do',exact:true}).getByRole('button',{name:'APP-001 Existing runner ticket'})).toBeVisible();
});

test('narrow ticket board keeps columns scrollable and opens a full-width details drawer with history',async({page})=>{
  await page.setViewportSize({width:520,height:1000});
  const ticket={id:'APP-001',epic:'APP-E01',title:'Save a note',status:'in-progress',path:'ticket.md',dependsOn:[],body:'## Acceptance Criteria\n- Survives restart.',revision:'v1',progress:{runId:'board-run',runStatus:'running',stage:'Reviewer',attention:'inspect',message:'Inspect this assignment.'}};
  await page.route('**/api/ticket-board?*',route=>route.fulfill({json:{items:[ticket],statuses:['backlog','todo','in-progress','complete']}}));
  await page.route('**/api/runs/board-run',route=>route.fulfill({json:{projectId:'slug',handoffs:[],childrenDetails:[{ticketId:ticket.id,task:{state:'reviewing',reviewCycles:1},history:[{id:1,at:'2026-10-24T12:00:00Z',message:'Independent review started.'}],details:{attempts:[]}}]}}));
  await page.goto('/?project=slug');await page.getByRole('button',{name:'Tickets',exact:true}).click();
  const card=page.getByRole('button',{name:'APP-001 Save a note',exact:true});await expect(card.getByText('Reviewer',{exact:true})).toBeVisible();await expect(card.getByText('Needs inspection')).toBeVisible();await card.click();
  const drawer=page.getByRole('dialog');await expect(drawer.getByText('Independent review started.')).toBeVisible();await expect(drawer.getByRole('button',{name:'Edit details'})).toBeDisabled();
  const box=await drawer.boundingBox();expect(box!.x).toBe(0);expect(box!.width).toBe(520);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  if(process.env.BARRACKS_LIBRARY_EVIDENCE)await page.screenshot({path:process.env.BARRACKS_LIBRARY_EVIDENCE+'/ticket-drawer-narrow.png',fullPage:true});
  await page.keyboard.press('Escape');await expect(drawer).toHaveCount(0);await expect(card).toBeFocused();
  expect(await page.locator('.kanban-scroll').evaluate(element=>element.scrollWidth>element.clientWidth)).toBe(true);
});

test('delivery shows reviewed source location separately from final acceptance and project files',async({page})=>{
  const snapshot=await (await page.request.get('/api/factory?project=slug')).json();
  const definition=snapshot.workflows.find((item:any)=>item.id==='delivery');
  const run={id:'dddddddd-dddd-dddd-dddd-dddddddddddd',projectId:'slug',workflowId:'delivery',definition,title:'Acceptance is pending',description:'',status:'waiting',phase:'await_acceptance',questions:['Resolve acceptance evidence.'],recovery:false,turns:[],handoffs:[],artifacts:{},attempts:[],childrenDetails:[],completedTickets:['APP-001'],ticketOrder:['APP-001'],output:{workspace:'C:/Barracks/build/workspace',projectPath:'C:/Projects/app',candidate:'a'.repeat(40),files:['README.md','src/app.mjs'],projectMatches:false,acceptancePassed:false}};
  await page.route('**/api/factory?*',route=>route.fulfill({json:{...snapshot,runs:[run]}}));await page.route('**/api/runs/dddddddd-*',route=>route.fulfill({json:run}));
  await page.goto('/?project=slug');const output=page.getByRole('region',{name:'Delivery output'});
  await expect(output.getByText('1 / 1 ticket reviews complete',{exact:false})).toBeVisible();await expect(output.getByText('Waiting for resolution',{exact:true})).toBeVisible();
  await expect(output.getByText('It has not been copied',{exact:false})).toBeVisible();await expect(output.getByText('C:/Projects/app',{exact:true})).toBeVisible();
  await output.getByText('Generated source files',{exact:true}).click();await expect(output.getByText('src/app.mjs',{exact:true})).toBeVisible();
  await page.setViewportSize({width:520,height:1000});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  if(process.env.BARRACKS_LIBRARY_EVIDENCE)await page.screenshot({path:process.env.BARRACKS_LIBRARY_EVIDENCE+'/delivery-output-narrow.png',fullPage:true});
});

test('parallel delivery exposes its ticket limit and keeps internal ticket workflows out of task choices',async({page})=>{
  await page.route('**/api/tickets?*',route=>route.fulfill({json:[{id:'APP-E01',title:'Parallel behaviors',status:'planned',path:'epic.md',dependsOn:[],body:'Scope.',revision:'v1'}]}));
  await page.goto('/?project=slug');await page.getByRole('button',{name:'New task',exact:false}).click();
  const workflow=page.getByLabel('Workflow',{exact:true});await expect(workflow.locator('option[value="ticket-delivery"]')).toHaveCount(0);await workflow.selectOption('parallel-delivery');
  await expect(page.getByLabel('Maximum active tickets',{exact:true})).toHaveValue('2');await page.getByLabel('Maximum active tickets',{exact:true}).fill('3');
  await expect(page.getByText('Worker slots:',{exact:false})).toBeVisible();await page.setViewportSize({width:520,height:1000});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  if(process.env.BARRACKS_LIBRARY_EVIDENCE)await page.screenshot({path:process.env.BARRACKS_LIBRARY_EVIDENCE+'/parallel-delivery-form-narrow.png',fullPage:true});
});
