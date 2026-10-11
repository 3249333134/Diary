import {chromium} from 'playwright-core';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
await mkdir('qa/compact-tools',{recursive:true});const results=[];
try { for(const width of [375,768,1440])for(const theme of ['light','dark']) {
const page=await browser.newPage({viewport:{width,height:900},hasTouch:width<900});const errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.addInitScript(theme=>localStorage.setItem('diary.theme',theme),theme);
await page.route('**/api/diaries/*',async route=>{if(route.request().method()==='PUT')await route.fulfill({json:{document:route.request().postDataJSON(),version:'qa',exists:true}});else await route.continue();});
await page.goto('http://127.0.0.1:4320');await page.locator('.event-block').first().waitFor();
await page.locator('.event-stack').hover();await page.mouse.wheel(0,180);
if(width<900) {
await page.waitForFunction(()=>document.querySelector('main').dataset.compact==='true');
await page.getByRole('button',{name:'日期与今日信息',exact:true}).click();
const sheet=page.locator('dialog:visible');await sheet.getByLabel('今日备注').fill('紧凑面板备注');await sheet.getByRole('button',{name:'完成编辑'}).click();
assert.equal(await page.locator('#compact-day-note').inputValue(),'紧凑面板备注');
await page.getByRole('button',{name:'计划',exact:true}).click();await page.locator('.plan-board-scroll').waitFor();
assert.equal(await page.locator('main').getAttribute('data-compact'),'true');
await page.getByRole('button',{name:'筛选计划',exact:true}).click();
await sheet.getByRole('button',{name:'工作',exact:true}).click();await sheet.getByRole('button',{name:/显示 .* 项/}).click();
assert.equal(await page.locator('.plan-board-scroll .category-personal').count(),0);
assert.equal(await page.locator('main').getAttribute('data-compact'),'true');
await page.getByRole('button',{name:'新增计划',exact:true}).click();await page.locator('dialog:visible').waitFor();await page.keyboard.press('Escape');
assert.equal(await page.locator('dialog:visible').count(),0);assert.equal(await page.locator('main').getAttribute('data-compact'),'true');
if(!process.env.QA_FUNCTIONAL_ONLY)await page.screenshot({path:'qa/compact-tools/'+width+'-'+theme+'-plan.png'});
await page.getByRole('button',{name:'日记',exact:true}).click();assert.equal(await page.locator('main').getAttribute('data-compact'),'true');
await page.getByRole('button',{name:'日期与今日信息',exact:true}).click();await sheet.getByRole('button',{name:'前一天',exact:true}).click();await page.keyboard.press('Escape');
assert.equal(await page.locator('main').getAttribute('data-compact'),'true');
if(!process.env.QA_FUNCTIONAL_ONLY)await page.screenshot({path:'qa/compact-tools/'+width+'-'+theme+'-diary.png'});
assert(await page.evaluate(()=>document.documentElement.scrollHeight<=innerHeight+2));
} else {assert.equal(await page.locator('main').getAttribute('data-compact'),'false');if(!process.env.QA_FUNCTIONAL_ONLY)await page.screenshot({path:'qa/compact-tools/'+width+'-'+theme+'-diary.png'});}
assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2));assert.deepEqual(errors,[]);results.push({width,theme,passed:true});await page.close();
} await writeFile('qa/compact-tools/results.json',JSON.stringify(results,null,2));console.log(JSON.stringify(results)); } finally {await browser.close();}
