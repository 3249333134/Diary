import {chromium} from 'playwright-core';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {emptyDiary,todoSchema} from '../packages/contracts/dist/index.js';
import {dragCalendar} from './calendar-drag.mjs';
import {selectPlanView} from './plan-view.mjs';

const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
const output='qa/calendar-pan/'+(process.env.QA_FUNCTIONAL_ONLY?'functional':process.env.QA_CONFIRM?'confirmation':'initial');
await mkdir(output,{recursive:true});
const date='2026-10-23',monday='2026-10-19';
const shift=n=>{const d=new Date(monday+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10);};
const results=[];
try{for(const width of [375,624,768,1280,1440])for(const theme of ['light','dark']){
 if(process.env.QA_WIDTH&&Number(process.env.QA_WIDTH)!==width||process.env.QA_THEME&&process.env.QA_THEME!==theme)continue;
 const page=await browser.newPage({viewport:{width,height:900},hasTouch:true});page.setDefaultTimeout(7000);
 await page.clock.install({time:new Date(date+'T04:00:00Z')});
 await page.addInitScript(theme=>localStorage.setItem('diary.theme',theme),theme);
 const checks=[],errors=[],writes=[];
 let rows=Array.from({length:14},(_,i)=>({date,version:'v0',task:todoSchema.parse({id:'pan-'+i,title:'日程 '+i,dueDate:shift(i),dueTime:['08:00','09:00','10:00','11:00','12:00','15:00','18:00','20:00'][i%8],category:'work',important:true,urgent:i%2===0}),sourceExists:false,completionExists:false}));
 for(const day of [0,4])for(let i=0;i<4;i++)rows.push({...rows[day],task:{...rows[day].task,id:`dense-${day}-${i}`,title:'密集任务 '+i}});
 rows.push({...rows[0],task:{...rows[0].task,id:'all-day',title:'全天任务',dueTime:''}});
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/api/**',async route=>{
  const req=route.request(),path=new URL(req.url()).pathname;let json={};
  if(req.method()!=='GET')writes.push({path,body:req.postData()});
  if(path==='/api/auth/me')json={id:1,username:'本地演示'};
  else if(path.startsWith('/api/diaries/'))json={document:emptyDiary(path.split('/').pop()),version:'v0',exists:true};
  else if(path==='/api/actions'||path==='/api/schedule'){
   if(req.method()==='POST'){const input=req.postDataJSON();rows=rows.map(row=>row.task.id===input.task.id?{...row,task:input.task}:row);json={diary:{document:{...emptyDiary(date),todos:rows.map(row=>row.task)},version:'v0',exists:true}};}
   else json={tasks:rows,records:[]};
  }else if(path==='/api/plan-categories')json={categories:[{id:'work',name:'工作',color:'#7bb4de',order:0},{id:'personal',name:'个人生活',color:'#c5a27e',order:1}]};
  else if(path==='/api/entities')json={entities:[]};else if(path==='/api/tags')json={tags:{person:[],place:[],activity:[],food:[],thing:[]}};
  else if(path==='/api/weeks')json={start:date,end:date,entries:[]};else if(path==='/api/plan-views')json={views:[]};else if(path==='/api/quick-facts')json={facts:[]};else if(path==='/api/tag-library')json={tags:[]};
  await route.fulfill({json});
 });
 const area=page.locator('.calendar-scroll');
 const position=()=>area.evaluate(el=>({left:el.scrollLeft,top:el.scrollTop,maxLeft:el.scrollWidth-el.clientWidth,maxTop:el.scrollHeight-el.clientHeight}));
 const blank=async(scope='timed')=>page.evaluate(scope=>{
  const box=document.querySelector('.calendar-scroll'),r=box.getBoundingClientRect(),date=document.querySelector('.timeline-date').getBoundingClientRect();
  const isBlank=(x,y)=>{const el=document.elementFromPoint(x,y);return el&&!el.closest('.calendar-chip,button,input,a,summary')&&el.closest(scope==='timed'?'.timeline-timed-cell':'.timeline-all-day');};
  for(let y=r.top+90;y<r.bottom-30;y+=18)for(let x=Math.max(r.left+date.width+20,r.left+60);x<r.right-30;x+=18){
   // Chromium touch hit testing can retarget near misses to an adjacent button.
   if([[x,y],[x-25,y],[x+25,y],[x,y-25],[x,y+25]].every(([a,b])=>isBlank(a,b)))return{x,y};
  }
  throw new Error('No blank canvas visible: '+scope);
 },scope);
 const pan=async({touch=false,dx=-70,dy=-80,scope='timed',cancel=false}={})=>{
  await page.waitForTimeout(50); // Wait for scroll/layout hit testing before choosing the blank surface.
  const start=await blank(scope),before=await position();let cdp,touchActive=false;
  try{
   if(touch){cdp=await page.context().newCDPSession(page);await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[start]});touchActive=true;}
   else{await page.mouse.move(start.x,start.y);await page.mouse.down();}
   for(let i=1;i<=8;i++){
    const target={x:start.x+dx*i/8,y:start.y+dy*i/8};
    if(cdp)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[target]});else await page.mouse.move(target.x,target.y);
   }
   await page.waitForTimeout(40); // CDP touch moves are delivered on the compositor's next frame.
   assert.equal(await area.getAttribute('data-panning'),'true',JSON.stringify({start,before,dx,dy,scope}));
   const after=await position();
   assert(Math.abs(after.left-Math.max(0,Math.min(before.maxLeft,before.left-dx)))<2,`horizontal pan ${JSON.stringify({before,after,dx})}`);
   assert(Math.abs(after.top-Math.max(0,Math.min(before.maxTop,before.top-dy)))<2,`vertical pan ${JSON.stringify({before,after,dy})}`);
   if(cdp){await cdp.send('Input.dispatchTouchEvent',{type:cancel?'touchCancel':'touchEnd',touchPoints:[]});touchActive=false;}else await page.mouse.up();
   await page.waitForTimeout(20);
   assert.equal(await area.getAttribute('data-panning'),null);
   assert.equal(await page.locator('.calendar-drag-ghost').count(),0);
  }finally{if(cdp){if(touchActive)await cdp.send('Input.dispatchTouchEvent',{type:'touchCancel',touchPoints:[]});await cdp.detach();}else await page.mouse.up();}
 };
 const check=async(name,fn)=>{try{await fn();checks.push({name,passed:true});console.log(width,theme,'PASS',name);}catch(error){checks.push({name,passed:false,error:error.stack});console.log(width,theme,'FAIL',name,error.message);await page.mouse.up();await page.keyboard.press('Escape');}};
 await page.goto('http://127.0.0.1:4320');await page.locator('[data-record-id=pan-0]').waitFor();
 await check('mouse diagonal pan follows pointer, reverse pan and sticky date/hour headers',async()=>{
  await area.evaluate(el=>{el.scrollLeft=180;el.scrollTop=120;});
  await pan();await pan({dx:70,dy:60});
  const a=await area.boundingBox(),h=await page.locator('.calendar-timeline-heading').boundingBox(),d=await page.locator('.timeline-date').nth(3).boundingBox();
  assert(Math.abs(a.y-h.y)<2);assert(Math.abs(a.x-d.x)<2);
  assert.equal(await page.evaluate(()=>getSelection().toString()),'');assert.equal(writes.length,0);
 });
 await check('touch horizontal, vertical, diagonal and cancellation pan without changing tasks',async()=>{
  for(const delta of [{dx:-60,dy:0},{dx:0,dy:-65},{dx:55,dy:50},{dx:-30,dy:-30,cancel:true}])await pan({...delta,touch:true});
  assert.equal(await page.locator('.calendar-chip[data-pending=true]').count(),0);assert.equal(writes.length,0);
 });
 await check('tap threshold, right mouse and native wheel remain intact',async()=>{
  const start=await blank(),before=await position();
  await page.mouse.move(start.x,start.y);await page.mouse.down();await page.mouse.move(start.x+3,start.y+2);await page.mouse.up();assert.deepEqual(await position(),before);
  await page.mouse.down({button:'right'});await page.mouse.move(start.x-20,start.y-20);await page.mouse.up({button:'right'});assert.deepEqual(await position(),before);
  await page.mouse.move(start.x,start.y);await page.mouse.wheel(50,70);await page.waitForTimeout(150);const after=await position();assert(after.top>before.top||after.left>before.left);
  assert.equal(writes.length,0);
 });
 await check('week and blank all-day column pan, bounds clamp naturally',async()=>{
  await selectPlanView(page,'周');
  await area.evaluate(el=>{el.scrollLeft=130;el.scrollTop=120;});await pan({touch:width<900});
  await area.evaluate(el=>{el.scrollLeft=0;el.scrollTop=40;});await pan({dx:-35,dy:-45,scope:'all',touch:true});
  await area.evaluate(el=>{el.scrollLeft=0;el.scrollTop=0;});await pan({dx:30,dy:30});assert.equal((await position()).left,0);assert.equal((await position()).top,0);
  await area.evaluate(el=>{el.scrollLeft=el.scrollWidth;el.scrollTop=el.scrollHeight;});await pan({dx:-30,dy:-30});const end=await position();assert.equal(end.left,end.maxLeft);assert.equal(end.top,end.maxTop);
 });
 await check('card drag keeps local preview; panning with pending preview makes no save request',async()=>{
  await selectPlanView(page,'两周');
  await dragCalendar(page,{id:'pan-0',targetDate:shift(2),time:'15:15',touch:width<900});
  const preview=page.locator('.calendar-chip[data-record-id=pan-0][data-pending=true]');await preview.waitFor();
  assert.equal(writes.length,0,'before pan: '+JSON.stringify(writes));
  await pan({touch:width<900,dx:-25,dy:-35});assert.equal(await preview.count(),1);assert.equal(writes.length,0,JSON.stringify(writes));
  await page.getByRole('button',{name:'取消',exact:true}).click();await page.locator('.calendar-chip[data-pending=true]').waitFor({state:'detached'});assert.equal(writes.length,0);
 });
 await check('date controls, escape cleanup, range switch and short viewport keep canvas usable',async()=>{
  await area.evaluate(el=>{el.scrollTop=0;el.scrollLeft=0;});
  await page.locator('.timeline-date').first().click();await page.locator('.calendar-focused-day').waitFor();await page.locator('.calendar-focused-day').getByRole('button',{name:'返回两周',exact:true}).click();
  const start=await blank();await page.mouse.move(start.x,start.y);await page.mouse.down();await page.mouse.move(start.x-20,start.y-20);await page.keyboard.press('Escape');const before=await position();await page.mouse.move(start.x-50,start.y-50);await page.mouse.up();assert.deepEqual(await position(),before);assert.equal(await area.getAttribute('data-panning'),null);
  await page.getByRole('button',{name:'下一段日期',exact:true}).click();assert.equal(await page.locator('.calendar-timeline-row').first().getAttribute('data-date'),shift(14));await page.getByRole('button',{name:'今天',exact:true}).click();
  await page.setViewportSize({width,height:560});await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(null)))));await area.evaluate(el=>{el.scrollLeft=el.scrollWidth;el.scrollTop=120;});await pan({touch:true,dx:35,dy:-45});
  const g=await page.evaluate(()=>({overflow:document.documentElement.scrollWidth>innerWidth,footer:document.querySelector('.workspace-footer').getBoundingClientRect().bottom,gap:document.querySelector('.workspace-footer').getBoundingClientRect().top-document.querySelector('.todo-panel').getBoundingClientRect().bottom}));assert(!g.overflow);assert(g.footer<=560);assert(Math.abs(g.gap-8)<1);
  if(!process.env.QA_FUNCTIONAL_ONLY)await page.screenshot({path:`${output}/${width}-${theme}-pan.png`});
 });
 await check('normal checkbox click and keyboard activation still work after panning',async()=>{
  await area.evaluate(el=>{el.scrollLeft=0;el.scrollTop=0;});
  const checkbox=page.getByRole('checkbox',{name:'完成：日程 0',exact:true});
  const clickRequest=page.waitForRequest(req=>new URL(req.url()).pathname==='/api/actions'&&req.method()==='POST');
  await checkbox.click();assert.equal((await clickRequest).postDataJSON().mode,'complete');await page.waitForTimeout(120);
  await checkbox.focus();const keyRequest=page.waitForRequest(req=>new URL(req.url()).pathname==='/api/actions'&&req.method()==='POST'),keyResponse=page.waitForResponse(res=>new URL(res.url()).pathname==='/api/actions'&&res.request().method()==='POST');
  await page.keyboard.press('Space');assert.equal((await keyRequest).postDataJSON().mode,'complete');await keyResponse;assert.equal(writes.length,2);
 });
 results.push({width,theme,checks,errors});await page.close();
}await writeFile(output+'/results.json',JSON.stringify(results,null,2));if(results.some(result=>result.errors.length||result.checks.some(check=>!check.passed)))process.exitCode=1;}finally{await browser.close();}
