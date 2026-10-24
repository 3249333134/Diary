import {chromium} from 'playwright-core';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';

const output='qa/ui-smoothness'+(process.env.QA_CONFIRM?'/confirmation':'');await mkdir(output,{recursive:true});
const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
const results=[];
try{
 for(const width of [375,768,1440])for(const theme of ['light','dark']){
  if(process.env.QA_WIDTHS&&!process.env.QA_WIDTHS.split(',').includes(String(width))||process.env.QA_THEME&&process.env.QA_THEME!==theme)continue;
  const page=await browser.newPage({viewport:{width,height:900},hasTouch:width<900});page.setDefaultTimeout(8000);
  await page.addInitScript(theme=>{localStorage.setItem('diary.theme',theme);window.__long=[];new PerformanceObserver(l=>window.__long.push(...l.getEntries().map(e=>e.duration))).observe({type:'longtask',buffered:true});},theme);
  const requests=[],errors=[],writes=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.method()!=='GET'&&r.url().includes('/api/'))writes.push(r.url());});page.on('requestfinished',r=>{if(r.url().includes('/api/'))requests.push({path:new URL(r.url()).pathname,ms:Math.round(r.timing().responseEnd)});});
  const shot=async name=>{if(!process.env.QA_FUNCTIONAL_ONLY)await page.screenshot({path:`${output}/${width}-${theme}-${name}.png`});};
  const started=Date.now();await page.goto('http://127.0.0.1:4320/');await page.locator('.calendar-chip').first().waitFor();await page.waitForTimeout(1200);const landing=Date.now()-started,views=[];
  for(const label of ['窗口','列表','四象限','两周']){
   const time=Date.now();await page.getByRole('navigation',{name:'计划视图'}).getByRole('button',{name:label,exact:true}).click();await page.waitForTimeout(1100);
   views.push({label,ms:Date.now()-time,dom:await page.locator('*').count(),cards:await page.locator('.plan-card,.calendar-chip').count()});
   if(label==='窗口'||label==='列表'){
    assert.equal(await page.locator('.plan-card-details').count(),0);
    const card=page.locator('.plan-card').first();await card.locator('.plan-card-summary').click();assert.equal(await page.locator('.plan-card-details').count(),1);await card.getByRole('button',{name:'修改',exact:true}).click();await page.locator('.plan-task-dialog').waitFor();if(label==='窗口')await shot('form');await page.locator('.plan-action-dock').getByRole('button',{name:'取消',exact:true}).click();await card.locator('.plan-card-summary').click();
   }
   if(label==='窗口'){
    const area=page.locator('.plan-windows-scroll');await page.getByRole('button',{name:'定位个人生活窗口',exact:true}).click();await page.waitForTimeout(220);assert(await area.evaluate(el=>{const target=el.querySelector('[data-window-id=personal]').getBoundingClientRect(),box=el.getBoundingClientRect();return target.left<box.right&&target.right>box.left;}));await page.getByRole('button',{name:'定位工作窗口',exact:true}).click();await page.waitForTimeout(220);
   }
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await shot(label);
  }
  const nav=name=>page.getByRole('navigation',{name:'主导航'}).getByRole('button',{name,exact:true});
  await nav('日记').click();await page.locator('.diary-main-toolbar').waitFor();await shot('diary');await nav('我的').click();await page.getByRole('heading',{name:'我的',exact:true}).waitFor();await shot('mine');
  await nav('日程').click();const details=await page.evaluate(()=>({longTasks:window.__long,totalLong:window.__long.reduce((a,b)=>a+b,0),nodes:document.querySelectorAll('*').length}));assert.deepEqual(writes,[]);assert.deepEqual(errors,[]);results.push({width,theme,landing,views,details,requests,errors});await page.close();
 }
}finally{await browser.close();await writeFile(`${output}/after.json`,JSON.stringify(results,null,2));}
console.log(JSON.stringify(results.map(r=>({width:r.width,theme:r.theme,landing:r.landing,views:r.views,longest:Math.max(0,...r.details.longTasks),totalLong:r.details.totalLong,requests:r.requests.length}))));
