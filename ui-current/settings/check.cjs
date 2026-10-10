const {chromium}=require('playwright');
const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.BROWSER_PATH,headless:true});
 try {
  const page=await browser.newPage({viewport:{width:1280,height:1050}});
  const errors=[];page.on('pageerror',e=>{errors.push(e.message);console.error(e.message)});
  await page.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'?r.continue():r.abort());
  const url='http://127.0.0.1:8778/validation/results/settings-preview.html';
  await page.goto(url);
  const solar=page.locator('main > div').first();
  const input=page.getByRole('spinbutton',{name:'F.R.I.D.A.Y. solar maximum current',exact:true});
  await input.waitFor();assert.equal(await input.inputValue(),'22');
  assert.equal(await input.getAttribute('step'),'1');
  await input.press('ArrowUp');assert.equal(await input.inputValue(),'23');
  await solar.getByRole('button',{name:'Cancel',exact:true}).click();assert.equal(await input.inputValue(),'22');
  await input.fill('21');await solar.getByRole('button',{name:'Save',exact:true}).click();
  await solar.getByText('Saved',{exact:true}).waitFor();
  assert.deepEqual(await page.evaluate(()=>window.saved),[{vehicleSolarCurrentLimits:{friday:21,edith:16}}]);
  await page.reload();await input.waitFor();assert.equal(await input.inputValue(),'21');
  await input.fill('22.5');await solar.getByRole('alert').waitFor();assert.equal(await solar.getByRole('button',{name:'Save',exact:true}).count(),0);
  await input.fill('81');await solar.getByRole('alert').waitFor();
  await input.fill('22');await page.evaluate(()=>window.failNext=true);
  await solar.getByRole('button',{name:'Save',exact:true}).click();await solar.getByText('Save failed. Please retry.').waitFor();
  assert.equal(await input.inputValue(),'22');
  await solar.getByRole('button',{name:'Save',exact:true}).click();await solar.getByText('Saved',{exact:true}).waitFor();
  await input.fill('');await solar.getByRole('button',{name:'Save',exact:true}).click();
  await page.waitForFunction(()=>window.saved.at(-1)?.vehicleSolarCurrentLimits?.friday===undefined);
  assert.deepEqual(await page.evaluate(()=>window.saved.at(-1)),{vehicleSolarCurrentLimits:{edith:16}});
  await input.fill('22');await solar.getByRole('button',{name:'Save',exact:true}).click();await solar.getByText('Saved',{exact:true}).waitFor();
  await page.screenshot({path:'validation/results/settings-desktop.png',fullPage:true});
  await page.setViewportSize({width:390,height:1100});
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'mobile horizontal overflow');
  await page.screenshot({path:'validation/results/settings-mobile.png',fullPage:true});
  await page.goto(url+'?fail');
  await solar.getByRole('button',{name:'Retry',exact:true}).click();
  await input.waitFor();assert.equal(await input.inputValue(),'22');
  await page.goto(url.replace('settings-preview','settings-layout-preview'));
  const groups=[['Solar regulation','Solar draft'],['Home battery protection','Battery draft'],['System and storage','System draft'],['Notifications','Notifications draft'],['Authentication','Authentication draft'],['Import from Charge HQ','Charge HQ import'],['Import from Wattpilot','Wattpilot import']];
  for(const [title,label] of groups){
   const toggle=page.getByRole('button',{name:title,exact:true});
   const field=page.getByRole('textbox',{name:label,exact:true});
   assert.equal(await toggle.getAttribute('aria-expanded'),'false');
   assert.equal(await field.isVisible(),false);
   await toggle.focus();await page.keyboard.press('Enter');
   assert.equal(await toggle.getAttribute('aria-expanded'),'true');
   await field.fill('unsaved draft');
   await toggle.click();assert.equal(await field.isVisible(),false);
   await toggle.click();assert.equal(await field.inputValue(),'unsaved draft');
   await toggle.click();
  }
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'sections mobile overflow');
  await page.screenshot({path:'validation/results/settings-sections-mobile.png',fullPage:true});
  await page.setViewportSize({width:1280,height:1050});
  await page.screenshot({path:'validation/results/settings-sections-desktop.png',fullPage:true});
  assert.deepEqual(errors,[]);
  console.log('PASS: 1 A steps, cancel, persistence/reload, validation, save failure/retry, removal, other vehicle preservation, 7 collapsible sections, keyboard, draft retention, desktop/mobile');
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exit(1)});
