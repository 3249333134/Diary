import {chromium} from 'playwright-core';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {emptyDiary,todoSchema} from '../packages/contracts/dist/index.js';
const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
const date=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const shift=(date,n)=>{const d=new Date(date+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10);};
const next=shift(date,1),later=shift(date,2),names=['计划甲','计划乙','计划丙'];
const fixture=()=>Array.from({length:7},(_,i)=>({date,version:'v0',task:todoSchema.parse({id:'batch-'+i,title:names[i]||'其他日程 '+i,dueDate:i>3?next:date,dueTime:i===0?'10:00':i===1?'14:00':i===2?'17:00':'15:00',startDate:date,startTime:'09:00',category:i%2?'personal':'work',important:true,urgent:false,...(i<3?{seriesId:'series-'+i,occurrenceDate:date}:{}),...(i===3?{done:true,status:'done'}:{})}),sourceExists:false,completionExists:false}));
await mkdir('qa/calendar-batch',{recursive:true});const results=[];
try{for(const width of [375,624,768,1440])for(const theme of ['light','dark']){
 if(process.env.QA_WIDTH&&Number(process.env.QA_WIDTH)!==width||process.env.QA_THEME&&process.env.QA_THEME!==theme)continue;
 const page=await browser.newPage({viewport:{width,height:width===624?1195:900},hasTouch:width<900});page.setDefaultTimeout(8000);
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
  else if(path==='/api/plan-categories')json={categories:[{id:'work',name:'工作',color:'#7bb4de',order:0},{id:'personal',name:'个人生活',color:'#c5a27e',order:1}]};
  else if(path==='/api/entities')json={entities:[]};else if(path==='/api/tags')json={tags:{person:[],place:[],activity:[],food:[],thing:[]}};
  else if(path==='/api/weeks')json={start:date,end:date,entries:[]};else if(path==='/api/plan-views')json={views:[]};else if(path==='/api/quick-facts')json={facts:[]};else if(path==='/api/tag-library')json={tags:[]};
  await route.fulfill({json});
 });
 const check=async(name,fn)=>{try{await fn();checks.push({name,passed:true});}catch(e){checks.push({name,passed:false,error:e.stack});await page.mouse.up();await page.keyboard.press('Escape');}};
 const view=page.getByRole('navigation',{name:'计划视图'});
 async function reset(mode){rows=fixture();version=0;failId='';refreshFails=false;externalAfterFirst=false;writes.length=0;locations.clear();await page.goto('http://127.0.0.1:4320');await page.getByRole('button',{name:'计划',exact:true}).click();await view.getByRole('button',{name:mode==='week'?'周':'月',exact:true}).click();await page.locator('.calendar-scroll').waitFor();await page.waitForTimeout(120);}
 async function drag(id,targetDate,time,mode,invalid=false){
  const sourceDate=locations.get(id)?.date||rows.find(r=>r.task.id===id).task.dueDate;
  if(mode==='month'){const day=page.getByRole('button',{name:`查看 ${sourceDate} 的日程`,exact:true});if(await day.getAttribute('aria-expanded')!=='true')await day.click();}
  const handle=(mode==='month'?page.locator('.calendar-selected-day'):page.locator('.calendar-week')).getByRole('button',{name:'拖动截止时间：'+names[Number(id.slice(-1))],exact:true});await handle.scrollIntoViewIfNeeded();const a=await handle.boundingBox();
  const cdp=width<900?await page.context().newCDPSession(page):undefined;
  try{
   if(cdp){await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:a.x+a.width/2,y:a.y+a.height/2}]});await page.waitForTimeout(380);}else{await page.mouse.move(a.x+a.width/2,a.y+a.height/2);await page.mouse.down();}
   const safe=await page.locator('.calendar-scroll').boundingBox();if(cdp)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:safe.x+safe.width/2,y:safe.y+safe.height/2}]});else await page.mouse.move(safe.x+safe.width/2,safe.y+safe.height/2);
   const column=page.locator(`${mode==='week'?'.calendar-day-hours':'.calendar-month .calendar-day'}[data-calendar-date="${targetDate}"]`);await column.scrollIntoViewIfNeeded();let b=await column.boundingBox();const area=page.locator('.calendar-scroll'),box=await area.boundingBox();
   const offset=mode==='week'?(await page.locator('.calendar-hours span').allTextContents()).indexOf(time.slice(0,2)+':00')*48+Number(time.slice(3))/60*48+1:0;
   if(mode==='week'){const header=await page.locator('.calendar-week-top').first().boundingBox();const center=Math.min(box.y+box.height-8,box.y+Math.max(header.height+14,box.height/2));await area.evaluate((el,delta)=>el.scrollTop+=delta,b.y+offset-center);b=await column.boundingBox();}
   let y=mode==='month'?Math.max(box.y+8,Math.min(box.y+box.height-8,b.y+b.height/2)):b.y+offset;
   const x=invalid?20:b.x+b.width/2;y=invalid?20:y;
   if(cdp){await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});}else{await page.mouse.move(x,y,{steps:5});await page.mouse.up();}
  }finally{if(cdp)await cdp.detach();else await page.mouse.up();}
  if(invalid||targetDate===rows.find(r=>r.task.id===id).task.dueDate&&(mode==='month'||time===rows.find(r=>r.task.id===id).task.dueTime))locations.delete(id);else locations.set(id,{date:targetDate,time});
  await page.waitForTimeout(80);
 }
 const pendingIds=()=>page.locator('.calendar-week .calendar-chip[data-pending=true],.calendar-month .calendar-chip[data-pending=true]').evaluateAll(es=>es.map(e=>e.dataset.recordId).sort());
 for(const mode of ['week','month']){
  await reset(mode);
  await check(mode+': multiple previews, repeated adjustment, single rollback and cancel all',async()=>{
   const hours=await page.locator('.calendar-hours').allTextContents();await drag('batch-0',next,'14:15',mode);await drag('batch-1',next,'17:15',mode);assert.equal(writes.length,0);assert.deepEqual(await pendingIds(),['batch-0','batch-1']);assert((await page.locator('.calendar-drop-review').innerText()).includes('2 项日程'));
   assert.equal(await page.locator('.calendar-chip[data-record-id=batch-2] .calendar-drag-handle').first().isDisabled(),false);assert.equal(await page.locator('.calendar-chip[data-record-id=batch-3] .calendar-drag-handle').first().isDisabled(),true);
   await drag('batch-0',later,'17:30',mode);assert.deepEqual(await pendingIds(),['batch-0','batch-1']);assert.deepEqual(await page.locator('.calendar-hours').allTextContents(),hours);
   await drag('batch-0',date,'10:00',mode);assert.deepEqual(await pendingIds(),['batch-1']);await drag('batch-0',next,'14:15',mode);await drag('batch-0',date,'10:00',mode,true);assert.deepEqual(await pendingIds(),['batch-1']);
   await drag('batch-0',next,'14:15',mode);await page.getByRole('button',{name:'取消',exact:true}).click();locations.clear();assert.deepEqual(await pendingIds(),[]);assert.equal(writes.length,0);assert.equal(rows[0].task.dueDate,date);assert.equal(rows[1].task.dueDate,date);
  });
  await reset(mode);
  await check(mode+': one confirmation saves the batch once with fresh versions',async()=>{
   await drag('batch-0',next,'14:15',mode);await drag('batch-1',next,'17:15',mode);assert.equal(writes.length,0);
   if(!process.env.QA_FUNCTIONAL_ONLY)await page.screenshot({path:`qa/calendar-batch/${width}-${theme}-${mode}-pending.png`});
   await page.getByRole('button',{name:'确认改期（2项）',exact:true}).evaluate(button=>{button.click();button.click();});await page.getByRole('button',{name:'正在保存…',exact:true}).waitFor();assert.equal(await page.locator('.calendar-drag-handle:not([disabled])').count(),0);await page.keyboard.press('Escape');
   await page.locator('.calendar-drop-review').waitFor({state:'hidden'});assert.equal(writes.length,2);assert.deepEqual(writes.map(w=>w.version),['v0','v1']);assert.deepEqual(await pendingIds(),[]);assert.equal(rows[0].task.dueDate,next);assert.equal(rows[1].task.dueDate,next);assert.equal(rows[0].task.startTime,'09:00');assert.equal(rows[0].task.occurrenceDate,date);assert.equal(rows[1].task.dueTime,mode==='week'?'17:15':'14:00');assert((await page.locator('.calendar-batch-message').innerText()).includes('已保存 2 项'));
   await page.reload();await page.getByRole('button',{name:'计划',exact:true}).click();await view.getByRole('button',{name:mode==='week'?'周':'月',exact:true}).click();await page.waitForTimeout(120);assert.equal(await page.locator(`${mode==='week'?'.calendar-day-hours':'.calendar-month .calendar-day'}[data-calendar-date="${date}"] [data-record-id=batch-0]`).count(),0);
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
   await drag('batch-0',next,'14:15','week');await drag('batch-1',next,'17:15','week');refreshFails=true;await page.getByRole('button',{name:'确认改期（2项）',exact:true}).click();await page.locator('.calendar-drop-review').waitFor({state:'hidden'});assert.equal(writes.length,2);assert.equal(rows[0].task.dueDate,next);assert.equal(rows[1].task.dueDate,next);assert.equal(await page.locator(`.calendar-day-hours[data-calendar-date="${next}"] [data-record-id=batch-0]`).count(),1);await page.getByRole('button',{name:'重试刷新',exact:true}).waitFor();
   if(width<900){await page.getByRole('button',{name:'全屏显示',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.main-content')?.dataset.compact==='true');}
   locations.set('batch-0',{date:next,time:'14:15'});await drag('batch-0',next,'14:30','week');await page.getByRole('button',{name:'确认改期',exact:true}).click();await page.locator('.calendar-drop-review').waitFor({state:'hidden'});assert.equal(rows[0].task.dueTime,'14:30');assert.deepEqual(writes.map(write=>write.version),['v0','v1','v2']);refreshFails=false;await page.getByRole('button',{name:'重试刷新',exact:true}).click();await page.locator('.refresh-warning').waitFor({state:'hidden'});assert.equal(writes.length,3);
  });
  await reset('week');
  await check('external changes still conflict without overwriting remote fields',async()=>{
   await drag('batch-0',next,'14:15','week');await drag('batch-1',next,'17:15','week');refreshFails=true;externalAfterFirst=true;await page.getByRole('button',{name:'确认改期（2项）',exact:true}).click();await page.locator('.calendar-drop-review').waitFor({state:'hidden'});assert.equal(writes.length,2);assert.deepEqual(writes.map(write=>write.version),['v0','v1']);assert.equal(rows[0].task.dueDate,next);assert.equal(rows[1].task.dueDate,date);assert.equal(rows[1].task.title,'云端改名');assert((await page.locator('.calendar-batch-message').innerText()).includes('改期失败'));
  });
 }
 results.push({width,theme,checks,errors});await page.close();
}const previous=process.env.QA_WIDTH||process.env.QA_THEME?JSON.parse(await readFile('qa/calendar-batch/results.json','utf8').catch(()=>'[]')):[];const merged=[...previous.filter(old=>!results.some(result=>result.width===old.width&&result.theme===old.theme)),...results].sort((a,b)=>a.width-b.width||a.theme.localeCompare(b.theme));await writeFile('qa/calendar-batch/results.json',JSON.stringify(merged,null,2));console.log(JSON.stringify(results));if(results.some(r=>r.errors.length||r.checks.some(c=>!c.passed)))process.exitCode=1;}finally{await browser.close();}
