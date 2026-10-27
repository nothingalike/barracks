import {test,expect} from '@playwright/test';

test('project settings expose Lead coordination without granting Builder access',async({page})=>{
  const project=await(await page.request.get('/api/projects/slug')).json();let saved:typeof project|undefined;
  await page.route('**/api/projects/slug',async route=>{if(route.request().method()==='GET')return route.fulfill({json:project});saved=route.request().postDataJSON();return route.fulfill({json:saved});});
  await page.goto('/?project=slug');await page.getByRole('button',{name:/^Switch project:/}).click();await page.getByRole('button',{name:'Project Settings',exact:true}).click();
  await expect(page.getByLabel('Lead source coordination')).toHaveValue('listed');await page.getByLabel('Lead source coordination').selectOption('project');await expect(page.getByText('Builders keep explicit file scopes.',{exact:false})).toBeVisible();
  await page.setViewportSize({width:520,height:1000});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.getByRole('button',{name:'Save project settings'}).click();await expect.poll(()=>saved?.delivery?.leadDelegation).toBe('project');expect(saved?.delivery?.requirePathGrants).toBe(project.delivery?.requirePathGrants??false);
});
