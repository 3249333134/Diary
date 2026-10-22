import {chromium} from 'playwright-core';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {emptyDiary,todoSchema,diaryEventSchema,textEntrySchema,projectEntries} from '../packages/contracts/dist/index.js';
const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
const output='qa/diary-compact/'+(process.env.QA_FUNCTIONAL_ONLY?'functional':process.env.QA_CONFIRM?'confirmation':'initial');await mkdir(output,{recursive:true});
const results=[],date=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const shift=(day,n)=>{const d=new Date(day+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10);};
const tomorrow=shift(date,1);
try{for(const width of [375,624,768,1280,1440])for(const theme of ['light','dark']){
 if(process.env.QA_WIDTH&&Number(process.env.QA_WIDTH)!==width||process.env.QA_THEME&&process.env.QA_THEME!==theme)continue;
 const page=await browser.newPage({viewport:{width,height:width===624?1195:900},hasTouch:width<900});page.setDefaultTimeout(6000);
 const checks=[],errors=[],writes=[],diaryWrites=[];let diary=emptyDiary(date),behavior='ok',diaryBehavior='ok';
 let rows=Array.from({length:8},(_,i)=>({date,version:'qa',task:todoSchema.parse({id:'layout-'+i,title:i===0?'周会讨论':'日程 '+i,dueDate:i>3?tomorrow:date,dueTime:i===1?'':i===0?'10:00':'14:00',startDate:date,startTime:'09:00',category:i%2?'personal':'work',important:true,urgent:false,...(i===0?{seriesId:'series',occurrenceDate:date}:{}),...(i===3?{done:true,status:'done'}:{})}),sourceExists:false,completionExists:false}));
 page.on('pageerror',e=>errors.push(e.message));await page.addInitScript(t=>localStorage.setItem('diary.theme',t),theme);
 await page.route('**/api/**',async route=>{
  const req=route.request(),path=new URL(req.url()).pathname;let json={};
  if(path==='/api/auth/me')json={id:1,username:'本地演示'};
  else if(path.startsWith('/api/diaries/')){const target=path.split('/').pop();if(req.method()==='PUT'){diaryWrites.push(req.postDataJSON());if(diaryBehavior==='400')return route.fulfill({status:400,json:{error:'备注字段校验失败',code:'VALIDATION_FAILED',requestId:'compact-qa',issues:[{path:'facts.note',code:'too_big',message:'请检查今日备注',limit:20000}]}});diary=req.postDataJSON();}json={document:diary.date===target?diary:emptyDiary(target),version:'qa',exists:true};}
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
  else if(path==='/api/weeks')json={start:date,end:date,entries:[]};else if(path==='/api/plan-views')json={views:[]};else if(path==='/api/quick-facts')json={facts:[{id:'quick-one',label:'散步',note:'晚间散步',count:3,source:'pinned',people:[],places:[],activities:[],foods:[]}]};else if(path==='/api/tag-library')json={tags:[]};
  await route.fulfill({json});
 });

 const check=async(name,fn)=>{try{await fn();checks.push({name,passed:true});console.log(width,theme,'PASS',name);}catch(e){checks.push({name,passed:false,error:e.stack});console.log(width,theme,'FAIL',name,e.message);await page.keyboard.press('Escape');}};
 const shot=async name=>{if(!process.env.QA_FUNCTIONAL_ONLY)await page.screenshot({path:`${output}/${width}-${theme}-${name}.png`});};
 const panel=()=>page.locator('.workspace-panel[data-active=true] .diary-panel');
 const infoLabels={facts:'编辑今日信息',learn:'编辑来源',input:'编辑输入信息',idea:'编辑标签'};
 const choose=async label=>{await page.getByRole('tab',{name:label,exact:true}).click();await page.waitForTimeout(50);};
 const openInfo=async key=>{await page.getByRole('button',{name:infoLabels[key],exact:true}).click();await page.locator('.diary-information-dialog').waitFor();await page.waitForFunction(()=>getComputedStyle(document.querySelector('.glass-modal-overlay')).opacity==='1');return page.locator('.diary-information-dialog');};
 const closeInfo=async()=>{await page.getByRole('button',{name:'完成编辑',exact:true}).click();await page.locator('.diary-information-dialog').waitFor({state:'hidden'});};
 await page.goto('http://127.0.0.1:4320');await page.getByRole('button',{name:'日记',exact:true}).click();await page.locator('.diary-save-control[data-status=saved]').waitFor();
 const measurements=[];
 await check('matching compact panels, content starts early and footer gap is 8px',async()=>{
  for(const [label,key] of [['事实','facts'],['新知','learn'],['输入','input'],['灵感','idea']]){
   await choose(label);const geometry=await page.evaluate(()=>{const main=document.querySelector('.main-content'),body=document.querySelector('.workspace-panel[data-active=true] .diary-panel-body'),root=document.querySelector('.diary-workspace'),toolbar=document.querySelector('.diary-main-toolbar'),footer=document.querySelector('.workspace-footer');const box=e=>{const r=e.getBoundingClientRect();return {top:r.top,bottom:r.bottom,height:r.height,width:r.width}};return {body:box(body),root:box(root),toolbar:box(toolbar),footer:box(footer),overflow:document.documentElement.scrollWidth>innerWidth}});measurements.push({key,...geometry});
   assert(geometry.body.top<=(width<900?150:96));assert(geometry.body.top>=geometry.toolbar.bottom-1);assert(geometry.toolbar.height<=64);assert(Math.abs(geometry.footer.top-geometry.root.bottom-8)<1);assert(!geometry.overflow);
   assert.equal(await page.locator('.diary-panel-heading,.diary-information').count(),0);assert.equal(await page.locator('.main-content>.topbar:visible,.main-content>.mobile-status:visible,.main-content>.mobile-workspace-switch:visible').count(),0);
   if(width<900){assert.equal((await page.locator('.compact-browse-bar').boundingBox()).height,52);assert.equal(await page.locator('.workspace-footer [role=tablist]').count(),1);}else assert.equal(await page.locator('.date-rail [role=tablist]').count(),1);
   const add=await page.getByRole('button',{name:'新增'+label,exact:true}).boundingBox();assert(add.width>=44&&add.height>=44);await shot('empty-'+key);
  }
 });
 await check('each information action edits its own metadata and restores focus',async()=>{
  await choose('事实');let dialog=await openInfo('facts');await dialog.getByRole('button',{name:'展开睡眠选项',exact:true}).click();assert.equal(await page.getByRole('option').count(),8);await page.keyboard.press('Escape');await dialog.getByRole('combobox',{name:'天气',exact:true}).fill('晴');await shot('information');await closeInfo();await page.waitForFunction(()=>document.activeElement?.getAttribute('aria-label')==='编辑今日信息');
  await choose('新知');dialog=await openInfo('learn');await dialog.getByRole('button',{name:'添加事物',exact:true}).click();await dialog.getByRole('combobox',{name:'添加事物',exact:true}).fill('资料来源');await dialog.getByRole('button',{name:'添加事物',exact:true}).click();await dialog.getByRole('button',{name:'资料来源',exact:true}).waitFor();await closeInfo();
  await choose('输入');dialog=await openInfo('input');await dialog.locator('.glass-select-trigger').click();await page.getByRole('option',{name:'文章',exact:true}).click();await closeInfo();
  await choose('灵感');dialog=await openInfo('idea');await dialog.getByRole('button',{name:'项目',exact:true}).click();await closeInfo();
 });
 await check('empty receipt returns to facts and creates an expanded event',async()=>{
  await choose('事实');await page.locator('.diary-save-control[data-status=saved]').waitFor();const dialog=await openInfo('facts');await dialog.getByRole('button',{name:'每日小票',exact:true}).click();await page.getByRole('button',{name:'去写一条',exact:true}).click();await page.locator('.facts-panel .event-block[data-expanded=true]').waitFor();
 });
 await check('top add opens and focuses facts; text drafts survive tabs, workspace and receipts',async()=>{
  await choose('事实');await page.getByRole('button',{name:'新增事实',exact:true}).click();await page.locator('.event-block[data-expanded=true] textarea').first().waitFor();await page.waitForFunction(()=>document.activeElement?.tagName==='TEXTAREA');
  for(const [label,key] of [['新知','learn'],['输入','input'],['灵感','idea']]){await choose(label);await page.getByRole('button',{name:'新增'+label,exact:true}).click();const input=page.locator(`#panel-${key} .diary-entry-composer textarea`);await input.fill('未提交的'+label);}
  await choose('事实');await choose('灵感');assert.equal(await page.locator('#panel-idea .diary-entry-composer textarea').inputValue(),'未提交的灵感');
  await page.getByRole('button',{name:'计划',exact:true}).click();await page.locator('.plan-main-toolbar').waitFor();await shot('plan');await page.getByRole('button',{name:'日记',exact:true}).click();assert.equal(await page.locator('#panel-idea .diary-entry-composer textarea').inputValue(),'未提交的灵感');
  const dialog=await openInfo('idea');await dialog.getByRole('button',{name:'每日小票',exact:true}).click();await page.getByRole('button',{name:'返回记录',exact:true}).click();assert.equal(await page.locator('#panel-idea .diary-entry-composer textarea').inputValue(),'未提交的灵感');assert.equal(await page.locator('.diary-panel-heading').count(),0);
 });
 await check('quick facts create a real entry',async()=>{
  await choose('事实');let dialog=await openInfo('facts');await dialog.getByRole('button',{name:/散步/}).click();await page.locator('.diary-information-dialog').waitFor({state:'hidden'});await page.locator('.event-compact-copy strong').filter({hasText:'晚间散步'}).waitFor();
 });
 // Hydrate stable populated fixtures before checking default collapse and record scroll preservation.
 await page.waitForTimeout(800);diary=projectEntries({...emptyDiary(date),facts:{note:'',events:Array.from({length:24},(_,i)=>diaryEventSchema.parse({id:'fact-'+i,time:'10:00',note:'事实记录 '+i,people:[],places:[],activities:[],foods:[]}))},entries:Object.fromEntries(['learn','input','idea'].map(kind=>[kind,Array.from({length:20},(_,i)=>textEntrySchema.parse({id:kind+'-'+i,time:'11:00',content:kind+' 内容记录 '+i}))]))});
 await page.evaluate(()=>Object.keys(localStorage).filter(key=>key.startsWith('diary.draft.')).forEach(key=>localStorage.removeItem(key)));await page.reload();await page.getByRole('button',{name:'日记',exact:true}).click();await page.locator('.diary-save-control[data-status=saved]').waitFor();
 await check('populated columns default collapsed, keep scroll and match the compact shell',async()=>{
  for(const [label,key] of [['事实','facts'],['新知','learn'],['输入','input'],['灵感','idea']]){
   await choose(label);assert.equal(await panel().locator('[data-expanded=true]').count(),0);await shot('populated-'+key);const body=panel().locator('.diary-panel-body');await body.evaluate(e=>e.scrollTop=220);const before=await body.evaluate(e=>e.scrollTop);await choose(label==='事实'?'输入':'事实');await choose(label);assert.equal(await body.evaluate(e=>e.scrollTop),before);await body.evaluate(e=>e.scrollTop=0);
  }
 });
 await check('date navigation, calendar cancellation and today return work',async()=>{
  await page.getByRole('button',{name:'前一天',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.diary-date-tools .glass-date-trigger')?.textContent?.trim().length>0);await page.locator('.diary-date-tools').getByRole('button',{name:'回到今天',exact:true}).click();await page.locator('.diary-save-control[data-status=saved]').waitFor();const trigger=page.getByRole('button',{name:'日记日期',exact:true});const text=await trigger.innerText();await trigger.click();await page.getByRole('dialog',{name:'选择日记日期',exact:true}).getByRole('button',{name:'取消',exact:true}).click();assert.equal(await trigger.innerText(),text);
 });
 await check('fullscreen and return keep the new toolbar and column operations',async()=>{
  await page.getByRole('button',{name:'全屏显示',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.main-content')?.dataset.fullscreen==='true');if(width>=900)assert.equal(await page.locator('.date-rail:visible,.context-rail:visible').count(),0);await choose('新知');await page.getByRole('button',{name:'新增新知',exact:true}).click();await page.locator('#panel-learn .diary-entry-composer textarea').waitFor();await page.getByRole('button',{name:'退出全屏',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.main-content')?.dataset.fullscreen!=='true');assert.equal(await page.locator('.diary-main-toolbar:visible').count(),1);
 });
 if(width===375&&theme==='light'||width===1440&&theme==='light')await check('validation and 400 errors open the metadata field without losing the text',async()=>{
  await choose('事实');let dialog=await openInfo('facts');await dialog.locator('[data-field="facts.note"]').fill('字'.repeat(20001));await closeInfo();await page.getByRole('button',{name:'保存日记',exact:true}).click();await page.locator('.diary-information-dialog').waitFor();await page.waitForFunction(()=>document.activeElement?.getAttribute('data-field')==='facts.note');assert.equal((await page.locator('[data-field="facts.note"]').inputValue()).length,20001);
  diaryBehavior='400';await page.locator('[data-field="facts.note"]').fill('保留完整备注');await closeInfo();await page.getByRole('button',{name:'保存日记',exact:true}).click();await page.locator('.save-problem').getByRole('button',{name:'请检查今日备注',exact:true}).click();await page.waitForFunction(()=>document.activeElement?.getAttribute('data-field')==='facts.note');assert.equal(await page.locator('[data-field="facts.note"]').inputValue(),'保留完整备注');diaryBehavior='ok';await closeInfo();await page.getByRole('button',{name:'保存日记',exact:true}).click();await page.locator('.diary-save-control[data-status=saved]').waitFor();const notice=page.locator('.receipt-notice');if(await notice.count()){const box=await notice.boundingBox(),footer=await page.locator('.workspace-footer').boundingBox();assert(box.y+box.height<=footer.y-7);}
 });
 const notice=page.getByRole('button',{name:'关闭小票提示',exact:true});if(await notice.count())await notice.click();await page.setViewportSize({width,height:560});await page.waitForTimeout(60);await check('short visible viewport keeps record editors and footer reachable',async()=>{await choose('输入');await page.getByRole('button',{name:'新增输入',exact:true}).click();const composer=page.locator('#panel-input .diary-entry-composer textarea');await composer.scrollIntoViewIfNeeded();const box=await composer.boundingBox(),footer=await page.locator('.workspace-footer').boundingBox();assert(box.y+box.height<=footer.y+2);assert.equal(await page.locator('.diary-main-toolbar').count(),1);});await shot('short');
 results.push({width,theme,measurements,checks,errors});await page.close();
}await writeFile(`${output}/results.json`,JSON.stringify(results,null,2));console.log(JSON.stringify(results.map(r=>({width:r.width,theme:r.theme,failed:r.checks.filter(c=>!c.passed),errors:r.errors}))));if(results.some(r=>r.errors.length||r.checks.some(c=>!c.passed)))process.exitCode=1;}finally{await browser.close();}
