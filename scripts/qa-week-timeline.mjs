import {chromium} from 'playwright-core';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {emptyDiary,todoSchema} from '../packages/contracts/dist/index.js';
import {dragCalendar} from './calendar-drag.mjs';
const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
const output='qa/week-timeline/'+(process.env.QA_FUNCTIONAL_ONLY?'functional':process.env.QA_CONFIRM?'confirmation':'initial');await mkdir(output,{recursive:true});
const results=[];
const date=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const shift=(date,n)=>{const d=new Date(date+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10);};
try{for(const width of [375,624,768,1280,1440])for(const theme of ['light','dark']){
 if(process.env.QA_WIDTH&&Number(process.env.QA_WIDTH)!==width||process.env.QA_THEME&&process.env.QA_THEME!==theme)continue;
 const page=await browser.newPage({viewport:{width,height:width===624?1195:900},hasTouch:width<900});page.setDefaultTimeout(6000);
 const monday=shift(date,-((new Date(date+'T00:00:00Z').getUTCDay()+6)%7));
 let rows=Array.from({length:14},(_,i)=>({date,version:'v0',task:todoSchema.parse({id:'axis-'+i,title:['项目评审','准备材料','回复客户','整理资料','每日阅读','预约体检','团队会议','月度复盘','采购物品','提交报告','散步','阅读与运动','浏览收藏','预约维修'][i],dueDate:i>=11?'':shift(monday,i<5?1:i===5?2:i===6?4:i===7?7:i===8?9:i===9?10:13),dueTime:i>=11||i===5?'':i<5?['10:00','10:00','10:15','10:30','11:00'][i]:i===6?'15:00':'20:00',startDate:date,startTime:'09:00',category:i%2?'personal':'work',important:i%4<2,urgent:i%2===0,...(i===0?{seriesId:'repeat',occurrenceDate:shift(monday,1)}:{})}),sourceExists:false,completionExists:false}));
 const original=structuredClone(rows),writes=[],errors=[],checks=[];let fail=false;
 page.on('pageerror',e=>errors.push(e.message));await page.addInitScript(t=>localStorage.setItem('diary.theme',t),theme);
 await page.route('**/api/**',async route=>{const req=route.request(),path=new URL(req.url()).pathname;let json={};
  if(path==='/api/auth/me')json={id:1,username:'本地演示'};
  else if(path.startsWith('/api/diaries/'))json={document:emptyDiary(path.split('/').pop()),version:'v0',exists:true};
  else if(path==='/api/actions'||path==='/api/schedule'){
   if(req.method()==='POST'){const input=req.postDataJSON();writes.push(input);if(fail)return route.fulfill({status:409,json:{error:'版本冲突',code:'VERSION_CONFLICT'}});rows=rows.map(row=>row.task.id===input.task.id?{...row,task:input.task}:row);json={diary:{document:{...emptyDiary(date),todos:rows.map(row=>row.task)},version:'v0',exists:true}};}
   else json={tasks:rows,records:[]};
  }else if(path==='/api/plan-categories')json={categories:[{id:'work',name:'工作',color:'#7bb4de',order:0},{id:'personal',name:'个人生活',color:'#c5a27e',order:1}]};
  else if(path==='/api/entities')json={entities:[]};else if(path==='/api/tags')json={tags:{person:[],place:[],activity:[],food:[],thing:[]}};
  else if(path==='/api/weeks')json={start:date,end:date,entries:[]};else if(path==='/api/plan-views')json={views:[]};else if(path==='/api/quick-facts')json={facts:[]};else if(path==='/api/tag-library')json={tags:[]};
  await route.fulfill({json});
 });
 const check=async(name,fn)=>{try{await fn();checks.push({name,passed:true});console.log(width,theme,'PASS',name);}catch(e){checks.push({name,passed:false,error:e.stack});console.log(width,theme,'FAIL',name,e.message);await page.mouse.up();await page.keyboard.press('Escape');}};
 const shot=async name=>{if(!process.env.QA_FUNCTIONAL_ONLY)await page.screenshot({path:`${output}/${width}-${theme}-${name}.png`});};
 const views=page.getByRole('navigation',{name:'计划视图'}),area=page.locator('.calendar-scroll');
 const choose=async name=>{await views.getByRole('button',{name,exact:true}).click();await page.waitForTimeout(80);};
 await page.goto('http://127.0.0.1:4320');await page.locator('.timeline-timed-cell [data-record-id=axis-0]').waitFor();
 let geometry;
 await check('continuous date rows, one shared axis, compact empty days and exact dense anchors',async()=>{
  assert.equal(await page.locator('.calendar-timeline-row').count(),14);assert.equal(await page.locator('.timeline-hour-axis').count(),1);
  assert.deepEqual(await page.locator('.timeline-hour-axis>span').allTextContents(),['10:00','11:00','15:00','20:00']);
  assert.equal(await page.locator('.timeline-all-heading').count(),1);assert.equal(await page.locator('.timeline-date').first().getAttribute('data-calendar-date'),monday);
  assert((await page.locator('.calendar-timeline-row').first().boundingBox()).height<=64);
  const cards=await page.locator(`.timeline-timed-cell[data-calendar-date="${shift(monday,1)}"] .calendar-chip`).evaluateAll(es=>es.map(e=>({id:e.dataset.recordId,left:parseFloat(e.style.left),top:parseFloat(e.style.top),width:e.offsetWidth,height:e.offsetHeight})));
  assert.equal(cards.find(c=>c.id==='axis-2').left,40);assert.equal(cards.find(c=>c.id==='axis-4').left,160);
  for(let i=0;i<cards.length;i++)for(let j=i+1;j<cards.length;j++)assert(cards[i].left+cards[i].width<=cards[j].left||cards[j].left+cards[j].width<=cards[i].left||cards[i].top+cards[i].height<=cards[j].top||cards[j].top+cards[j].height<=cards[i].top);
  geometry=await page.evaluate(()=>{const a=document.querySelector('.calendar-scroll').getBoundingClientRect(),p=document.querySelector('.todo-panel').getBoundingClientRect(),f=document.querySelector('.workspace-footer').getBoundingClientRect();return {calendarTop:a.top,calendarHeight:a.height,footerGap:f.top-p.bottom,overflow:document.documentElement.scrollWidth>innerWidth};});assert(!geometry.overflow);if(width===375)assert((await page.locator('.timeline-timed-cell').first().boundingBox()).x+148<=(await area.boundingBox()).x+(await area.boundingBox()).width+1);assert(Math.abs(geometry.footerGap-8)<1);assert(geometry.calendarTop<=(width<900?190:96));await shot('fortnight');
 });
 await check('fixed date and hour headings; unscheduled collapsed, 24px separation and horizontal independence',async()=>{
  await area.evaluate(el=>{el.scrollLeft=210;el.scrollTop=200;});const a=await area.boundingBox(),h=await page.locator('.calendar-timeline-heading').boundingBox(),d=await page.locator('.timeline-date').nth(3).boundingBox();assert(Math.abs(h.y-a.y)<2);assert(Math.abs(d.x-a.x)<2);
  const summary=page.locator('.calendar-unarranged summary');await summary.scrollIntoViewIfNeeded();assert.equal(await page.locator('.calendar-unarranged').getAttribute('open'),null);assert.equal(await summary.innerText(),'未安排 · 3项');
  const gap=await page.evaluate(()=>document.querySelector('.calendar-unarranged').getBoundingClientRect().top-Array.from(document.querySelectorAll('.calendar-timeline-row')).at(-1).getBoundingClientRect().bottom);assert(Math.abs(gap-24)<1);
  const x=(await summary.boundingBox()).x;await area.evaluate(el=>el.scrollLeft=400);assert(Math.abs((await summary.boundingBox()).x-x)<1);await shot('unarranged-collapsed');
  await summary.click();assert.equal(await page.locator('.calendar-unarranged .calendar-chip').count(),3);await shot('unarranged-expanded');
 });
 await check('unscheduled preview enters date, counts update and cancel restores without writes',async()=>{
  await dragCalendar(page,{id:'axis-11',targetDate:shift(monday,3),time:'15:15',touch:width<900});
  const pending=page.locator(`.timeline-timed-cell[data-calendar-date="${shift(monday,3)}"] [data-record-id=axis-11][data-pending=true]`);await pending.waitFor();assert((await pending.innerText()).includes('15:15'));assert.equal(await page.locator('.calendar-unarranged summary').innerText(),'未安排 · 2项');assert.equal(writes.length,0);
  await page.keyboard.press('Escape');assert.equal(await page.locator('.calendar-unarranged summary').innerText(),'未安排 · 3项');assert.equal(await page.locator('.calendar-chip[data-pending=true]').count(),0);
 });
 await check('cross-date multi-preview freezes row sizes and hours; repeated adjustment and conflict rollback',async()=>{
  const heights=await page.locator('.calendar-timeline-row').evaluateAll(es=>es.map(e=>e.offsetHeight)),hours=await page.locator('.timeline-hour-axis').innerText();
  await dragCalendar(page,{id:'axis-0',targetDate:shift(monday,8),time:'15:15',touch:width<900});await dragCalendar(page,{id:'axis-1',targetDate:shift(monday,8),time:'15:15',touch:width<900});
  assert.deepEqual(await page.locator('.calendar-timeline-row').evaluateAll(es=>es.map(e=>e.offsetHeight)),heights);assert.equal(await page.locator('.timeline-hour-axis').innerText(),hours);assert.equal(await page.locator('.calendar-chip[data-pending=true]').count(),2);assert.equal(writes.length,0);
  await dragCalendar(page,{id:'axis-0',targetDate:shift(monday,10),time:'20:30',touch:width<900});assert.equal(await page.locator('.calendar-chip[data-pending=true]').count(),2);const dateBox=await page.locator(`.timeline-date[data-calendar-date="${shift(monday,8)}"]`).boundingBox();assert.equal(await page.evaluate(({x,y})=>document.elementFromPoint(x,y)?.closest('.timeline-date')!==null,{x:dateBox.x+dateBox.width/2,y:dateBox.y+dateBox.height/2}),true,'fixed date stays above pending cards');await shot('pending');
  fail=true;await page.getByRole('button',{name:'确认改期（2项）',exact:true}).click();await page.getByRole('button',{name:'确认改期',exact:true}).waitFor();assert.equal(writes.length,1);assert.equal(await page.locator(`.timeline-timed-cell[data-calendar-date="${shift(monday,1)}"] [data-record-id=axis-0]`).count(),1);assert.equal(await page.locator('.calendar-chip[data-pending=true]').count(),1);await page.keyboard.press('Escape');fail=false;
 });
 await check('week has seven rows; date targets set all-day and ranges cancel previews',async()=>{
  await choose('周');assert.equal(await page.locator('.calendar-timeline-row').count(),7);await area.evaluate(el=>{el.scrollTop=0;el.scrollLeft=0;});await shot('week');
  await dragCalendar(page,{id:'axis-0',targetDate:shift(monday,4),touch:width<900});await page.locator(`.timeline-all-day[data-calendar-date="${shift(monday,4)}"] [data-record-id=axis-0][data-pending=true]`).waitFor();const n=writes.length;await page.getByRole('button',{name:'下一期',exact:true}).click();assert.equal(await page.locator('.calendar-chip[data-pending=true]').count(),0);assert.equal(writes.length,n);await page.getByRole('button',{name:'今天',exact:true}).click();
 });
 await check('empty all-day column omitted; zero unscheduled section hidden; short viewport and full screen',async()=>{
  rows=rows.filter(row=>row.task.dueTime);await page.reload();await page.locator('.timeline-timed-cell [data-record-id=axis-0]').waitFor();assert.equal(await page.locator('.timeline-all-heading').count(),0);assert.equal(await page.locator('.calendar-unarranged').count(),0);
  await page.setViewportSize({width,height:560});await page.waitForTimeout(80);await page.locator('.timeline-date').last().scrollIntoViewIfNeeded();assert((await area.boundingBox()).height>150);assert.equal(await page.locator('.workspace-footer').evaluate(el=>el.getBoundingClientRect().bottom<=innerHeight),true);await shot('short');
  await page.getByRole('button',{name:'全屏显示',exact:true}).click();await page.getByRole('button',{name:'退出全屏',exact:true}).click();assert.equal(await views.getByRole('button',{name:'两周',exact:true}).getAttribute('aria-pressed'),'true');
 });
 await check('month layout retained and diary uses compact toolbar',async()=>{
  await page.setViewportSize({width,height:900});await choose('月');assert.equal(await page.locator('.calendar-month .calendar-day').count(),42);assert.equal(await page.locator('.calendar-timeline-row').count(),0);await page.getByRole('button',{name:'日记',exact:true}).click();await page.locator('.diary-main-toolbar').waitFor();assert.equal(await page.locator('.diary-panel-heading:visible,.mobile-workspace-switch:visible').count(),0);assert((await page.locator('.workspace-panel[data-active=true] .diary-panel-body').boundingBox()).y<=(width<900?150:96));
 });
 await check('cross-year complete dates, empty range and keyboard date expansion',async()=>{
  await page.clock.install({time:new Date('2026-12-30T04:00:00Z')});
  rows=original.map(row=>({...row,task:{...row.task,dueDate:row.task.dueDate?shift('2026-12-28',Math.round((new Date(row.task.dueDate+'T00:00:00Z')-new Date(monday+'T00:00:00Z'))/86400000)):''}}));
  await page.goto('http://127.0.0.1:4320');await page.locator('.calendar-timeline-row[data-date="2027-01-10"]').waitFor();assert.equal(await page.locator('.calendar-timeline-row').count(),14);const newYear=page.locator('.timeline-date[data-calendar-date="2027-01-01"]');assert((await newYear.innerText()).includes('2027'));await newYear.scrollIntoViewIfNeeded();await shot('cross-year');
  rows=[];await page.reload();await page.locator('.timeline-no-hours').waitFor();assert.equal(await page.locator('.calendar-timeline-row').count(),14);assert.equal(await page.locator('.calendar-unarranged,.timeline-all-heading').count(),0);const heights=await page.locator('.calendar-timeline-row').evaluateAll(es=>es.map(el=>el.offsetHeight));assert(heights.every(height=>height<=64));
  const day=page.locator('.timeline-date').first();await day.focus();await page.keyboard.press('Enter');await page.locator('.calendar-selected-day').waitFor();assert.equal(await day.getAttribute('aria-expanded'),'true');await page.locator('.calendar-selected-day').getByRole('button',{name:'收起',exact:true}).click();
 });
 results.push({width,theme,geometry,checks,errors});await page.close();
}await writeFile(output+'/results.json',JSON.stringify(results,null,2));if(results.some(r=>r.errors.length||r.checks.some(c=>!c.passed)))process.exitCode=1;}finally{await browser.close();}
