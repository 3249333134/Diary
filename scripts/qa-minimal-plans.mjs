import {chromium} from 'playwright-core';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
await mkdir('qa/minimal-plans',{recursive:true});const results=[];
try {for(const width of [375,768,1440])for(const theme of ['light','dark']) {
const page=await browser.newPage({viewport:{width,height:900},hasTouch:width<900});const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.addInitScript(theme=>localStorage.setItem('diary.theme',theme),theme);
await page.goto('http://127.0.0.1:4320');await page.getByRole('button',{name:'计划',exact:true}).click();await page.locator('.plan-card').first().waitFor();
if(width<900){await page.locator('.plan-board-scroll').hover();await page.mouse.wheel(0,180);await page.waitForFunction(()=>document.querySelector('main').dataset.compact==='true');}
const card=page.locator('.plan-card').first(),summary=card.locator('.plan-card-summary');assert.equal(await summary.getAttribute('aria-expanded'),'false');assert.equal(await card.locator('.plan-card-details').isVisible(),false);
await page.screenshot({path:'qa/minimal-plans/'+width+'-'+theme+'-collapsed.png'});
await summary.focus();await page.keyboard.press('Enter');assert.equal(await summary.getAttribute('aria-expanded'),'true');await card.getByRole('button',{name:'修改',exact:true}).click();await page.locator('dialog:visible').waitFor();await page.keyboard.press('Escape');
assert.equal(await card.locator('.plan-card-details').isVisible(),true);
await card.getByRole('combobox',{name:/移动到：/}).waitFor({state:'visible'});assert(await card.getByRole('button',{name:'完成',exact:true}).isVisible());assert(await card.getByRole('button',{name:/删除计划：/}).isVisible());
await page.screenshot({path:'qa/minimal-plans/'+width+'-'+theme+'-expanded.png'});
await summary.focus();await page.keyboard.press('Space');assert.equal(await card.locator('.plan-card-details').isVisible(),false);
assert.equal(await card.locator('.plan-drag-handle').count(),1);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2));assert.deepEqual(errors,[]);results.push({width,theme,passed:true});await page.close();
} await writeFile('qa/minimal-plans/results.json',JSON.stringify(results,null,2));console.log(JSON.stringify(results));}finally{await browser.close();}
