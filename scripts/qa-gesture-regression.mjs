import {chromium} from 'playwright-core';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {emptyDiary,todoSchema} from '../packages/contracts/dist/index.js';

const output='qa/gesture-performance';await mkdir(output,{recursive:true});
const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
const results=[],date='2026-10-20';
try{for(const width of [375,1440]){
 const page=await browser.newPage({viewport:{width,height:900},hasTouch:true});page.setDefaultTimeout(7000);
 await page.clock.install({time:new Date(date+'T04:00:00Z')});
 const errors=[],writes=[],checks=[];page.on('pageerror',e=>errors.push(e.message));
 let categories=[{id:'work',name:'工作',color:'#7bb4de',order:0},{id:'personal',name:'个人生活',color:'#c5a27e',order:1}];
 let rows=Array.from({length:4},(_,i)=>({date,version:'v0',task:todoSchema.parse({id:'gesture-'+i,title:'手势任务 '+i,dueDate:date,dueTime:i%2?'15:00':'10:00',category:i<2?'work':'personal',important:true,urgent:i<2}),sourceExists:false,completionExists:false}));
 await page.route('**/api/**',async route=>{
  const req=route.request(),path=new URL(req.url()).pathname;let json={};
  if(req.method()!=='GET')writes.push({path,body:req.postDataJSON()});
  if(path==='/api/auth/me')json={id:1,username:'手势回归'};
  else if(path.startsWith('/api/diaries/'))json={document:emptyDiary(path.split('/').pop()),version:'v0',exists:true};
  else if(path==='/api/schedule'||path==='/api/actions'){
   if(req.method()==='POST'){const input=req.postDataJSON();rows=rows.map(row=>row.task.id===input.task.id?{...row,task:input.task}:row);json={diary:{document:{...emptyDiary(date),todos:rows.map(row=>row.task)},version:'v0',exists:true}};}
   else json={tasks:rows,records:[]};
  }else if(path==='/api/plan-categories/order'){const ids=req.postDataJSON().ids;categories=ids.map((id,order)=>({...categories.find(c=>c.id===id),order}));json={categories};}
  else if(path==='/api/plan-categories')json={categories};
  else if(path==='/api/entities')json={entities:[]};else if(path==='/api/tags')json={tags:{person:[],place:[],activity:[],food:[],thing:[]}};
  else if(path==='/api/weeks')json={start:date,end:date,entries:[]};else if(path==='/api/plan-views')json={views:[]};else if(path==='/api/quick-facts')json={facts:[]};else if(path==='/api/tag-library')json={tags:[]};
  await route.fulfill({json});
 });
 const choose=label=>page.getByRole('navigation',{name:'计划视图'}).getByRole('button',{name:label,exact:true}).click();
 const point=async locator=>{await locator.scrollIntoViewIfNeeded();const r=await locator.boundingBox();return {x:r.x+r.width/2,y:r.y+r.height/2};};
 const startMouse=async locator=>{const p=await point(locator);await page.mouse.move(p.x,p.y);await page.mouse.down();return p;};
 const check=async(name,fn)=>{await fn();checks.push(name);console.log(width,'PASS',name);};
 await page.goto('http://127.0.0.1:4320');await page.locator('.calendar-chip').first().waitFor();
 await check('same-frame last move is used on release and remains a local preview',async()=>{
  const chip=page.locator('.calendar-chip[data-record-id=gesture-0]'),handle=chip.locator('.calendar-chip-copy');await startMouse(handle);
  const target=page.locator('.timeline-date[data-calendar-date="2026-10-21"]'),p=await point(target);
  // Two events in one browser task exercise release before the scheduled paint.
  await chip.evaluate((el,p)=>{for(const type of ['pointermove','pointerup'])el.dispatchEvent(new PointerEvent(type,{bubbles:true,pointerId:1,pointerType:'mouse',isPrimary:true,button:0,buttons:type==='pointerup'?0:1,clientX:p.x,clientY:p.y}));},p);
  await page.mouse.up();await page.locator('.calendar-chip[data-record-id=gesture-0][data-pending=true]').waitFor();
  assert.equal(await page.locator('.timeline-all-day[data-calendar-date="2026-10-21"] .calendar-chip[data-record-id=gesture-0]').count(),1);assert.equal(writes.length,0);
  await page.locator('.calendar-drop-review').getByRole('button',{name:'取消',exact:true}).click();assert.equal(writes.length,0);
 });
 await check('Escape cancels the scheduled movement and release never opens an editor',async()=>{
  const p=await startMouse(page.locator('.calendar-chip[data-record-id=gesture-0] .calendar-chip-copy'));
  await page.mouse.move(p.x+12,p.y+12);await page.locator('.calendar-drag-ghost').waitFor();await page.keyboard.press('Escape');await page.mouse.up();
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>resolve(null))));
  assert.equal(await page.locator('.calendar-drag-ghost,.plan-task-dialog,.calendar-chip[data-pending=true]').count(),0);assert.equal(writes.length,0);
 });
 await check('quadrant drop commits only at release and uses the final target',async()=>{
  await choose('四象限');await startMouse(page.locator('.plan-card[data-plan-id=gesture-0] .plan-drag-handle'));
  const target=page.locator('.plan-quadrant[aria-label="重要不紧急"]'),p=await point(target.locator('h3'));
  const before=writes.length;await page.mouse.move(p.x,p.y);await page.locator('.plan-drag-preview').waitFor();assert.equal(writes.length,before);await page.mouse.up();
  await page.waitForFunction(()=>document.querySelector('.plan-card[data-plan-id="gesture-0"]')?.closest('.plan-quadrant')?.getAttribute('aria-label')==='重要不紧急');
  assert.equal(writes.length,before+1);assert.equal(writes.at(-1).body.task.urgent,false);
 });
 await check('window card moves without layout offsets and restores after Escape',async()=>{
  await choose('窗口');const card=page.locator('.plan-card[data-plan-id=gesture-0]'),p=await startMouse(card.locator('.plan-drag-handle'));
  await page.mouse.move(p.x-30,p.y+25);await page.waitForFunction(()=>document.querySelector('.plan-card-dragging')?.style.transform.includes('translate3d'));
  const before=writes.length;await page.keyboard.press('Escape');await page.mouse.up();assert.equal(await card.evaluate(el=>el.style.transform+el.style.position),'');
  assert.equal(await page.locator('.plan-card-placeholder,.plan-card-dragging').count(),0);assert.equal(writes.length,before);
 });
 await check('window drop and private window reorder use the final location',async()=>{
  await startMouse(page.locator('.plan-card[data-plan-id=gesture-0] .plan-drag-handle'));
  const p=await point(page.locator('[data-window-id=personal] .plan-window-header'));const before=writes.length;
  await page.mouse.move(p.x,p.y);assert.equal(writes.length,before);await page.mouse.up();
  await page.locator('[data-window-id=personal] .plan-card[data-plan-id=gesture-0]').waitFor();assert.equal(writes.at(-1).body.task.category,'personal');
  await startMouse(page.locator('[data-window-id=work] .plan-window-header'));
  const destination=await point(page.locator('[data-window-id=personal] .plan-window-header'));await page.mouse.move(destination.x+30,destination.y);await page.mouse.up();
  await page.waitForFunction(()=>document.querySelector('.plan-window[data-window-id]')?.getAttribute('data-window-id')==='personal');
  assert.deepEqual(writes.at(-1).body.ids,['personal','work']);assert.equal(await page.locator('.plan-window-placeholder,.plan-window-dragging').count(),0);
 });
 await check('touch intent before long press restores original card and long press cancels cleanly',async()=>{
  const cdp=await page.context().newCDPSession(page);
  const handle=page.locator('.plan-card[data-plan-id=gesture-2] .plan-drag-handle'),p=await point(handle),before=writes.length;
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[p]});await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:p.x,y:p.y+25}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await page.waitForTimeout(40);assert.equal(await page.locator('.plan-card-placeholder,.plan-card-dragging').count(),0);
  const next=await point(handle);await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[next]});await page.waitForTimeout(380);await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:next.x-20,y:next.y+20}]});
  await page.waitForFunction(()=>document.querySelector('.plan-card-dragging')?.style.transform.includes('translate3d'));await page.keyboard.press('Escape');await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await cdp.detach();
  assert.equal(await page.locator('.plan-card-placeholder,.plan-card-dragging').count(),0);assert.equal(writes.length,before);
 });
 assert.deepEqual(errors,[]);results.push({width,checks,errors});await page.close();
}}finally{await browser.close();await writeFile(output+'/regression.json',JSON.stringify(results,null,2));}
