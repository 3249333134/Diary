import {chromium} from 'playwright-core';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {emptyDiary,todoSchema} from '../packages/contracts/dist/index.js';
import {dragCalendar} from './calendar-drag.mjs';

const date='2026-10-25',target='2026-10-26',later='2026-10-27';
const output='qa/month-overview/'+(process.env.QA_CONFIRM?'confirmation':process.env.QA_FUNCTIONAL_ONLY?'functional':'initial');await mkdir(output,{recursive:true});
const makeRow=(id,title,time='',extra={})=>({date,version:'v0',sourceExists:false,completionExists:false,...extra,task:todoSchema.parse({id,title,dueDate:date,dueTime:time,startDate:date,startTime:'08:00',category:'work',important:true,urgent:false,...extra.task})});
const fixture=()=>[
 makeRow('p0','每周项目复盘与下周安排','15:00',{task:{seriesId:'series-0',occurrenceDate:date}}),
 makeRow('p1','整理个人资料','09:15'),makeRow('p2','准备会议材料','09:15',{task:{important:true,urgent:true}}),
 makeRow('all','预约年度体检并确认出行安排','',{task:{important:true,urgent:true}}),
 makeRow('shared','一起阅读与复盘','20:00',{windowId:'shared',windowName:'周末共同安排',role:'editor'}),
 makeRow('viewer','家人共享的只读安排','18:00',{windowId:'viewer',windowName:'家人安排',role:'viewer',readOnly:true}),
 makeRow('done','已经完成的安排','17:00',{task:{done:true,status:'done',important:false,urgent:false}}),
 makeRow('cancelled','已取消的安排','17:30',{task:{status:'cancelled',important:null,urgent:null}}),
 makeRow('long','整理本周所有项目资料，并与伙伴确认下一阶段的交付时间和需要补齐的细节','16:00',{task:{important:false,urgent:true}}),
 ...Array.from({length:5},(_,i)=>makeRow('dense-'+i,'同一时刻的日程 '+(i+1),'20:00')),
 makeRow('inbox','待安排：阅读与运动','',{task:{dueDate:'',important:false,urgent:true}}),
 makeRow('next','明天的个人安排','11:00',{task:{dueDate:target}}),
];
const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});const results=[];
try{for(const width of [375,624,768,1280,1440])for(const theme of ['light','dark']){
 if(process.env.QA_WIDTHS&&!process.env.QA_WIDTHS.split(',').includes(String(width)))continue;
 const page=await browser.newPage({viewport:{width,height:900},hasTouch:width<900});page.setDefaultTimeout(7000);await page.clock.install({time:new Date(date+'T04:00:00Z')});
 let rows=fixture(),version=0,failId='',failStatus=409,refreshFails=false;const writes=[],errors=[],checks=[];
 page.on('pageerror',e=>errors.push(e.message));await page.addInitScript(theme=>localStorage.setItem('diary.theme',theme),theme);
 await page.route('**/api/**',async route=>{
  const req=route.request(),path=new URL(req.url()).pathname;let json={};
  const privateRows=()=>rows.filter(r=>!r.windowId).map(r=>({...r,version:'v'+version}));
  const document=()=>({...emptyDiary(date),todos:privateRows().map(r=>r.task)});
  if(path==='/api/auth/me')json={id:1,username:'本地演示'};
  else if(path==='/api/social')json={profile:{code:'DEMO-CODE',name:'本地演示'},friends:[],requests:[],invitations:[],notices:[],cursor:0,windows:[{id:'shared',name:'周末共同安排',color:'#7856bd',role:'editor',members:[]},{id:'viewer',name:'家人安排',color:'#7856bd',role:'viewer',members:[]}]};
  else if(path==='/api/social/events')return route.abort();
  else if(path.startsWith('/api/diaries/'))json={document:document(),version:'v'+version,exists:true};
  else if(path==='/api/actions'&&req.method()==='POST'){
   const input=req.postDataJSON();writes.push(input);await new Promise(r=>setTimeout(r,100));
   if(input.task.id===failId)return route.fulfill({status:failStatus,json:{error:failStatus===409?'版本冲突，请重试':'字段校验失败',code:failStatus===409?'VERSION_CONFLICT':'VALIDATION_ERROR'}});
   if(input.version!=='v'+version)return route.fulfill({status:409,json:{error:'版本冲突',code:'VERSION_CONFLICT'}});
   rows=rows.map(r=>r.task.id===input.task.id?{...r,task:input.mode==='complete'?{...input.task,done:true,status:'done'}:input.task}:r);version++;
   json={diary:{document:document(),version:'v'+version,exists:true}};
  }else if(path==='/api/actions'){if(refreshFails)return route.fulfill({status:503,json:{error:'刷新失败'}});json={tasks:privateRows(),records:[]};}
  else if(path==='/api/schedule')json={tasks:privateRows()};
  else if(path==='/api/shared-tasks')json={tasks:rows.filter(r=>r.windowId)};
  else if(path==='/api/plan-categories')json={categories:[{id:'work',name:'工作',color:'#7bb4de',order:0},{id:'personal',name:'个人生活',color:'#c5a27e',order:1}]};
  else if(path==='/api/entities')json={entities:[]};else if(path==='/api/tags')json={tags:{person:[],place:[],activity:[],food:[],thing:[]}};
  else if(path==='/api/weeks')json={start:date,end:date,entries:[]};else if(path==='/api/plan-views')json={views:[]};else if(path==='/api/quick-facts')json={facts:[]};else if(path==='/api/tag-library')json={tags:[]};
  await route.fulfill({json});
 });
 const view=name=>page.getByRole('navigation',{name:'计划视图'}).getByRole('button',{name,exact:true});
 const cell=day=>page.locator(`.calendar-day[data-calendar-date="${day}"]`),select=day=>cell(day).locator('.calendar-date').click();
 const reset=async()=>{rows=fixture();version=0;failId='';refreshFails=false;writes.length=0;await page.goto('http://127.0.0.1:4320/');await view('月').click();await page.locator('.todo-panel[aria-busy=false]').waitFor();await page.locator('.calendar-day-agenda h3').waitFor();};
 const check=async(name,fn)=>{if(process.env.QA_CHECK&&!name.includes(process.env.QA_CHECK))return;await fn();checks.push(name);console.log(width,theme,'PASS',name);};
 const shot=async name=>{if(!process.env.QA_FUNCTIONAL_ONLY){await page.mouse.move(1,1);await page.screenshot({path:`${output}/${width}-${theme}-${name}.png`});}};
 const drag=(id,to,from=date,invalid=false)=>dragCalendar(page,{id,targetDate:to,sourceDate:from,month:true,touch:width<900,invalid});
 try{
 await reset();
 await check('fixed month overview, responsive panes, no clipped controls',async()=>{
  assert.equal(await page.locator('.calendar-day').count(),35);assert.equal(await page.locator('.calendar-month .calendar-chip').count(),0);assert.equal(await page.locator('.calendar-weekday').count(),7);
  const sizes=await page.locator('.calendar-day').evaluateAll(es=>es.map(e=>e.getBoundingClientRect().height));assert(sizes.every(h=>h===52));
  const geometry=await page.locator('.calendar-scroll').evaluate(el=>{const layout=el.querySelector('.calendar-month-layout'),a=el.querySelector('.calendar-month-overview').getBoundingClientRect(),b=el.querySelector('.calendar-month-day-pane').getBoundingClientRect();return {width:el.clientWidth,split:layout.dataset.monthSplit==='true',left:a.width,dayX:b.x,monthX:a.x,dayY:b.y,monthBottom:a.bottom};});
  assert.equal(geometry.split,geometry.width>=900);if(geometry.split){assert.equal(geometry.left,336);assert(geometry.dayX>geometry.monthX);}else assert(geometry.dayY>=geometry.monthBottom+23);
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.equal(await cell(date).getAttribute('aria-selected'),'true');assert.equal(await cell(date).locator('.calendar-date').getAttribute('aria-current'),'date');
  assert.equal(await cell(date).locator('.month-day-marks svg').count(),1);assert.equal(await cell(date).locator('.month-day-marks i').count(),5);
 });await shot('overview');
 await check('full agenda grouped all-day then exact time, shared and read-only controls',async()=>{
  const groups=await page.locator('.month-agenda-group h4').allTextContents();assert.equal(groups[0],'全天');assert(groups.indexOf('09:15截止')<groups.indexOf('15:00截止'));
  assert.deepEqual(await page.locator('.month-agenda-group[aria-label="截止 09:15"] .calendar-chip').evaluateAll(es=>es.map(e=>e.dataset.recordId)),['p1','p2']);
  assert((await page.locator('[data-record-id=shared] .shared-plan-badge').innerText()).includes('周末共同安排'));
  assert(await page.locator('[data-record-id=viewer] .calendar-chip-drag').isDisabled());assert(await page.locator('[data-record-id=viewer] input').isDisabled());assert(await page.locator('[data-record-id=done] .calendar-chip-drag').isDisabled());assert(await page.locator('[data-record-id=cancelled] .calendar-chip-drag').isDisabled());
  assert.equal(await page.locator('.calendar-month-unarranged').getAttribute('open'),null);assert.equal(await page.locator('.calendar-month-unarranged').evaluate(e=>getComputedStyle(e).marginTop),'24px');
  await page.locator('[data-record-id=long]').scrollIntoViewIfNeeded();assert((await page.locator('[data-record-id=long] strong').boundingBox()).height>20);await page.locator('[data-record-id=shared]').scrollIntoViewIfNeeded();const sharedBox=await page.locator('[data-record-id=shared]').boundingBox(),footerBox=await page.locator('.workspace-footer').boundingBox();assert(sharedBox.y+sharedBox.height<footerBox.y);assert(await page.locator('.calendar-scroll').evaluate(el=>el.scrollTop>0||el.querySelector('.calendar-month-day-pane').scrollTop>0));
 });await shot('agenda');
 await check('selection, adjacent date, keyboard and month memory',async()=>{
  await select(target);await select(target);assert((await page.locator('.calendar-day-agenda h3').innerText()).startsWith(target));
  await cell(target).locator('.calendar-date').focus();await page.keyboard.press('ArrowRight');await page.keyboard.press('Space');assert((await page.locator('.calendar-day-agenda h3').innerText()).startsWith(later));
  await page.keyboard.press('Home');await page.keyboard.press('Enter');assert.equal(await page.evaluate(()=>document.activeElement.closest('.calendar-day').dataset.calendarDate),target);
  await select('2026-11-01');assert((await page.locator('.plan-date-range').innerText()).includes('2026-10'));assert((await page.locator('.calendar-day-agenda h3').innerText()).startsWith('2026-11-01'));
  await select(target);await view('列表').click();await view('月').click();assert((await page.locator('.calendar-day-agenda h3').innerText()).startsWith(target));
  await page.getByRole('button',{name:'下一期',exact:true}).click();assert((await page.locator('.calendar-day-agenda h3').innerText()).startsWith('2026-11-01'));await page.getByRole('button',{name:'上一期',exact:true}).click();assert((await page.locator('.calendar-day-agenda h3').innerText()).startsWith(target));
  await page.getByRole('button',{name:'今天',exact:true}).click();assert((await page.locator('.calendar-day-agenda h3').innerText()).startsWith(date));assert.equal(writes.length,0);
 });
 await check('short viewport, fullscreen, empty date and single bottom navigation',async()=>{
  await select('2026-10-23');assert(await page.locator('.calendar-day-agenda-empty').isVisible());await page.setViewportSize({width,height:560});await page.locator('.calendar-day-agenda').scrollIntoViewIfNeeded();const footer=await page.locator('.workspace-footer').boundingBox();assert(footer.y+footer.height<=561);
  await page.getByRole('button',{name:'全屏显示',exact:true}).click();await page.getByRole('button',{name:'退出全屏',exact:true}).click();assert.equal(await page.getByRole('navigation',{name:'主导航'}).count(),1);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.setViewportSize({width,height:900});await select(date);
 });
 if((width===375||width===1440)&&theme==='light'&&process.env.QA_SCREENS_ONLY){
  await check('four/six week and year-boundary overview',async()=>{
   const nav=async(direction,month)=>{await page.getByRole('button',{name:direction,exact:true}).click();await page.waitForFunction(month=>document.querySelector('.plan-date-range')?.textContent===month,month);await page.locator('.todo-panel[aria-busy=false]').waitFor();};
   await nav('上一期','2026-09');await nav('上一期','2026-08');assert.equal(await page.locator('.calendar-day').count(),42);await shot('six-weeks');
   for(const month of ['2026-09','2026-10','2026-11','2026-12','2027-01','2027-02'])await nav('下一期',month);assert.equal(await page.locator('.calendar-day').count(),28);await shot('four-weeks');
   await nav('上一期','2027-01');await nav('上一期','2026-12');assert.equal(await cell('2027-01-03').count(),1);await shot('year-boundary');await page.getByRole('button',{name:'今天',exact:true}).click();
  });
 }
 if((width===375||width===1440)&&theme==='light'&&!process.env.QA_SCREENS_ONLY){
  await check('edge scrolling keeps month drag reachable without committing',async()=>{
   await select(date);const handle=page.locator('[data-record-id=shared] .calendar-chip-drag');await handle.scrollIntoViewIfNeeded();const pane=page.locator(width===375?'.calendar-scroll':'.calendar-month-day-pane'),before=await pane.evaluate(el=>el.scrollTop),b=await pane.boundingBox(),a=await handle.boundingBox(),start={x:a.x+a.width/2,y:a.y+a.height/2},edge={x:start.x,y:b.y+4};assert(before>0);
   const cdp=width===375?await page.context().newCDPSession(page):undefined;
   try{if(cdp){await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[start]});await page.waitForTimeout(380);}else{await page.mouse.move(start.x,start.y);await page.mouse.down();await page.mouse.move(start.x-8,start.y);}await page.locator('.calendar-drag-ghost').waitFor();if(cdp)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[edge]});else await page.mouse.move(edge.x,edge.y);await page.waitForTimeout(300);assert((await pane.evaluate(el=>el.scrollTop))<before);if(cdp)await cdp.send('Input.dispatchTouchEvent',{type:'touchCancel',touchPoints:[]});else{await page.keyboard.press('Escape');await page.mouse.up();}}finally{if(cdp)await cdp.detach();}assert.equal(writes.length,0);await page.keyboard.press('Escape');
  });
  await check('multi-drag changes counts immediately, keeps time and cancels without writes',async()=>{
   await drag('p0',target);assert.equal(await cell(target).getAttribute('data-pending'),'true');assert((await cell(date).locator('.calendar-date').getAttribute('aria-label')).includes('13 项'));assert.equal(writes.length,0);
   await drag('p1',later);await page.getByRole('button',{name:'确认改期（2项）',exact:true}).waitFor();assert.equal(writes.length,0);assert((await page.locator('[data-record-id=p1] .calendar-chip-copy').innerText()).includes('09:15'));
   await drag('p0',later,target);await page.getByRole('button',{name:'确认改期（2项）',exact:true}).waitFor();await drag('p0',date,later);await page.getByRole('button',{name:'确认改期',exact:true}).waitFor();
   await page.keyboard.press('Escape');assert.equal(await page.locator('.calendar-day[data-pending=true]').count(),0);assert.equal(writes.length,0);await select(date);
   await drag('p0',target,date,true);assert.equal(await page.locator('.calendar-day[data-pending=true]').count(),0);assert.equal(writes.length,0);
  });
  await check('unarranged long-press, shared preview markers and range cancellation',async()=>{
   await page.locator('.calendar-month-unarranged summary').click();await drag('inbox',target,'2026-10-23');assert.equal(await page.locator('.calendar-month-unarranged').count(),0);
   await page.keyboard.press('Escape');await select(date);await drag('shared',target);assert.equal(await cell(target).locator('.month-day-marks svg').count(),1);await page.getByRole('button',{name:'下一期',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.plan-date-range')?.textContent==='2026-11'&&!document.querySelector('.calendar-day[data-pending=true]'));assert.equal(await page.locator('.calendar-day[data-pending=true]').count(),0);assert.equal(writes.length,0);await page.getByRole('button',{name:'今天',exact:true}).click();
  });
  await reset();
  await check('one confirmation saves once and preserves occurrence/start fields',async()=>{
   await drag('p0',target);await drag('p1',target);const confirm=page.getByRole('button',{name:'确认改期（2项）',exact:true});await confirm.evaluate(b=>{b.click();b.click();});await page.locator('.calendar-drop-review').waitFor({state:'hidden'});assert.equal(writes.length,2);assert.deepEqual(writes.map(w=>w.version),['v0','v1']);assert.equal(rows.find(r=>r.task.id==='p0').task.startTime,'08:00');assert.equal(rows.find(r=>r.task.id==='p0').task.occurrenceDate,date);assert.equal(rows.find(r=>r.task.id==='p1').task.dueTime,'09:15');
   await page.reload();await view('月').click();await select(target);assert.equal(await page.locator('.calendar-day-agenda [data-record-id=p0]').count(),1);
  });
  for(const status of [400,409]){await reset();await check(status+' write failure restores saved date',async()=>{await drag('p0',target);failId='p0';failStatus=status;await page.getByRole('button',{name:'确认改期',exact:true}).click();await page.locator('.calendar-drop-review').waitFor({state:'hidden'});assert.equal(rows.find(r=>r.task.id==='p0').task.dueDate,date);assert.equal(await page.locator('.calendar-day[data-pending=true]').count(),0);assert((await page.locator('.calendar-batch-message').innerText()).includes('已还原'));});}
  await reset();await check('partial failure keeps committed item and remaining previews',async()=>{await drag('p0',target);await drag('p1',target);await drag('p2',later);failId='p1';failStatus=409;await page.getByRole('button',{name:'确认改期（3项）',exact:true}).click();await page.getByRole('button',{name:'确认改期',exact:true}).waitFor();assert.equal(writes.length,2);assert.equal(rows.find(r=>r.task.id==='p0').task.dueDate,target);assert.equal(rows.find(r=>r.task.id==='p1').task.dueDate,date);failId='';await page.getByRole('button',{name:'确认改期',exact:true}).click();await page.locator('.calendar-drop-review').waitFor({state:'hidden'});assert.equal(rows.find(r=>r.task.id==='p2').task.dueDate,later);});
  await reset();await check('refresh failure after successful save does not roll back',async()=>{await drag('p0',target);refreshFails=true;await page.getByRole('button',{name:'确认改期',exact:true}).click();await page.locator('.calendar-drop-review').waitFor({state:'hidden'});assert.equal(rows.find(r=>r.task.id==='p0').task.dueDate,target);assert.equal(await page.locator('.calendar-day-agenda [data-record-id=p0]').count(),1);await page.getByRole('button',{name:'重试刷新',exact:true}).waitFor();});
  await reset();await check('completion, editing, filters and other calendar views still work',async()=>{await page.locator('[data-record-id=p1] .calendar-chip-copy').click();await page.locator('.plan-task-dialog').waitFor();await page.locator('.plan-task-dialog .plan-action-dock').getByRole('button',{name:'取消',exact:true}).click();await page.locator('[data-record-id=p1] input').click();await page.waitForFunction(()=>document.querySelector('[data-record-id=p1] input')?.checked);assert.equal(await page.locator('[data-record-id=p1] input').isChecked(),true);assert.equal(writes.length,1);await view('两周').click();assert.equal(await page.locator('.calendar-timeline-row').count(),14);await view('周').click();assert.equal(await page.locator('.calendar-timeline-row').count(),7);await page.getByRole('navigation',{name:'主导航'}).getByRole('button',{name:'日记',exact:true}).click();await page.getByRole('navigation',{name:'主导航'}).getByRole('button',{name:'日程',exact:true}).click();});
 }
 assert.deepEqual(errors,[]);results.push({width,theme,checks,errors,writes:writes.length});
 }catch(e){results.push({width,theme,checks,errors,error:e.stack});throw e;}finally{await page.close();}
}}finally{await browser.close();await writeFile(output+'/results.json',JSON.stringify(results,null,2));}
