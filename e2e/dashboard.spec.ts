import {test,expect} from '@playwright/test';
test('new tasks choose a workflow in the header project without execution or project fields',async({page})=>{
  await page.goto('/?project=slug');await page.getByRole('button',{name:'New task',exact:false}).click();
  await expect(page.getByLabel('Workflow',{exact:true})).toHaveValue('grilling');
  await expect(page.getByLabel('Worker execution',{exact:true})).toHaveCount(0);await expect(page.getByLabel('Project',{exact:true})).toHaveCount(0);
  await expect(page.getByRole('dialog')).not.toContainText('Simulation');await page.getByLabel('Workflow',{exact:true}).selectOption('delivery');await expect(page.getByLabel('Epic to deliver')).toBeVisible();
});
test('task creation submits the selected project and named workflow',async({page})=>{
  await page.goto('/?project=slug');await page.getByRole('button',{name:'New task',exact:false}).click();await page.getByLabel('Task title').fill('A precise product brief');await page.getByLabel('Description',{exact:true}).fill('Product requirements for the configured personas.');
  let submitted:any;
  await page.route('**/api/runs',async route=>{submitted=route.request().postDataJSON();await route.fulfill({status:201,json:{...submitted,id:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',status:'queued',phase:'product-owner',definition:{id:'grilling',name:'Product discovery / grilling',participants:['product-owner','architect','project-manager']},turns:[],questions:[],attempts:[],createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()}});});
  await page.route('**/api/runs/aaaaaaaa-*',route=>route.fulfill({json:{...submitted,id:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',projectId:'slug',status:'queued',phase:'product-owner',definition:{name:'Product discovery / grilling',participants:['product-owner','architect','project-manager']},turns:[],questions:[],childrenDetails:[],message:'Workflow queued.'}}));
  await page.getByRole('button',{name:'Start workflow',exact:true}).click();expect(submitted.projectId).toBe('slug');expect(submitted.workflowId).toBe('grilling');expect(submitted.execution).toBeUndefined();await expect(page.getByRole('dialog')).toHaveCount(0);
});
test('workflow form and project context fit a narrow viewport',async({page})=>{
  await page.setViewportSize({width:390,height:844});await page.goto('/?project=slug');await page.getByRole('button',{name:'New task',exact:false}).click();await expect(page.getByLabel('Workflow',{exact:true})).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);await page.screenshot({path:'.state/real-tests/workflow-form-mobile.png',fullPage:true});
});
