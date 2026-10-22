import {dragCalendar} from './calendar-drag.mjs';
import {chromium} from 'playwright-core';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {emptyDiary,todoSchema} from '../packages/contracts/dist/index.js';
const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
await mkdir('qa/diary-layout',{recursive:true});
const results=[],date=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const shift=(day,n)=>{const d=new Date(day+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10);};
const tomorrow=shift(date,1);
try{for(const width of [375,624,768,1440])for(const theme of ['light','dark']){
 if(process.env.QA_WIDTH&&Number(process.env.QA_WIDTH)!==width||process.env.QA_THEME&&process.env.QA_THEME!==theme)continue;
 const page=await browser.newPage({viewport:{width,height:width===624?1195:900},hasTouch:width<900});page.setDefaultTimeout(6000);
 const checks=[],errors=[],writes=[];let diary=emptyDiary(date),behavior='ok';
 let rows=Array.from({length:8},(_,i)=>({date,version:'qa',task:todoSchema.parse({id:'layout-'+i,title:i===0?'周会讨论':'日程 '+i,dueDate:i>3?tomorrow:date,dueTime:i===1?'':i===0?'10:00':'14:00',startDate:date,startTime:'09:00',category:i%2?'personal':'work',important:true,urgent:false,...(i===0?{seriesId:'series',occurrenceDate:date}:{}),...(i===3?{done:true,status:'done'}:{})}),sourceExists:false,completionExists:false}));
 page.on('pageerror',e=>errors.push(e.message));await page.addInitScript(t=>localStorage.setItem('diary.theme',t),theme);
 await page.route('**/api/**',async route=>{
  const req=route.request(),path=new URL(req.url()).pathname;let json={};
  if(path==='/api/auth/me')json={id:1,username:'本地演示'};
  else if(path.startsWith('/api/diaries/')){if(req.method()==='PUT')diary=req.postDataJSON();json={document:diary,version:'qa',exists:true};}
  else if(path==='/api/actions'){
   if(req.method()==='POST'){
    const input=req.postDataJSON();writes.push(input);
    if(behavior==='400'||behavior==='409')return route.fulfill({status:Number(behavior),json:{error:behavior==='409'?'版本冲突，请重试':'截止时间校验失败',code:behavior==='409'?'VERSION_CONFLICT':'VALIDATION_FAILED'}});
    if(behavior==='slow')await new Promise(resolve=>setTimeout(resolve,250));
    rows=rows.map(r=>r.task.id===input.task.id?{...r,task:input.task}:r);json={diary:{document:{...diary,todos:rows.map(r=>r.task)},version:'saved',exists:true}};
   }else{if(behavior==='refresh-fail')return route.fulfill({status:503,json:{error:'刷新失败'}});json={tasks:rows,records:[]};}
  }else if(path==='/api/schedule')json={tasks:rows};
  else if(path==='/api/plan-categories')json={categories:[{id:'work',name:'工作',color:'#7bb4de',order:0},{id:'personal',name:'个人生活',color:'#c5a27e',order:1}]};
  else if(path==='/api/entities')json={entities:[]};else if(path==='/api/tags')json={tags:{person:['同事'],place:[],activity:[],food:[],thing:['项目','工作','阅读']}};
  else if(path==='/api/weeks')json={start:date,end:date,entries:[]};else if(path==='/api/plan-views')json={views:[]};else if(path==='/api/quick-facts')json={facts:[]};else if(path==='/api/tag-library')json={tags:[]};
  await route.fulfill({json});
 });
 const check=async(name,fn)=>{try{await fn();checks.push({name,passed:true});}catch(e){checks.push({name,passed:false,error:e.stack});await page.mouse.up();await page.keyboard.press('Escape');behavior='ok';}};
 const shot=async(name)=>{if(!process.env.QA_FUNCTIONAL_ONLY)await page.screenshot({path:`qa/diary-layout/${width}-${theme}-${name}.png`,fullPage:width>=900});};
 const view=page.getByRole('navigation',{name:'计划视图'});
 const footerCheck=async()=>{if(width>=900)return;const bounds=await page.locator('.diary-workspace[data-record-workspace=true]').boundingBox();const bar=await page.locator('.capture-mobile-bar').boundingBox();assert(Math.abs(bar.y-bounds.y-bounds.height-8)<1,'diary/footer gap must be 8px');assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));};
 await page.goto('http://127.0.0.1:4320');await page.getByRole('button',{name:'日记',exact:true}).click();await page.getByRole('button',{name:'编辑今日信息',exact:true}).waitFor();
 await check('four matching diary panels and compact metadata',async()=>{
  const bounds=[];for(const [label,id] of [['事实','facts'],['新知','learn'],['输入','input'],['灵感','idea']]){
   await page.getByRole('tab',{name:label,exact:true}).click();await page.waitForTimeout(70);const panel=page.locator(`#panel-${id} .diary-panel`);bounds.push(await panel.boundingBox());
   assert.equal(await panel.locator('.diary-panel-heading').count(),0);assert.equal(await panel.locator('.diary-information').count(),0);assert.equal(await panel.locator('.tag-options').count(),0);
   const add=await page.getByRole('button',{name:'新增'+label,exact:true}).boundingBox();assert(add.width>=44&&add.height>=44);await footerCheck();await shot(id);
  }if(width<900)for(const b of bounds){assert(Math.abs(b.y-bounds[0].y)<1);assert(Math.abs(b.height-bounds[0].height)<1);}
 });
 await check('metadata dialog focus, tags and unsent composer survive tab changes',async()=>{
  await page.getByRole('button',{name:'编辑标签',exact:true}).click();const tags=page.getByRole('dialog',{name:'灵感标签',exact:true});await tags.getByRole('button',{name:'项目',exact:true}).click();await tags.getByRole('button',{name:'完成编辑',exact:true}).click();await page.waitForFunction(()=>document.activeElement?.getAttribute('aria-label')==='编辑标签');
  const draft=page.locator('#panel-idea .diary-entry-composer textarea');await draft.fill('保留这段未提交灵感');await page.getByRole('tab',{name:'输入',exact:true}).click();await page.getByRole('tab',{name:'灵感',exact:true}).click();assert.equal(await draft.inputValue(),'保留这段未提交灵感');
  await page.getByRole('button',{name:'编辑今日信息',exact:true}).count();await page.getByRole('tab',{name:'事实',exact:true}).click();await page.getByRole('button',{name:'编辑今日信息',exact:true}).click();const info=page.getByRole('dialog',{name:'今日信息',exact:true});await info.getByRole('button',{name:'展开睡眠选项',exact:true}).click();assert.equal(await page.getByRole('option').count(),8);await page.keyboard.press('Escape');await info.getByRole('button',{name:'完成编辑',exact:true}).click();await page.waitForFunction(()=>document.activeElement?.getAttribute('aria-label')==='编辑今日信息');
  if(width<900){await page.getByRole('button',{name:'全屏显示',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.main-content')?.dataset.compact==='true');await page.getByRole('button',{name:'新增事实',exact:true}).click();await page.locator('.facts-panel .event-block[data-expanded=true]').waitFor();await footerCheck();await page.getByRole('button',{name:'退出全屏',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.main-content')?.dataset.compact==='false');}
 });
 await page.getByRole('button',{name:'计划',exact:true}).click();
 await check('all plan views use the same footer slot',async()=>{for(const label of ['两周','四象限','窗口','列表','周','月']){
  await view.getByRole('button',{name:label,exact:true}).click();await page.waitForTimeout(150);const p=await page.locator('.todo-panel').boundingBox(),b=await page.locator('.capture-mobile-bar').boundingBox();assert(Math.abs(b.y-p.y-p.height-8)<1,'plan/footer gap must be 8px');assert(p.height>0);await shot('plan-'+label);
  if(width<900){await page.getByRole('button',{name:'全屏显示',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.main-content')?.dataset.compact==='true');const full=await page.locator('.todo-panel').boundingBox(),bar=await page.locator('.capture-mobile-bar').boundingBox();assert(Math.abs(bar.y-full.y-full.height-8)<1);await page.getByRole('button',{name:'退出全屏',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.main-content')?.dataset.compact==='false');}
 }});
 async function frameDragHandle(handle){
  await handle.scrollIntoViewIfNeeded();await page.locator('.calendar-scroll').evaluate(el=>{const h=el.querySelector('[data-record-id=layout-0] .calendar-drag-handle'),r=h.getBoundingClientRect(),b=el.getBoundingClientRect();el.scrollTop+=r.y+r.height/2-(b.y+44+(b.height-44)/2);el.scrollLeft+=r.x+r.width/2-(b.x+96+(b.width-96)/2);});
 }
 async function weekDrag(targetDate,time,kind='mouse',invalid=false){await dragCalendar(page,{id:'layout-0',targetDate,time,touch:kind==='touch',invalid});}
 if((width===375||width===1440)&&theme==='light'){
  await view.getByRole('button',{name:'周',exact:true}).click();
 const kind=width===375?'touch':'mouse';
  await check('drop immediately moves card without writes, Escape and redrag cancel',async()=>{
   const count=writes.length,originalHours=await page.locator('.timeline-hour-axis').innerText();await weekDrag(tomorrow,'14:15',kind);
   assert.equal(writes.length,count);assert.equal(await page.locator(`.timeline-timed-cell[data-calendar-date="${date}"] [data-record-id=layout-0]`).count(),0);assert.equal(await page.locator(`.timeline-timed-cell[data-calendar-date="${tomorrow}"] [data-record-id=layout-0][data-pending=true]`).count(),1);assert.equal(await page.locator('.timeline-hour-axis').innerText(),originalHours);
   const target=await page.locator('.calendar-chip[data-pending=true]').boundingBox(),viewport=await page.locator('.calendar-scroll').boundingBox();assert(target.y>=viewport.y-1&&target.y+target.height<=viewport.y+viewport.height+1,'released preview stays visible below the review bar');
   assert.equal(await page.getByRole('button',{name:'拖动截止时间：日程 2',exact:true}).isDisabled(),false);await shot('pending-week');await weekDrag(date,'10:00',kind);assert.equal(await page.locator('.calendar-drop-review:visible').count(),0,'pending clears on cancellation');assert.equal(writes.length,count);
   await weekDrag(tomorrow,'14:15',kind);await page.keyboard.press('Escape');assert.equal(await page.locator('.calendar-drop-review:visible').count(),0,'pending clears on cancellation');assert.equal(writes.length,count);
   await weekDrag(tomorrow,'14:15',kind);await weekDrag(date,'10:00',kind,true);assert.equal(await page.locator('.calendar-drop-review:visible').count(),0,'invalid drop restores saved position');assert.equal(await page.locator(`.timeline-timed-cell[data-calendar-date="${date}"] [data-record-id=layout-0]`).count(),1);
   await weekDrag(tomorrow,'14:15',kind);await view.getByRole('button',{name:'列表',exact:true}).click();await view.getByRole('button',{name:'周',exact:true}).click();assert.equal(await page.locator('.calendar-drop-review:visible').count(),0,'view change discards preview');
   await weekDrag(tomorrow,'14:15',kind);await page.getByRole('button',{name:'下一期',exact:true}).click();await page.locator('.calendar-drop-review').waitFor({state:'hidden'});await page.getByRole('button',{name:'上一期',exact:true}).click();assert.equal(writes.length,count);
   await weekDrag(tomorrow,'14:15',kind);await page.getByRole('button',{name:'计划',exact:true}).count();await page.getByRole('button',{name:'日记',exact:true}).click();await page.getByRole('button',{name:'计划',exact:true}).click();assert.equal(await page.locator('.calendar-drop-review:visible').count(),0);
   await page.getByRole('button',{name:'筛选计划',exact:true}).click();await page.getByRole('checkbox',{name:'显示全部时段',exact:true}).check();await page.getByRole('button',{name:'关闭计划筛选',exact:true}).click();await page.waitForTimeout(80);const oldViewport=page.viewportSize();await page.setViewportSize({width,height:560});const area=page.locator('.calendar-scroll'),handle=page.getByRole('button',{name:'拖动截止时间：周会讨论',exact:true});await frameDragHandle(handle);const a=await handle.boundingBox(),box=await area.boundingBox(),before=await area.evaluate(e=>({top:e.scrollTop,left:e.scrollLeft}));
   if(kind==='touch'){const cdp=await page.context().newCDPSession(page);await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:a.x+a.width/2,y:a.y+a.height/2}]});await page.waitForTimeout(380);await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:box.x+box.width-5,y:box.y+box.height-5}]});await page.waitForTimeout(220);assert((await area.evaluate(e=>e.scrollTop))>before.top,'bottom edge auto scrolls');assert((await area.evaluate(e=>e.scrollLeft))>before.left,'mobile side edge auto scrolls');await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:20,y:20}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await cdp.detach();}
   else{await page.mouse.move(a.x+a.width/2,a.y+a.height/2);await page.mouse.down();try{await page.mouse.move(box.x+box.width-5,box.y+box.height-5);await page.waitForTimeout(220);assert((await area.evaluate(e=>e.scrollTop))>before.top,'bottom edge auto scrolls');await page.mouse.move(20,20);}finally{await page.mouse.up();}}
   await page.getByRole('button',{name:'筛选计划',exact:true}).click();await page.getByRole('checkbox',{name:'显示全部时段',exact:true}).uncheck();await page.getByRole('button',{name:'关闭计划筛选',exact:true}).click();await page.setViewportSize(oldViewport);assert.equal(writes.length,count);
  });
  await check('confirmation saves once and failures return to saved deadline',async()=>{
   const count=writes.length;await weekDrag(tomorrow,'14:15',kind);behavior='slow';await page.getByRole('button',{name:'确认改期',exact:true}).click();assert.equal(await page.getByRole('button',{name:'正在保存…',exact:true}).isDisabled(),true);await page.locator('.calendar-drop-review').waitFor({state:'hidden'});assert.equal(writes.length,count+1);assert.equal(rows[0].task.dueDate,tomorrow);assert.equal(rows[0].task.startTime,'09:00');assert.equal(rows[0].task.occurrenceDate,date);behavior='ok';
   for(const failure of ['400','409']){behavior=failure;await weekDrag(date,'14:30',kind);await page.getByRole('button',{name:'确认改期',exact:true}).click();await page.locator('.calendar-drop-review').waitFor({state:'hidden'});assert.equal(await page.locator(`.timeline-timed-cell[data-calendar-date="${tomorrow}"] [data-record-id=layout-0]`).count(),1);assert.equal(rows[0].task.dueTime,'14:15');}behavior='ok';
   await weekDrag(date,'14:30',kind);behavior='refresh-fail';await page.getByRole('button',{name:'确认改期',exact:true}).click();await page.locator('.calendar-drop-review').waitFor({state:'hidden'});assert((await page.locator('.todo-panel .refresh-warning').innerText()).includes('计划已保存'));assert.equal(await page.locator(`.timeline-timed-cell[data-calendar-date="${date}"] [data-record-id=layout-0]`).count(),1);assert.equal(rows[0].task.dueTime,'14:30');behavior='ok';await page.getByRole('button',{name:'重试刷新',exact:true}).click();await page.locator('.todo-panel .refresh-warning').waitFor({state:'hidden'});assert.equal(await page.getByText('计划读取失败，请重试。',{exact:true}).count(),0);
  });
  await check('month date preview preserves time and remains visible in dense dates',async()=>{
   await view.getByRole('button',{name:'月',exact:true}).click();await page.getByRole('button',{name:`查看 ${date} 的日程`,exact:true}).click();const handle=page.locator('.calendar-selected-day').getByRole('button',{name:'拖动截止时间：周会讨论',exact:true});await handle.scrollIntoViewIfNeeded();const cell=page.locator(`.calendar-month [data-calendar-date="${tomorrow}"]`);await cell.scrollIntoViewIfNeeded();const a=await handle.boundingBox(),b=await cell.boundingBox(),count=writes.length;
   if(width<600){const cdp=await page.context().newCDPSession(page);await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:a.x+a.width/2,y:a.y+a.height/2}]});await page.waitForTimeout(380);const target=await cell.boundingBox();await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:target.x+target.width/2,y:target.y+target.height/2}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await cdp.detach();}else{await page.mouse.move(a.x+a.width/2,a.y+a.height/2);await page.mouse.down();await page.mouse.move(b.x+b.width/2,b.y+b.height/2,{steps:5});await page.mouse.up();}
   await page.locator('.calendar-drop-review').waitFor();assert.equal(writes.length,count);assert((await page.locator('.calendar-drop-review').innerText()).includes('14:30'));assert.equal(await cell.locator('[data-record-id=layout-0][data-pending=true]').count(),1);assert.equal(await page.locator(`.calendar-month [data-calendar-date="${date}"] [data-record-id=layout-0]`).count(),0);await shot('pending-month');await page.getByRole('button',{name:'取消',exact:true}).click();assert.equal(await cell.locator('[data-record-id=layout-0]').count(),0);
  });
 }
 if(width<900)await check('short viewport keeps composer, dialogs and footer reachable',async()=>{
  await page.getByRole('button',{name:'日记',exact:true}).click();await page.getByRole('tab',{name:'输入',exact:true}).click();await page.setViewportSize({width,height:540});const textarea=page.locator('#panel-input .diary-entry-composer textarea');await textarea.focus();await textarea.scrollIntoViewIfNeeded();const t=await textarea.boundingBox(),bar=await page.locator('.capture-mobile-bar').boundingBox();assert(t.y+t.height<=bar.y-8+1);await page.getByRole('button',{name:'编辑输入信息',exact:true}).click();await page.getByRole('dialog',{name:'输入信息',exact:true}).locator('.glass-select-trigger').click();const pop=await page.locator('.glass-popup').boundingBox();assert(pop.y>=7&&pop.y+pop.height<=533);await page.keyboard.press('Escape');await page.getByRole('dialog',{name:'输入信息',exact:true}).getByRole('button',{name:'完成编辑',exact:true}).click();await page.setViewportSize({width,height:width===624?1195:900});
 });
 if((width===375||width===1440)&&theme==='light')await check('populated diary keeps composer, expansion and scroll across tabs and workspaces',async()=>{
  await page.getByRole('button',{name:'日记',exact:true}).click();await page.getByRole('tab',{name:'新知',exact:true}).click();const panel=page.locator('#panel-learn');
  for(let i=0;i<3;i++){await page.getByRole('button',{name:'新增新知',exact:true}).click();const textarea=panel.locator('.diary-entry-composer textarea');await textarea.fill('保留记录 '+i);await panel.getByRole('button',{name:'新建新知',exact:true}).click();}
  assert.equal(await panel.locator('.diary-entry-composer').count(),0);await page.getByRole('button',{name:'新增新知',exact:true}).click();const textarea=panel.locator('.diary-entry-composer textarea');await page.waitForTimeout(200);assert.equal(await page.evaluate(()=>document.activeElement?.tagName),'TEXTAREA',JSON.stringify(await page.evaluate(()=>({active:document.activeElement?.outerHTML,tab:document.querySelector('.workspace-panel[data-active=true]')?.id,composer:document.querySelector('#panel-learn .diary-entry-composer')?.outerHTML}))));await textarea.fill('继续保留未提交文字');const body=panel.locator('.diary-panel-body');await body.evaluate(e=>e.scrollTop=90);const position=await body.evaluate(e=>e.scrollTop);assert(position>0);const expanded=await panel.locator('.event-block[data-expanded=true]').count();
  await page.getByRole('tab',{name:'输入',exact:true}).click();await page.getByRole('tab',{name:'新知',exact:true}).click();assert.equal(await textarea.inputValue(),'继续保留未提交文字');assert.equal(await body.evaluate(e=>e.scrollTop),position);assert.equal(await panel.locator('.event-block[data-expanded=true]').count(),expanded);
  await page.getByRole('button',{name:'计划',exact:true}).click();await page.getByRole('button',{name:'日记',exact:true}).click();assert.equal(await textarea.inputValue(),'继续保留未提交文字');assert.equal(await body.evaluate(e=>e.scrollTop),position);
 });
 results.push({width,theme,checks,errors});await page.close();
}await writeFile('qa/diary-layout/results.json',JSON.stringify(results,null,2));console.log(JSON.stringify(results));if(results.some(r=>r.errors.length||r.checks.some(c=>!c.passed)))process.exitCode=1;}finally{await browser.close();}
