import {selectPlanView} from './plan-view.mjs';
import {chromium} from 'playwright-core';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';

const output='qa/gesture-performance';await mkdir(output,{recursive:true});
const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
const results=[];
try{for(const width of [375,1440]){
 const page=await browser.newPage({viewport:{width,height:900},hasTouch:width<900});page.setDefaultTimeout(9000);
 const writes=[];page.on('request',req=>{if(req.method()!=='GET'&&req.url().includes('/api/'))writes.push(req.url());});
 await page.goto('http://127.0.0.1:4320/');await page.locator('.calendar-chip').first().waitFor();
 const cdp=await page.context().newCDPSession(page);await cdp.send('Performance.enable');await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});
 const metric=async()=>Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(m=>[m.name,m.value]));
 for(const [label,handleSelector,ghostSelector]of [['两周','.calendar-chip-copy','.calendar-drag-ghost'],['四象限','.plan-drag-handle','.plan-drag-preview'],['窗口','.plan-drag-handle','.plan-card-dragging']]){
  await selectPlanView(page,label);await page.waitForTimeout(250);
  const handle=label==='两周'?page.locator('.timeline-timed-cell .calendar-chip').filter({has:page.locator('input:not(:disabled):not(:checked)')}).locator('.calendar-chip-copy').first():page.locator(handleSelector+':not([disabled])').first();await handle.scrollIntoViewIfNeeded();if(label==='两周')await handle.evaluate(h=>{const el=h.closest('.calendar-scroll'),r=h.getBoundingClientRect(),b=el.getBoundingClientRect();el.scrollTop+=r.y+r.height/2-(b.y+44+(b.height-44)/2);el.scrollLeft+=r.x+r.width/2-(b.x+96+(b.width-96)/2);});await page.waitForTimeout(50);const r=await handle.boundingBox(),start={x:r.x+r.width/2,y:r.y+r.height/2};
  await page.mouse.move(start.x,start.y);await page.mouse.down();await page.mouse.move(start.x+9,start.y+9);await page.locator(ghostSelector).waitFor();
  await page.evaluate(()=>{window.__frames=[];window.__tracking=true;let previous=performance.now();const frame=now=>{window.__frames.push(now-previous);previous=now;if(window.__tracking)requestAnimationFrame(frame);};requestAnimationFrame(frame);});
  const before=await metric(),started=Date.now();
  for(let i=0;i<60;i++)await page.mouse.move(start.x+12+Math.sin(i/7)*18,start.y+12+Math.cos(i/7)*18);
  const after=await metric(),elapsed=Date.now()-started,frames=await page.evaluate(()=>{window.__tracking=false;return window.__frames;});
  await page.keyboard.press('Escape');await page.mouse.up();const cancelOpenedEditor=await page.locator('.plan-task-dialog').count()>0;if(cancelOpenedEditor)await page.keyboard.press('Escape');assert.equal(writes.length,0);
  results.push({width,view:label,cpuRate:4,cancelOpenedEditor,moves:60,elapsed,scriptMs:(after.ScriptDuration-before.ScriptDuration)*1000,taskMs:(after.TaskDuration-before.TaskDuration)*1000,layouts:after.LayoutCount-before.LayoutCount,frames:frames.length,slowFrames:frames.filter(f=>f>25).length,p95:frames.sort((a,b)=>a-b)[Math.floor(frames.length*.95)]||0,maxFrame:Math.max(0,...frames)});
 }
 await cdp.detach();await page.close();
}}finally{await browser.close();await writeFile(`${output}/${process.env.QA_STAGE||'baseline'}.json`,JSON.stringify(results,null,2));}
console.log(JSON.stringify(results));
