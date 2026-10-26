import {dragCalendar} from './calendar-drag.mjs';
import {chromium} from 'playwright-core';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {emptyDiary,todoSchema} from '../packages/contracts/dist/index.js';
const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
const date='2026-10-20';
const shift=(date,n)=>{const d=new Date(date+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10);};
let next=shift(date,1),later=shift(date,2);const names=['计划甲','计划乙','计划丙'];
const fixture=()=>Array.from({length:9},(_,i)=>({date,version:'v0',task:todoSchema.parse({id:'batch-'+i,title:names[i]||'其他日程 '+i,dueDate:i>3?next:date,dueTime:['10:00','14:00','17:00','15:00','10:00','14:00','17:00','18:00',''][i],startDate:date,startTime:'09:00',category:i===2?null:i===6?'cat-00000000-0000-0000-0000-000000000000':i%2?'personal':'work',important:i===8?null:i%4<2,urgent:i===8?null:i%2===0,...(i<3?{seriesId:'series-'+i,occurrenceDate:date}:{}),...(i===3?{done:true,status:'done'}:{})}),sourceExists:false,completionExists:false}));
await mkdir('qa/fortnight',{recursive:true});const results=[];
try{for(const width of [375,624,768,1440])for(const theme of ['light','dark']){
 if(process.env.QA_WIDTH&&Number(process.env.QA_WIDTH)!==width||process.env.QA_THEME&&process.env.QA_THEME!==theme)continue;
 if(process.env.QA_WIDTHS&&!process.env.QA_WIDTHS.split(',').includes(String(width)))continue;
 const page=await browser.newPage({viewport:{width,height:width===624?1195:900},hasTouch:width<900});page.setDefaultTimeout(8000);await page.clock.install({time:new Date(date+'T04:00:00Z')});
 let rows=fixture(),version=0,failId='',refreshFails=false,externalAfterFirst=false;const writes=[],checks=[],errors=[],locations=new Map();
 page.on('pageerror',e=>errors.push(e.message));await page.addInitScript(theme=>localStorage.setItem('diary.theme',theme),theme);
 await page.route('**/api/**',async route=>{
  const req=route.request(),path=new URL(req.url()).pathname;let json={};
  if(path==='/api/auth/me')json={id:1,username:'本地演示'};
  else if(path.startsWith('/api/diaries/'))json={document:{...emptyDiary(date),todos:rows.map(r=>r.task)},version:'v'+version,exists:true};
  else if(path==='/api/actions'){
   if(req.method()==='POST'){
    const input=req.postDataJSON();writes.push(input);await new Promise(resolve=>setTimeout(resolve,160));
    if(input.task.id===failId)return route.fulfill({status:409,json:{error:'版本冲突，请重试',code:'VERSION_CONFLICT'}});
    if(input.version!=='v'+version)return route.fulfill({status:409,json:{error:'请求使用了旧版本',code:'VERSION_CONFLICT'}});
    rows=rows.map(r=>r.task.id===input.task.id?{...r,task:input.task,version:'v'+(version+1)}:r);version++;
    json={diary:{document:{...emptyDiary(date),todos:rows.map(r=>r.task)},version:'v'+version,exists:true}};
    if(externalAfterFirst&&input.task.id==='batch-0'){rows=rows.map(row=>row.task.id==='batch-1'?{...row,task:{...row.task,title:'云端改名'}}:row);version++;}
   }else{if(refreshFails)return route.fulfill({status:503,json:{error:'刷新失败'}});json={tasks:rows.map(row=>({...row,version:'v'+version})),records:[]};}
  }else if(path==='/api/schedule')json={tasks:rows.map(row=>({...row,version:'v'+version}))};
  else if(path==='/api/plan-categories')json={categories:[{id:'work',name:'工作',color:'#7bb4de',order:0},{id:'personal',name:'个人生活',color:'#c5a27e',order:1},{id:'cat-00000000-0000-0000-0000-000000000000',name:'学习与个人长期项目',color:'#198276',order:2}]};
  else if(path==='/api/entities')json={entities:[]};else if(path==='/api/tags')json={tags:{person:[],place:[],activity:[],food:[],thing:[]}};
  else if(path==='/api/weeks')json={start:date,end:date,entries:[]};else if(path==='/api/plan-views')json={views:[]};else if(path==='/api/quick-facts')json={facts:[]};else if(path==='/api/tag-library')json={tags:[]};
  await route.fulfill({json});
 });
 const check=async(name,fn)=>{if(process.env.QA_FORM_ONLY&&!name.startsWith('direct single'))return;if(process.env.QA_PARTIAL_ONLY&&!name.startsWith('partial conflict'))return;try{await fn();checks.push({name,passed:true});console.log(width,theme,'PASS',name);}catch(e){checks.push({name,passed:false,error:e.stack});console.log(width,theme,'FAIL',name,e.message);await page.mouse.up();await page.keyboard.press('Escape');}};
 const view=page.getByRole('navigation',{name:'计划视图'});
 async function reset(mode){next=shift(date,mode==='fortnight'?7:1);later=shift(date,mode==='fortnight'?8:2);rows=fixture();version=0;failId='';refreshFails=false;externalAfterFirst=false;writes.length=0;locations.clear();await page.goto('http://127.0.0.1:4320');await page.getByRole('navigation',{name:'主导航'}).getByRole('button',{name:'日程',exact:true}).click();await view.getByRole('button',{name:mode==='fortnight'?'两周':mode!=='month'?'周':'月',exact:true})[width<900?'tap':'click']();await page.locator('.calendar-scroll').waitFor();await page.waitForTimeout(120);}
 async function drag(id,targetDate,time,mode,invalid=false){
  const sourceDate=locations.get(id)?.date||rows.find(r=>r.task.id===id).task.dueDate;
  await dragCalendar(page,{id,title:names[Number(id.slice(-1))],targetDate,time,month:mode==='month',touch:width<900,invalid,sourceDate});
  if(invalid||targetDate===rows.find(r=>r.task.id===id).task.dueDate&&(mode==='month'||time===rows.find(r=>r.task.id===id).task.dueTime))locations.delete(id);else locations.set(id,{date:targetDate,time});
  await page.waitForTimeout(80);
 }
 const pendingIds=async()=>{if(!await page.locator('.calendar-month-layout').count())return page.locator('.calendar-timeline-canvas .calendar-chip[data-pending=true]').evaluateAll(es=>es.map(e=>e.dataset.recordId).sort());const dates=await page.locator('.calendar-day[data-pending=true]').evaluateAll(es=>es.map(e=>e.dataset.calendarDate)),ids=[];for(const date of dates){await page.locator(`.calendar-day[data-calendar-date="${date}"] .calendar-date`).click();ids.push(...await page.locator('.calendar-day-agenda .calendar-chip[data-pending=true]').evaluateAll(es=>es.map(e=>e.dataset.recordId)));}return ids.sort();};

 await reset('fortnight');
 await check('default landing, two complete weeks, shared scroll and range navigation',async()=>{
  await page.reload();await page.locator('.calendar-scroll[data-view=fortnight]').waitFor();assert.equal(await view.getByRole('button',{name:'两周',exact:true}).getAttribute('aria-pressed'),'true');
  assert.equal(await page.locator('.calendar-timeline-row').count(),14);assert.equal(await page.locator('.calendar-timeline-heading').count(),1);
  const monday=shift(date,-((new Date(date+'T00:00:00Z').getUTCDay()+6)%7));assert.equal(await page.locator('button.timeline-date[data-calendar-date]').first().getAttribute('data-calendar-date'),monday);
  const area=page.locator('.calendar-scroll');await area.evaluate(el=>el.scrollLeft=230);assert(await area.evaluate(el=>el.scrollWidth>el.clientWidth?el.scrollLeft>0:el.scrollLeft===0));
  const lefts=await page.locator('.timeline-date').evaluateAll(es=>es.map(e=>e.getBoundingClientRect().left));assert(lefts.every(left=>Math.abs(left-lefts[0])<1));
  await page.getByRole('button',{name:'下一期',exact:true}).click();assert.equal(await page.locator('button.timeline-date[data-calendar-date]').first().getAttribute('data-calendar-date'),shift(monday,14));await page.getByRole('button',{name:'今天',exact:true}).click();
  assert.equal(await page.locator('button.timeline-date[data-calendar-date]').first().getAttribute('data-calendar-date'),monday);
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  if(!process.env.QA_FUNCTIONAL_ONLY)await page.screenshot({path:`qa/fortnight/${width}-${theme}-home.png`});
 });
 await check('quadrant tints are consistent across all task views',async()=>{
  const colors=new Map();for(const label of ['两周','四象限','窗口','列表','周','月']){
   await view.getByRole('button',{name:label,exact:true})[width<900?'tap':'click']();await page.waitForTimeout(90);
   for(const q of ['q1','q2','q3','q4','unclassified']){const card=page.locator('.todo-panel [data-urgency="'+q+'"]').first();if(!await card.count())continue;const color=await card.evaluate(el=>getComputedStyle(el).getPropertyValue('--urgency-color').trim());if(width<600&&label==='月')continue;if(colors.has(q))assert.equal(color,colors.get(q),label+': '+q);else colors.set(q,color);}
   if(['四象限','窗口','列表','月'].includes(label)&&!process.env.QA_FUNCTIONAL_ONLY)await page.screenshot({path:`qa/fortnight/${width}-${theme}-${label}.png`});
  }
  assert.equal(colors.size,5);assert.equal(new Set(colors.values()).size,4);
 });
 await reset('fortnight');
 await check('direct single choices, keyboard, always visible actions and resized viewport',async()=>{
  await page.getByRole('button',{name:'新建日程或日记',exact:true}).click();const modal=page.locator('.creation-dialog');await modal.waitFor();
  for(const label of ['事项类别','四象限','优先级','重复频率'])await modal.getByRole('radiogroup',{name:label,exact:true}).waitFor();
  const group=modal.getByRole('radiogroup',{name:'四象限',exact:true});await group.getByRole('radio',{name:'重要紧急',exact:true}).locator('xpath=ancestor::label[1]').click();await page.keyboard.press('ArrowRight');assert.equal(await group.getByRole('radio',{name:'重要不紧急',exact:true}).isChecked(),true);
  await group.getByRole('radio',{name:'待分类',exact:true}).locator('xpath=ancestor::label[1]').click();assert.equal(await group.getByRole('radio',{checked:true}).count(),1);
  await modal.getByRole('radiogroup',{name:'事项类别',exact:true}).getByRole('radio',{name:'学习与个人长期项目',exact:true}).locator('xpath=ancestor::label[1]').click();
  const input=modal.getByRole('textbox').first();await input.fill('新的两周计划');
  const footer=modal.locator('.creation-footer');const first=await footer.boundingBox();assert(first.y+first.height<=await page.evaluate(()=>innerHeight));
  const body=modal.locator('.creation-body');await body.evaluate(el=>el.scrollTop=el.scrollHeight);const last=await footer.boundingBox();assert(Math.abs(first.y-last.y)<1);
  assert.equal(await modal.locator('.plan-classification-fields select').count(),0);assert.equal(await modal.getByRole('button',{name:'创建',exact:true}).isEnabled(),true);
  if(!process.env.QA_FUNCTIONAL_ONLY){await page.screenshot({path:`qa/fortnight/${width}-${theme}-form.png`});await body.evaluate(el=>el.scrollTop=0);await page.screenshot({path:`qa/fortnight/${width}-${theme}-form-top.png`});}
  const oldHeight=page.viewportSize().height;await page.setViewportSize({width,height:560});await page.waitForTimeout(70);const resized=await footer.boundingBox();assert(resized.y+resized.height<=560);await page.setViewportSize({width,height:oldHeight});
  await modal.getByRole('button',{name:'取消新增',exact:true}).click();assert.equal(writes.length,0);await page.waitForFunction(()=>document.activeElement?.getAttribute('aria-label')==='新建日程或日记');
 });

 await check('edit recurrence scope, independent priority and fixed actions',async()=>{
  await view.getByRole('button',{name:'列表',exact:true})[width<900?'tap':'click']();const card=page.locator('.plan-card[data-record-id=batch-0]');await card.getByRole('button',{name:'计划详情：计划甲',exact:true}).click();await card.getByRole('button',{name:'修改',exact:true}).click();
  const modal=page.locator('.plan-task-dialog');await modal.getByRole('radiogroup',{name:'修改范围',exact:true}).waitFor();
  await modal.getByRole('radiogroup',{name:'四象限',exact:true}).getByRole('radio',{name:'不重要紧急',exact:true}).locator('xpath=ancestor::label[1]').click();assert.equal(await modal.getByRole('radiogroup',{name:'优先级',exact:true}).getByRole('radio',{name:'中',exact:true}).isChecked(),true);
  const footer=modal.locator('.plan-action-dock'),before=await footer.boundingBox();await modal.locator('.todo-modal-body').evaluate(el=>el.scrollTop=el.scrollHeight);assert(Math.abs(before.y-(await footer.boundingBox()).y)<1);await footer.getByRole('button',{name:'取消',exact:true}).click();assert.equal(writes.length,0);
 });
 for(const mode of ['fortnight','week','month']){
  await reset(mode);
  await check(mode+': multiple previews, repeated adjustment, single rollback and cancel all',async()=>{
   const hours=await page.locator('.timeline-hour-axis').allTextContents();await drag('batch-0',next,'14:15',mode);await drag('batch-1',next,'17:15',mode);assert.equal(writes.length,0);if(mode!=='month'){const boxes=await page.locator(`.timeline-timed-cell[data-calendar-date="${next}"] .calendar-chip`).evaluateAll(es=>es.map(e=>{const r=e.getBoundingClientRect();return {top:r.top,bottom:r.bottom,left:r.left,right:r.right};}));for(let i=0;i<boxes.length;i++)for(let j=i+1;j<boxes.length;j++)assert(boxes[i].bottom<=boxes[j].top||boxes[j].bottom<=boxes[i].top||boxes[i].right<=boxes[j].left||boxes[j].right<=boxes[i].left,'dense markers must not overlap');}assert.deepEqual(await pendingIds(),['batch-0','batch-1']);assert((await page.locator('.calendar-drop-review').innerText()).includes('2 项日程'));
   if(mode==='month')await page.locator(`.calendar-day[data-calendar-date="${date}"] .calendar-date`).click();assert.equal(await page.locator('.calendar-chip[data-record-id=batch-2] .calendar-chip-copy').first().isDisabled(),false);if(mode==='month'){await page.locator(`.calendar-day[data-calendar-date="${date}"] .calendar-date`).click();assert((await page.locator('.calendar-day-agenda [data-record-id=batch-3]').getAttribute('class')).includes('state-done'));}else assert.equal(await page.locator('.calendar-chip[data-record-id=batch-3] input[type=checkbox]').first().isChecked(),true);
   await drag('batch-0',later,'17:30',mode);assert.deepEqual(await pendingIds(),['batch-0','batch-1']);assert.deepEqual(await page.locator('.timeline-hour-axis').allTextContents(),hours);
   await drag('batch-0',date,'10:00',mode);assert.deepEqual(await pendingIds(),['batch-1']);await drag('batch-0',next,'14:15',mode);await drag('batch-0',date,'10:00',mode,true);assert.deepEqual(await pendingIds(),['batch-1']);
   await drag('batch-0',next,'14:15',mode);await page.getByRole('button',{name:'取消',exact:true}).click();locations.clear();assert.deepEqual(await pendingIds(),[]);assert.equal(writes.length,0);assert.equal(rows[0].task.dueDate,date);assert.equal(rows[1].task.dueDate,date);
  });
  await reset(mode);
  await check(mode+': one confirmation saves the batch once with fresh versions',async()=>{
   await drag('batch-0',next,'14:15',mode);await drag('batch-1',next,'17:15',mode);assert.equal(writes.length,0);if(mode!=='month'){const boxes=await page.locator(`.timeline-timed-cell[data-calendar-date="${next}"] .calendar-chip`).evaluateAll(es=>es.map(e=>{const r=e.getBoundingClientRect();return {top:r.top,bottom:r.bottom,left:r.left,right:r.right};}));for(let i=0;i<boxes.length;i++)for(let j=i+1;j<boxes.length;j++)assert(boxes[i].bottom<=boxes[j].top||boxes[j].bottom<=boxes[i].top||boxes[i].right<=boxes[j].left||boxes[j].right<=boxes[i].left,'dense markers must not overlap');}
   if(!process.env.QA_FUNCTIONAL_ONLY)await page.screenshot({path:`qa/fortnight/${width}-${theme}-${mode}-pending.png`});
   await page.getByRole('button',{name:'确认改期（2项）',exact:true}).evaluate(button=>{button.click();button.click();});await page.getByRole('button',{name:'正在保存…',exact:true}).waitFor();assert.equal(await page.locator('.calendar-chip-copy:not([disabled])').count(),0);await page.keyboard.press('Escape');
   await page.locator('.calendar-drop-review').waitFor({state:'hidden'});assert.equal(writes.length,2);assert.deepEqual(writes.map(w=>w.version),['v0','v1']);assert.deepEqual(await pendingIds(),[]);assert.equal(rows[0].task.dueDate,next);assert.equal(rows[1].task.dueDate,next);assert.equal(rows[0].task.startTime,'09:00');assert.equal(rows[0].task.occurrenceDate,date);assert.equal(rows[1].task.dueTime,mode!=='month'?'17:15':'14:00');assert((await page.locator('.calendar-batch-message').innerText()).includes('已保存 2 项'));
   await page.reload();await page.getByRole('navigation',{name:'主导航'}).getByRole('button',{name:'日程',exact:true}).click();await view.getByRole('button',{name:mode==='fortnight'?'两周':mode!=='month'?'周':'月',exact:true})[width<900?'tap':'click']();await page.waitForTimeout(120);assert.equal(await page.locator(`${mode!=='month'?'.timeline-timed-cell':'.calendar-month .calendar-day'}[data-calendar-date="${date}"] [data-record-id=batch-0]`).count(),0);
  });
 }
 if((width===375||width===1440)&&theme==='light'){
  await reset('week');
  await check('partial conflict keeps committed changes and unsubmitted previews for retry',async()=>{
   await drag('batch-0',next,'14:15','week');await drag('batch-1',next,'17:15','week');await drag('batch-2',later,'10:15','week');failId='batch-1';await page.getByRole('button',{name:'确认改期（3项）',exact:true}).click();await page.getByRole('button',{name:'确认改期',exact:true}).waitFor();assert.equal(writes.length,2);assert.equal(rows[0].task.dueDate,next);assert.equal(rows[1].task.dueDate,date);assert.equal(rows[2].task.dueDate,date);assert.deepEqual(await pendingIds(),['batch-2']);assert((await page.locator('.calendar-batch-message').innerText()).includes('剩余 1 项待确认'));
   failId='';await page.getByRole('button',{name:'确认改期',exact:true}).click();await page.locator('.calendar-drop-review').waitFor({state:'hidden'});assert.equal(writes.length,3);assert.equal(rows[2].task.dueDate,later);
  });
  await reset('week');
  await check('refresh failures after committed batch never restore old deadlines',async()=>{
   await drag('batch-0',next,'14:15','week');await drag('batch-1',next,'17:15','week');refreshFails=true;await page.getByRole('button',{name:'确认改期（2项）',exact:true}).click();await page.locator('.calendar-drop-review').waitFor({state:'hidden'});assert.equal(writes.length,2);assert.equal(rows[0].task.dueDate,next);assert.equal(rows[1].task.dueDate,next);assert.equal(await page.locator(`.timeline-timed-cell[data-calendar-date="${next}"] [data-record-id=batch-0]`).count(),1);await page.getByRole('button',{name:'重试刷新',exact:true}).waitFor();
   if(width<900){await page.getByRole('button',{name:'全屏显示',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.main-content')?.dataset.compact==='true');}
   locations.set('batch-0',{date:next,time:'14:15'});await drag('batch-0',next,'14:30','week');await page.getByRole('button',{name:'确认改期',exact:true}).click();await page.locator('.calendar-drop-review').waitFor({state:'hidden'});assert.equal(rows[0].task.dueTime,'14:30');assert.deepEqual(writes.map(write=>write.version),['v0','v1','v2']);refreshFails=false;await page.getByRole('button',{name:'重试刷新',exact:true}).click();await page.locator('.refresh-warning').waitFor({state:'hidden'});assert.equal(writes.length,3);
  });
  await reset('week');
  await check('external changes still conflict without overwriting remote fields',async()=>{
   await drag('batch-0',next,'14:15','week');await drag('batch-1',next,'17:15','week');refreshFails=true;externalAfterFirst=true;await page.getByRole('button',{name:'确认改期（2项）',exact:true}).click();await page.locator('.calendar-drop-review').waitFor({state:'hidden'});assert.equal(writes.length,2);assert.deepEqual(writes.map(write=>write.version),['v0','v1']);assert.equal(rows[0].task.dueDate,next);assert.equal(rows[1].task.dueDate,date);assert.equal(rows[1].task.title,'云端改名');assert((await page.locator('.calendar-batch-message').innerText()).includes('改期失败'));
  });
 }
 results.push({width,theme,checks,errors});await page.close();
}const previous=process.env.QA_WIDTH||process.env.QA_THEME?JSON.parse(await readFile('qa/fortnight/results.json','utf8').catch(()=>'[]')):[];const merged=[...previous.filter(old=>!results.some(result=>result.width===old.width&&result.theme===old.theme)),...results].sort((a,b)=>a.width-b.width||a.theme.localeCompare(b.theme));await writeFile('qa/fortnight/results.json',JSON.stringify(merged,null,2));console.log(JSON.stringify(results.map(r=>({width:r.width,theme:r.theme,checks:r.checks.map(c=>({name:c.name,passed:c.passed,...(!c.passed?{error:c.error}: {})})),errors:r.errors}))));if(results.some(r=>r.errors.length||r.checks.some(c=>!c.passed)))process.exitCode=1;}finally{await browser.close();}
