import { chromium } from 'playwright-core';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {todoSchema,captureDraftSchema} from '../packages/contracts/dist/index.js';
const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
await mkdir('qa/schedule',{recursive:true});const results=[];
try {for(const width of [375,768,1440])for(const theme of ['light','dark']) {
 const page=await browser.newPage({viewport:{width,height:900},hasTouch:width<900});page.setDefaultTimeout(8000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(theme=>{localStorage.setItem('diary.theme',theme);window.SpeechRecognition=class {
 start(){window.qaRecognition=this;}stop(){this.onend?.();}abort(){this.onend?.();}
 };},theme);
 const date=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 let rows=Array.from({length:30},(_,i)=>({date,version:'qa',task:todoSchema.parse({id:'calendar-'+i,title:i===0?'周会讨论':'日程 '+i,dueDate:date,dueTime:i===0?'10:00':i===1?'':`${String(12+i%8).padStart(2,'0')}:00`,startDate:date,startTime:'09:00',category:i%2?'personal':'work',important:true,urgent:false}),completionExists:false,sourceExists:false}));const writes=[];
 await page.route('**/api/actions',r=>{if(r.request().method()==='POST'){const input=r.request().postDataJSON();writes.push(input);rows=rows.map(row=>row.task.id===input.task.id?{...row,task:input.task}:row);return r.fulfill({json:{}});}return r.fulfill({json:{tasks:rows,records:[]}});});
 await page.route('**/api/schedule?*',r=>r.fulfill({json:{tasks:rows}}));
 await page.route('**/api/capture/parse',r=>r.fulfill({json:{mode:'ai',drafts:[captureDraftSchema.parse({id:'c5961689-4444-4444-8444-555555555555',kind:'plan',content:'每周与张三讨论',date,time:'15:00',repeat:{type:'weekly',weekdays:[1,3]},entities:{people:[{type:'person',name:'张三',tags:['同事']}],places:[],activities:[],foods:[]}})]}}));
 await page.goto('http://127.0.0.1:4320');await page.getByRole('button',{name:'计划',exact:true}).click();await page.locator('.plan-card').first().waitFor();
 const view=page.getByRole('navigation',{name:'计划视图'}),tabs=page.getByRole('navigation',{name:'时间与状态'});
 if(width>=900){const rail=page.getByRole('navigation',{name:'计划快捷导航'});await rail.getByRole('button',{name:/今日/}).click();assert.equal(await tabs.getByRole('button',{name:'今日',exact:true}).getAttribute('aria-pressed'),'true');await rail.getByRole('button',{name:/全部计划/}).click();}
 await view.getByRole('button',{name:'窗口',exact:true}).click();await page.locator('.plan-windows').waitFor();
 const win=await page.locator('.plan-window').first().boundingBox();assert(win.height>230);const card=await page.locator('.plan-window-list .plan-card').first().boundingBox();assert(card.height>=100);
 const check=await page.locator('.plan-window-list .todo-check').first().boundingBox();assert(check.y>=card.y&&check.y<card.y+card.height);
 if(!process.env.QA_FUNCTIONAL_ONLY)await page.screenshot({path:`qa/schedule/${width}-${theme}-windows.png`});
 if(width===1440&&theme==='light'){
  const handle=page.getByRole('button',{name:'拖动到其他窗口：周会讨论',exact:true}),a=await handle.boundingBox(),b=await page.locator('.plan-window[data-plan-drop="category:personal"]').boundingBox();
  await page.mouse.move(a.x+a.width/2,a.y+a.height/2);await page.mouse.down();await page.mouse.move(b.x+b.width/2,b.y+110,{steps:8});await page.mouse.up();await page.waitForTimeout(180);
  assert(writes.some(w=>w.task.id==='calendar-0'&&w.task.category==='personal'));assert.equal(await page.locator('.plan-card-dragging').count(),0);
 }
 assert.equal(await tabs.getByRole('button').count(),6);await tabs.getByRole('button',{name:'今日',exact:true}).click();assert.equal(await tabs.getByRole('button',{name:'今日',exact:true}).getAttribute('aria-pressed'),'true');await tabs.getByRole('button',{name:'全部',exact:true}).click();
 await view.getByRole('button',{name:'月',exact:true}).click();await page.locator('.calendar-month').waitFor();if(!process.env.QA_FUNCTIONAL_ONLY)await page.screenshot({path:`qa/schedule/${width}-${theme}-month.png`});
 await page.getByRole('button',{name:`查看 ${date} 的日程`,exact:true}).click();assert.equal(await page.locator('.calendar-expanded .calendar-chip').count(),30);
 await view.getByRole('button',{name:'周',exact:true}).click();await page.locator('.calendar-week').waitFor();assert.equal(await page.locator('.calendar-day-hours').count(),7);assert.equal(await page.locator('.calendar-all-day .calendar-chip').count(),1);
 if(!process.env.QA_FUNCTIONAL_ONLY)await page.screenshot({path:`qa/schedule/${width}-${theme}-week.png`});
 assert.equal(await page.locator('.calendar-hours span').filter({hasText:'00:00'}).count(),0);
 assert.equal(await page.locator('.calendar-hours span').count(),9);
 await page.getByRole('button',{name:'显示全部时段',exact:true}).click();assert.equal(await page.locator('.calendar-hours span').count(),24);
 if(width===1440&&theme==='light') {
  await page.locator('.plan-calendar').scrollIntoViewIfNeeded();const area=page.locator('.calendar-scroll');await area.evaluate(el=>{el.scrollTop=400;});
  const handle=page.getByRole('button',{name:'拖动截止时间：周会讨论',exact:true});const start=await handle.boundingBox(),day=await page.locator(`[data-calendar-date="${date}"][data-timed]`).boundingBox();
  await page.mouse.move(start.x+start.width/2,start.y+start.height/2);await page.mouse.down();await page.mouse.move(day.x+day.width/2,day.y+11*48+12,{steps:10});const ghost=await page.locator('.calendar-drag-ghost').boundingBox();assert(ghost&&ghost.y<day.y+11*48+12&&ghost.y>day.y+11*48-70);await page.mouse.up();assert.equal(await page.locator('.calendar-drag-ghost').count(),0);await page.locator('.calendar-drop-review').waitFor();await page.getByRole('button',{name:'确认改期',exact:true}).click();await page.waitForTimeout(250);
  const write=writes.findLast(w=>w.task.id==='calendar-0');assert(write);assert.equal(write.task.startTime,'09:00');assert.equal(write.task.dueTime,'11:15');
 }
 if(width===375&&theme==='light') {
  const area=page.locator('.calendar-scroll');await page.waitForTimeout(60);await area.evaluate(el=>{el.scrollTop=550;});
  const handle=page.getByRole('button',{name:'拖动截止时间：周会讨论',exact:true}),a=await handle.boundingBox(),b=await page.locator(`[data-calendar-date="${date}"][data-timed]`).boundingBox();const cdp=await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:a.x+a.width/2,y:a.y+20}]});await page.waitForTimeout(400);
  await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:b.x+b.width/2,y:b.y+11*48+12}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await page.locator('.calendar-drop-review').waitFor();await page.getByRole('button',{name:'确认改期',exact:true}).click();await page.waitForTimeout(150);assert(writes.some(w=>w.task.id==='calendar-0'&&w.task.dueTime==='11:15'&&w.task.startTime==='09:00'));await cdp.detach();
 }
 await page.getByRole('button',{name:'隐藏空白时段',exact:true}).click();rows=rows.map(row=>({...row,task:{...row.task,dueTime:''}}));
 await view.getByRole('button',{name:'月',exact:true}).click();await view.getByRole('button',{name:'周',exact:true}).click();await page.waitForFunction(()=>document.querySelectorAll('.calendar-all-day .calendar-chip').length===30);assert.equal(await page.locator('.calendar-day-hours').count(),0);
 await page.getByRole('button',{name:'新增计划',exact:true}).click();let dlg=page.getByRole('dialog',{name:'计划编辑'});assert((await dlg.getByLabel('截止时间',{exact:true}).inputValue()).startsWith(date+'T'));assert(await dlg.getByLabel('原定开始时间',{exact:true}).inputValue()==='');await dlg.getByRole('button',{name:'取消',exact:true}).click();
 await page.locator('.capture-mobile-trigger').click();const capture=page.locator('#capture-panel');await capture.getByRole('button',{name:'语音输入',exact:true}).click();
 await page.evaluate(()=>{const r=window.qaRecognition;const a={isFinal:true,0:{transcript:'每周与张三讨论'}};r.onresult({results:[a]});r.onresult({results:[a]});});await page.waitForFunction(()=>document.querySelector('#capture-text').value==='每周与张三讨论');assert.equal(await capture.locator('textarea').first().inputValue(),'每周与张三讨论');
 await capture.getByRole('button',{name:'停止并整理',exact:true}).click();const draft=capture.locator('.capture-draft');await draft.waitFor();assert(await draft.getByLabel('截止时间',{exact:true}).isVisible());assert(await draft.getByRole('button',{name:/张三.*同事/}).isVisible());await draft.getByRole('button',{name:/张三.*同事/}).click();await draft.getByRole('button',{name:'朋友',exact:true}).click();if(!process.env.QA_FUNCTIONAL_ONLY)await page.screenshot({path:`qa/schedule/${width}-${theme}-capture.png`});
 if(width===375&&theme==='light') {
  await draft.getByRole('button',{name:'移除草稿',exact:true}).click();const original=await capture.locator('textarea').first().inputValue();await capture.getByRole('button',{name:'语音输入',exact:true}).click();await page.evaluate(()=>window.qaRecognition.onresult({results:[{isFinal:false,0:{transcript:'临时文字'}}]}));await capture.getByRole('button',{name:'取消',exact:true}).click();assert.equal(await capture.locator('textarea').first().inputValue(),original);assert.equal(await capture.locator('.capture-draft').count(),0);
  await capture.getByRole('button',{name:'语音输入',exact:true}).click();await page.evaluate(()=>{const r=window.qaRecognition;r.onerror({error:'network'});r.onend();});await capture.getByRole('alert').filter({hasText:'语音服务连接失败'}).waitFor();assert.equal(await capture.locator('.capture-draft').count(),0);
  await page.evaluate(()=>{window.SpeechRecognition=undefined;window.webkitSpeechRecognition=undefined;});await capture.getByRole('button',{name:'语音输入',exact:true}).click();await capture.getByRole('alert').filter({hasText:'此浏览器暂不支持语音识别'}).waitFor();
 }
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2));assert.deepEqual(errors,[]);results.push({width,theme,passed:true});await page.close();
}await writeFile('qa/schedule/results.json',JSON.stringify(results,null,2));console.log(JSON.stringify(results));}finally{await browser.close();}
