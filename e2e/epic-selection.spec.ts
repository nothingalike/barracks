import {test,expect} from '@playwright/test';

for(const recommended of [true,false])test('workflow selection precedes and preserves the epic and draft: '+(recommended?'recommended':'manual'),async({page})=>{
  const snapshot=await(await page.request.get('/api/factory?project=slug')).json(),epic={id:'APP-E01',title:'Offline notes',status:'planned',path:'epic.md',dependsOn:[],body:'Scope',revision:'e1'},ticket={id:'APP-001',epic:epic.id,title:'Save',status:'backlog',path:'ticket.md',dependsOn:[],body:'## Acceptance Criteria\n- Save works.',revision:'t1'};
  await page.route('**/api/factory?*',route=>route.fulfill({json:{...snapshot,projects:snapshot.projects.map((project:{id:string;deliveryWorkflowId?:string})=>{if(project.id!=='slug')return project;const {deliveryWorkflowId,...rest}=project;return {...rest,...(recommended?{deliveryWorkflowId:'qualified-delivery'}:{})};}),runs:[]}}));
  await page.route('**/api/tickets?*',route=>route.fulfill({json:[epic,ticket]}));
  await page.route('**/api/delivery-preview?*',route=>route.fulfill({json:{tickets:[ticket],omitted:[],blockers:[],scope:{},planning:[],deferred:[],selection:'epic'}}));
  let submitted:Record<string,unknown>|undefined;
  await page.route('**/api/runs',async route=>{submitted=route.request().postDataJSON();await route.fulfill({status:400,json:{error:'Fixture captured the request; no workflow started.'}});});
  await page.goto('/?project=slug');await page.getByRole('button',{name:'New task',exact:false}).click();
  if(!recommended)await page.getByLabel('Workflow',{exact:true}).selectOption('qualified-delivery');
  await page.getByLabel('Epic to deliver').selectOption(epic.id);
  const options=page.getByText('Run options (optional)',{exact:true});if(await options.count())await options.click();
  await page.getByLabel('Task title').fill('Keep my delivery title');await page.getByLabel('Description',{exact:true}).fill('Keep this delivery direction.');
  if(recommended&&process.env.BARRACKS_FORM_EVIDENCE)await page.screenshot({path:process.env.BARRACKS_FORM_EVIDENCE+'/before-or-after-desktop.png',fullPage:true});
  await page.getByLabel('Workflow',{exact:true}).selectOption('parallel-delivery');
  await expect(page.getByLabel('Epic to deliver')).toHaveValue(epic.id);
  await expect(page.getByText('Recommended for this project.',{exact:false})).toHaveCount(0);
  await expect(page.getByLabel('Task title')).toHaveValue('Keep my delivery title');await expect(page.getByLabel('Description',{exact:true})).toHaveValue('Keep this delivery direction.');
  expect(await page.getByLabel('Workflow',{exact:true}).evaluate((workflow,epicSelector)=>!!(workflow.compareDocumentPosition(document.querySelector(epicSelector)!)&Node.DOCUMENT_POSITION_FOLLOWING),'#target-epic')).toBe(true);
  await page.getByLabel('Workflow',{exact:true}).selectOption('grilling');await expect(page.getByLabel('Epic to deliver')).toHaveCount(0);
  await page.getByLabel('Workflow',{exact:true}).selectOption('qualified-delivery');await expect(page.getByLabel('Epic to deliver')).toHaveValue(epic.id);
  await expect(page.getByLabel('Task title')).toHaveValue('Keep my delivery title');
  await page.setViewportSize({width:520,height:1000});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  if(recommended&&process.env.BARRACKS_FORM_EVIDENCE)await page.screenshot({path:process.env.BARRACKS_FORM_EVIDENCE+'/after-narrow.png',fullPage:true});
  await page.getByRole('button',{name:'Start workflow',exact:true}).click();await expect.poll(()=>submitted?.epicId).toBe(epic.id);expect(submitted?.workflowId).toBe('qualified-delivery');expect(submitted?.title).toBe('Keep my delivery title');expect(submitted?.description).toBe('Keep this delivery direction.');expect(submitted?.ticketIds).toBeUndefined();
});

test('selecting only an epic fills its title and starts without manually chosen tickets',async({page})=>{
  const snapshot=await(await page.request.get('/api/factory?project=slug')).json(),definition=snapshot.workflows.find((workflow:{id:string})=>workflow.id==='qualified-delivery');
  const epic={id:'APP-E01',title:'Offline notes',status:'planned',path:'epic.md',dependsOn:[],body:'Confirmed scope.',revision:'e1'},ticket={id:'APP-001',epic:epic.id,title:'Save a note',status:'backlog',path:'ticket.md',dependsOn:[],body:'## Acceptance Criteria\n- Survives restart.',revision:'t1'};
  await page.route('**/api/factory?*',route=>route.fulfill({json:{...snapshot,projects:snapshot.projects.map((project:{id:string})=>project.id==='slug'?{...project,deliveryWorkflowId:definition.id}:project),runs:[]}}));
  await page.route('**/api/tickets?*',route=>route.fulfill({json:[epic,ticket]}));
  await page.route('**/api/delivery-preview?*',route=>{const query=new URL(route.request().url()).searchParams;expect(query.get('epic')).toBe(epic.id);return route.fulfill({json:{projectId:'slug',epicId:epic.id,tickets:[ticket],omitted:[],blockers:[],scope:{},planning:[ticket.id],deferred:[],selection:'epic'}});});
  let submitted:Record<string,unknown>|undefined;
  const id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',run={id,projectId:'slug',workflowId:definition.id,definition,title:'Deliver Offline notes',description:'',status:'queued',phase:definition.initial,recovery:false,turns:[],questions:[],attempts:[],handoffs:[],childrenDetails:[],artifacts:{},message:'Queued'};
  await page.route('**/api/runs',async route=>{submitted=route.request().postDataJSON();await route.fulfill({json:run});});
  await page.route('**/api/runs/'+id,route=>route.fulfill({json:run}));
  await page.goto('/?project=slug');await page.getByRole('button',{name:'New task',exact:false}).click();
  await expect(page.getByLabel('Workflow',{exact:true})).toHaveValue(definition.id);await page.getByLabel('Epic to deliver').selectOption(epic.id);
  await expect(page.getByLabel('Task title')).toHaveValue('Deliver Offline notes');await expect(page.getByRole('group',{name:'Tickets to deliver'})).toHaveCount(0);
  await expect(page.getByLabel('Choose specific tickets')).toHaveCount(0);
  await expect(page.getByText('The Lead will prepare 1 ticket before building.')).toBeVisible();
  if(process.env.BARRACKS_EPIC_EVIDENCE)await page.screenshot({path:process.env.BARRACKS_EPIC_EVIDENCE+'/epic-desktop.png',fullPage:true});
  await page.setViewportSize({width:520,height:1000});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  if(process.env.BARRACKS_EPIC_EVIDENCE)await page.screenshot({path:process.env.BARRACKS_EPIC_EVIDENCE+'/epic-narrow.png',fullPage:true});
  await page.getByRole('button',{name:'Start workflow',exact:true}).click();await expect.poll(()=>submitted?.epicId).toBe(epic.id);expect(submitted?.ticketIds).toBeUndefined();expect(submitted?.workflowId).toBe(definition.id);
});

test('the board delivers its selected epic without opening a ticket drawer',async({page})=>{
  const snapshot=await(await page.request.get('/api/factory?project=slug')).json();
  const epic={id:'APP-E01',title:'Offline notes',status:'planned',path:'epic.md',dependsOn:[],body:'Confirmed scope.',revision:'e1'},ticket={id:'APP-001',epic:epic.id,title:'Save a note',status:'backlog',path:'ticket.md',dependsOn:[],body:'## Acceptance Criteria\n- Survives restart.',revision:'t1'};
  await page.route('**/api/factory?*',route=>route.fulfill({json:{...snapshot,projects:snapshot.projects.map((project:{id:string})=>project.id==='slug'?{...project,deliveryWorkflowId:'qualified-delivery'}:project),runs:[]}}));
  await page.route('**/api/ticket-board?*',route=>route.fulfill({json:{items:[epic,ticket],statuses:['backlog','todo','in-progress','complete']}}));
  await page.route('**/api/tickets?*',route=>route.fulfill({json:[epic,ticket]}));
  await page.route('**/api/delivery-preview?*',route=>route.fulfill({json:{projectId:'slug',epicId:epic.id,tickets:[ticket],omitted:[],blockers:[],scope:{},planning:[ticket.id],deferred:[],selection:'epic'}}));
  await page.goto('/?project=slug');await page.getByRole('button',{name:'Tickets',exact:true}).click();
  const deliver=page.getByRole('button',{name:'Deliver selected epic',exact:true});await expect(deliver).toBeDisabled();await page.getByRole('combobox',{name:'Epic',exact:true}).selectOption(epic.id);await expect(deliver).toBeEnabled();await expect(page.getByRole('dialog')).toHaveCount(0);
  await deliver.click();await expect(page.getByRole('dialog',{name:'New task'})).toBeVisible();await expect(page.getByLabel('Epic to deliver')).toHaveValue(epic.id);await expect(page.getByLabel('Task title')).toHaveValue('Deliver Offline notes');await expect(page.getByLabel('Choose specific tickets')).toHaveCount(0);await expect(page.getByRole('button',{name:'Start workflow',exact:true})).toBeEnabled();
});

test('an epic-policy preview clears stale manual subset state',async({page})=>{
  const snapshot=await(await page.request.get('/api/factory?project=slug')).json(),epic={id:'APP-E01',title:'Offline notes',status:'planned',path:'epic.md',dependsOn:[],body:'Scope',revision:'e1'},ticket={id:'APP-001',epic:epic.id,title:'Save',status:'backlog',path:'ticket.md',dependsOn:[],body:'## Acceptance Criteria\n- Save works.',revision:'t1'};
  await page.route('**/api/factory?*',route=>route.fulfill({json:{...snapshot,projects:snapshot.projects.map((project:{id:string})=>project.id==='slug'?{...project,deliveryWorkflowId:'qualified-delivery'}:project),runs:[]}}));await page.route('**/api/tickets?*',route=>route.fulfill({json:[epic,ticket]}));
  let previews=0,lastScope:string|null='not-requested';await page.route('**/api/delivery-preview?*',route=>{previews++;lastScope=new URL(route.request().url()).searchParams.get('scope');return route.fulfill({json:{tickets:[ticket],omitted:[],blockers:[],scope:{},planning:[],deferred:[],selection:previews===1?'explicit':'epic'}});});
  await page.goto('/?project=slug');await page.getByRole('button',{name:'New task',exact:false}).click();await page.getByLabel('Epic to deliver').selectOption(epic.id);await page.getByLabel('Choose specific tickets').check();
  await expect(page.getByLabel('Choose specific tickets')).toHaveCount(0);await expect(page.getByRole('group',{name:'Tickets to deliver'})).toHaveCount(0);await expect(page.getByRole('button',{name:'Start workflow',exact:true})).toBeEnabled();await expect.poll(()=>previews).toBeGreaterThanOrEqual(3);expect(lastScope).toBeNull();
});
