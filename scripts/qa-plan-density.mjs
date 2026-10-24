import {dragCalendar} from './calendar-drag.mjs';
import {chromium} from 'playwright-core';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {emptyDiary,todoSchema} from '../packages/contracts/dist/index.js';
const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
const date=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const shift=(date,n)=>{const d=new Date(date+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10);};
let next=shift(date,1),later=shift(date,2);const names=['计划甲','计划乙','计划丙'];
const fixture=()=>Array.from({length:9},(_,i)=>({date,version:'v0',task:todoSchema.parse({id:'batch-'+i,title:names[i]||'其他日程 '+i,dueDate:i>3?next:date,dueTime:['10:00','14:00','17:00','15:00','10:00','14:00','17:00','18:00',''][i],startDate:date,startTime:'09:00',category:i===2?null:i===6?'cat-00000000-0000-0000-0000-000000000000':i%2?'personal':'work',important:i===8?null:i%4<2,urgent:i===8?null:i%2===0,...(i<3?{seriesId:'series-'+i,occurrenceDate:date}:{}),...(i===3?{done:true,status:'done'}:{})}),sourceExists:false,completionExists:false}));
const output='qa/plan-density/'+(process.env.QA_FUNCTIONAL_ONLY?'functional':process.env.QA_CONFIRM?'confirmation':'initial');await mkdir(output,{recursive:true});const results=[];
try{for(const width of [375,624,768,1280,1440])for(const theme of ['light','dark']){
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
  else if(path==='/api/plan-categories')json={categories:[{id:'work',name:'工作',color:'#7bb4de',order:0},{id:'personal',name:'个人生活',color:'#c5a27e',order:1},{id:'cat-00000000-0000-0000-0000-000000000000',name:'学习与个人长期项目',color:'#198276',order:2}]};
  else if(path==='/api/entities')json={entities:[]};else if(path==='/api/tags')json={tags:{person:[],place:[],activity:[],food:[],thing:[]}};
  else if(path==='/api/weeks')json={start:date,end:date,entries:[]};else if(path==='/api/plan-views')json={views:[]};else if(path==='/api/quick-facts')json={facts:[]};else if(path==='/api/tag-library')json={tags:[]};
  await route.fulfill({json});
 });

 const check=async(name,fn)=>{try{await fn();checks.push({name,passed:true});}catch(e){checks.push({name,passed:false,error:e.stack});console.log('FAIL',width,theme,name,e.message);await page.keyboard.press('Escape');}};
 const view=page.getByRole('navigation',{name:'计划视图'});
 const choose=async(label)=>{await view.getByRole('button',{name:label,exact:true}).click();};
 const filterButton=()=>width<900?page.locator('.compact-browse-context'):page.locator('.plan-toolbar-actions').getByRole('button',{name:'筛选计划',exact:true});
 const openFilters=async()=>{await filterButton().click();const dialog=page.getByRole('dialog',{name:'筛选计划',exact:true});await dialog.waitFor();await page.waitForFunction(()=>getComputedStyle(document.querySelector('.glass-modal-overlay')).opacity==='1');return dialog;};
 const closeFilters=async()=>{await page.getByRole('button',{name:'关闭计划筛选'}).click();await page.getByRole('dialog',{name:'筛选计划',exact:true}).waitFor({state:'hidden'});};
 await page.goto('http://127.0.0.1:4320');await page.locator('.calendar-chip[data-record-id="batch-0"]').waitFor();
 let geometry;
 await check('single toolbar, calendar height gain and 8px footer gap',async()=>{
  geometry=await page.evaluate(()=>{const box=s=>{const r=document.querySelector(s).getBoundingClientRect();return {top:r.top,bottom:r.bottom,height:r.height,width:r.width}};return {main:box('.main-content'),calendar:box('.calendar-scroll'),panel:box('.todo-panel'),toolbar:box('.plan-main-toolbar'),footer:box('.workspace-footer'),overflow:document.documentElement.scrollWidth>innerWidth}});
  assert.equal(geometry.overflow,false);assert(geometry.toolbar.height<=64);assert.equal(await page.locator('.todo-panel>.section-heading:visible,.todo-panel>.todo-stats:visible,.todo-panel>.plan-browse-tools:visible,.todo-panel>.plan-urgency-legend:visible,.calendar-heading:visible,.calendar-week-caption:visible').count(),0);
  assert(Math.abs(geometry.footer.top-geometry.panel.bottom-8)<2);
  if(width>=900){assert(geometry.calendar.top-geometry.main.top<=96);const baseline=JSON.parse(await readFile('qa/plan-density/baseline.json','utf8')).find(r=>r.width===width);const beforeUpperBound=baseline.panel.top+baseline.panel.height-baseline.calendar.top;geometry.minimumHeightGain=geometry.calendar.height-beforeUpperBound;assert(geometry.minimumHeightGain>=240);assert.equal(await page.locator('.plan-time-tabs:visible').count(),0);}else{assert.equal(await page.locator('.compact-browse-bar:visible').count(),1);assert.equal(await page.locator('.plan-time-tabs:visible').count(),1);}
 });
 await check('all six sidebar views, six ranges with counts, category and add entry',async()=>{
  if(width<900)return;
  const ranges=page.getByRole('navigation',{name:'计划快捷导航'});assert.equal(await ranges.getByRole('button').count(),6);
  assert.equal(await page.getByRole('navigation',{name:'侧栏日程视图'}).getByRole('button').count(),6);
  assert.equal(await page.locator('.plan-rail-navigation [data-plan-drop]').count(),3);
  await ranges.getByRole('button',{name:/即将开始/}).click();await page.waitForFunction(()=>document.querySelector('[aria-label="计划快捷导航"] [aria-pressed=true]')?.textContent?.includes('即将开始'));
  await ranges.getByRole('button',{name:/回收站/}).click();await page.locator('.plan-list-view').waitFor();await page.waitForFunction(()=>document.querySelector('[aria-label="侧栏日程视图"] [aria-pressed=true]')?.textContent==='列表');assert.equal(await page.getByRole('navigation',{name:'侧栏日程视图'}).getByRole('button',{name:'月日程',exact:true}).isDisabled(),true);
  await ranges.getByRole('button',{name:/全部计划/}).click();
  await page.getByRole('navigation',{name:'侧栏日程视图'}).getByRole('button',{name:'列表',exact:true}).click();await page.locator('.plan-list-view').waitFor();await choose('两周');
  await page.getByRole('navigation',{name:'侧栏计划类别'}).getByRole('button',{name:'工作',exact:true}).click();await page.locator('.plan-main-toolbar [data-restricted=true]').waitFor();
  await page.getByRole('navigation',{name:'侧栏计划类别'}).getByRole('button',{name:'全部类别',exact:true}).click();
 });
 await check('filter contains stats, category, legend and hours; reset preserves view',async()=>{
  await choose('周');let dialog=await openFilters();assert.equal(await dialog.locator('.todo-stat-chip').count(),5);assert.equal(await dialog.locator('.plan-urgency-legend').count(),1);
  await dialog.getByRole('checkbox',{name:'显示全部时段',exact:true}).check();await closeFilters();assert.equal(await page.locator('.timeline-hour-axis>span:not(.timeline-no-hours)').count(),24);
  dialog=await openFilters();await dialog.getByRole('checkbox',{name:'显示全部时段',exact:true}).uncheck();
  await dialog.getByRole('navigation',{name:'事项类别'}).getByRole('button',{name:'工作',exact:true}).click();await dialog.getByRole('button',{name:'重置筛选',exact:true}).click();await closeFilters();
  assert.equal(await view.getByRole('button',{name:'周',exact:true}).getAttribute('aria-pressed'),'true');await page.waitForFunction(()=>document.activeElement?.getAttribute('aria-label')==='筛选计划');await choose('两周');
 });
 await check('continuous date rows have exact marker bounds and compact empty dates',async()=>{
  assert.equal(await page.locator('.calendar-week-caption').count(),0);assert.equal(await page.locator('button.timeline-date[data-calendar-date]').count(),14);
  const sizes=await page.locator('.calendar-timeline-row').evaluateAll(rows=>rows.map(row=>({height:row.clientHeight,cards:row.querySelectorAll('.calendar-chip').length})));
  assert(sizes.some(row=>row.cards===0&&row.height<=64));assert(sizes.every(row=>row.height>=60));
 });
 await check('empty date label accepts an all-day preview without a write',async()=>{
  const monday=shift(date,-((new Date(date+'T00:00:00Z').getUTCDay()+6)%7)),targetDate=shift(monday,8);
  await dragCalendar(page,{id:'batch-0',targetDate,touch:width<900});
  const preview=page.locator(`.timeline-all-day[data-calendar-date="${targetDate}"] .calendar-chip[data-record-id=batch-0][data-pending=true]`);await preview.waitFor();assert.equal(writes.length,0);assert.equal(await page.locator('.calendar-timeline-canvas .calendar-chip[data-record-id=batch-0]').count(),1);
  await page.locator('.calendar-drop-review').getByRole('button',{name:'取消',exact:true}).click();await page.locator('.calendar-drop-review').waitFor({state:'hidden'});await page.locator('.calendar-scroll').evaluate(el=>{el.scrollTop=0;el.scrollLeft=0;});
 });
 for(const [key,label] of [['fortnight','两周'],['board','四象限'],['windows','窗口'],['list','列表'],['week','周'],['month','月']]){
  await choose(label);await page.waitForTimeout(70);if(!process.env.QA_FUNCTIONAL_ONLY)await page.screenshot({path:`${output}/${width}-${theme}-${key}.png`});
  await check('canvas and toolbar remain inside viewport: '+key,async()=>{const out=await page.evaluate(()=>({page:document.documentElement.scrollWidth>innerWidth,bar:document.querySelector('.plan-main-toolbar').getBoundingClientRect().height,panel:document.querySelector('.todo-panel').getBoundingClientRect().bottom,footer:document.querySelector('.workspace-footer').getBoundingClientRect().top}));assert(!out.page);assert(out.bar<=64);assert(Math.abs(out.footer-out.panel-8)<2);});
 }

 await check('desktop category drop targets work in board and window views',async()=>{
  if(width<900)return;
  for(const [label,name] of [['四象限','学习与个人长期项目'],['窗口','个人生活']]){
   await choose(label);const card=page.locator('.plan-card[data-plan-id="batch-0"]');const handle=card.locator('.plan-drag-handle');await handle.scrollIntoViewIfNeeded();
   const target=page.getByRole('navigation',{name:'侧栏计划类别'}).getByRole('button',{name,exact:true});await target.scrollIntoViewIfNeeded();const a=await handle.boundingBox(),b=await target.boundingBox();
   const count=writes.length;await page.mouse.move(a.x+a.width/2,a.y+a.height/2);await page.mouse.down();await page.mouse.move(b.x+b.width/2,b.y+b.height/2,{steps:8});await page.mouse.up();
   await card.locator('.plan-category-label').filter({hasText:name}).waitFor();assert.equal(writes.length,count+1);assert.equal(writes.at(-1).task.important,true);assert.equal(writes.at(-1).task.urgent,true);
  }
  await page.getByRole('navigation',{name:'侧栏计划类别'}).getByRole('button',{name:'新增类别',exact:true}).click();const dialog=page.getByRole('dialog',{name:'添加计划类别',exact:true});await dialog.waitFor();await page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});
 });
 await choose('两周');await check('fullscreen widens calendar and restores view/filter',async()=>{
  const before=await page.locator('.calendar-scroll').boundingBox();await page.getByRole('button',{name:'全屏显示',exact:true}).click();await page.locator('.todo-panel[data-fullscreen=true]').waitFor();
  if(width>=900){assert.equal(await page.locator('.date-rail:visible,.context-rail:visible').count(),0);assert((await page.locator('.calendar-scroll').boundingBox()).width>before.width+100);}
  await page.getByRole('button',{name:'退出全屏',exact:true}).click();await page.locator('.todo-panel:not([data-fullscreen])').waitFor();assert.equal(await view.getByRole('button',{name:'两周',exact:true}).getAttribute('aria-pressed'),'true');
 });
 await page.setViewportSize({width,height:560});await page.waitForTimeout(60);
 await check('short viewport keeps calendar, footer and new-task actions reachable',async()=>{assert((await page.locator('.calendar-scroll').boundingBox()).height>180);const add=page.locator('.workspace-create-button');await add.click();const dock=page.locator('.plan-task-dialog .plan-action-dock');await dock.waitFor();const box=await dock.boundingBox();assert(box.y>=0&&box.y+box.height<=561);await dock.getByRole('button',{name:'取消',exact:true}).click();});
 if(!process.env.QA_FUNCTIONAL_ONLY)await page.screenshot({path:`${output}/${width}-${theme}-short.png`});await openFilters();if(!process.env.QA_FUNCTIONAL_ONLY)await page.screenshot({path:`${output}/${width}-${theme}-filters.png`});await closeFilters();
 results.push({width,theme,geometry,checks,errors});await page.close();
}await writeFile(`${output}/results.json`,JSON.stringify(results,null,2));console.log(JSON.stringify(results.map(r=>({width:r.width,theme:r.theme,geometry:r.geometry,failed:r.checks.filter(c=>!c.passed),errors:r.errors}))));if(results.some(r=>r.errors.length||r.checks.some(c=>!c.passed)))process.exitCode=1;}finally{await browser.close();}
