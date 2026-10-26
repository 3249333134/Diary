import {chromium} from 'playwright-core';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';

const output='qa/month-overview/'+(process.env.QA_CONFIRM?'confirmation':'initial')+'/live';await mkdir(output,{recursive:true});
const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true}),results=[];
try{for(const width of [375,1440])for(const theme of ['light','dark']){
 const page=await browser.newPage({viewport:{width,height:900},hasTouch:width<900}),errors=[],writes=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.method()!=='GET'&&r.url().includes('/api/'))writes.push(r.url());});await page.addInitScript(theme=>localStorage.setItem('diary.theme',theme),theme);
 await page.goto('http://127.0.0.1:4320/');await page.getByRole('navigation',{name:'计划视图'}).getByRole('button',{name:'月',exact:true}).click();await page.locator('.todo-panel[aria-busy=false]').waitFor();
 assert.equal(await page.locator('.calendar-month .calendar-chip').count(),0);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 if(!process.env.QA_FUNCTIONAL_ONLY)await page.screenshot({path:`${output}/${width}-${theme}-overview.png`});
 const day=page.locator('.calendar-date[data-shared=true]').first();await day.click();const shared=page.locator('.calendar-day-agenda .calendar-chip[data-shared=true]').first();await shared.scrollIntoViewIfNeeded();assert((await shared.locator('.shared-plan-badge').innerText()).includes('共享'));assert(await shared.locator('.calendar-chip-drag').isVisible());
 if(!process.env.QA_FUNCTIONAL_ONLY)await page.screenshot({path:`${output}/${width}-${theme}-shared.png`});
 assert.deepEqual(errors,[]);assert.deepEqual(writes,[]);results.push({width,theme,errors,writes});await page.close();console.log('live',width,theme,'PASS');
}}finally{await browser.close();await writeFile(output+'/results.json',JSON.stringify(results,null,2));}
