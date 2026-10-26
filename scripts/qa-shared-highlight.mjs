import {chromium} from 'playwright-core';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';

const output='qa/shared-highlight'+(process.env.QA_CONFIRM?'/confirmation':'/initial');await mkdir(output,{recursive:true});
const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});const results=[];
try{for(const width of [375,624,1440])for(const theme of ['light','dark']){
 const page=await browser.newPage({viewport:{width,height:900},hasTouch:width<900});page.setDefaultTimeout(8000);const errors=[],writes=[],checks=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.method()!=='GET'&&r.url().includes('/api/'))writes.push(r.url());});await page.addInitScript(theme=>localStorage.setItem('diary.theme',theme),theme);
 await page.goto('http://127.0.0.1:4320/');await page.locator('.calendar-chip').first().waitFor();
 for(const label of ['两周','月','列表','窗口','四象限']){
  await page.getByRole('navigation',{name:'计划视图'}).getByRole('button',{name:label,exact:true}).click();await page.locator('.todo-panel[aria-busy=false]').waitFor();
  if(label==='月')await page.locator('.calendar-date[data-shared=true]').first().click();
  const shared=page.locator('.calendar-chip[data-shared=true],.plan-card[data-shared=true]');await shared.first().waitFor();
  assert.equal(await shared.locator('.shared-plan-badge').count(),await shared.count(),label);
  assert.equal(await page.locator('.calendar-chip:not([data-shared]) .shared-plan-badge,.plan-card:not([data-shared]) .shared-plan-badge').count(),0);
  const semantics=await shared.first().evaluate(el=>({urgency:getComputedStyle(el).getPropertyValue('--urgency-color'),name:el.querySelector('.shared-plan-badge').getAttribute('aria-label')}));assert(semantics.urgency);assert(semantics.name.startsWith('共享窗口：'));
  if(label==='两周'||label==='月'){
   const card=shared.first();await card.scrollIntoViewIfNeeded();
   const geometry=await card.evaluate(el=>{const badge=el.querySelector('.shared-plan-badge').getBoundingClientRect(),copy=el.querySelector('.calendar-chip-copy').getBoundingClientRect(),meta=el.querySelector('.calendar-shared-meta'),time=el.querySelector('.calendar-deadline-text').getBoundingClientRect();return {height:el.getBoundingClientRect().height,badgeRight:badge.right,copyRight:copy.right,timeRight:time.right,metaDisplay:getComputedStyle(meta).display};});
   assert.equal(geometry.metaDisplay,'flex');assert(geometry.badgeRight<=geometry.copyRight+1);assert(geometry.timeRight<=geometry.copyRight+1);
   if(label==='两周')assert.equal(geometry.height,60);
  }
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));checks.push({view:label,shared:await shared.count()});
  if(!process.env.QA_FUNCTIONAL_ONLY&&['两周','月','列表'].includes(label)){await page.mouse.move(1,1);await page.screenshot({path:`${output}/${width}-${theme}-${label}.png`});}
 }
 assert.deepEqual(errors,[]);assert.deepEqual(writes,[]);results.push({width,theme,checks,errors,writes});await page.close();console.log(width,theme,'PASS',checks.length);
}}finally{await browser.close();await writeFile(output+'/results.json',JSON.stringify(results,null,2));}
