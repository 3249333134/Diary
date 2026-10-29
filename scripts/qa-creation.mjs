import {selectCreationDraft} from './plan-view.mjs';
import {chromium} from 'playwright-core';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {emptyDiary,todoSchema,captureDraftSchema} from '../packages/contracts/dist/index.js';
import {dragCalendar} from './calendar-drag.mjs';

const date='2026-10-25',past='2026-10-20',windowId='11111111-1111-4111-8111-111111111111',viewerId='22222222-2222-4222-8222-222222222222';
const output=(process.env.QA_OUTPUT||'qa/creation-followup')+'/'+(process.env.QA_CONFIRM?'confirmation':process.env.QA_CASE?'focused':process.env.QA_FUNCTIONAL_ONLY?'functional':'initial');await mkdir(output,{recursive:true});
const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});const results=[];
try{for(const width of [375,624,768,1280,1440])for(const theme of ['light','dark']){
 if(process.env.QA_WIDTHS&&!process.env.QA_WIDTHS.split(',').includes(String(width))||process.env.QA_THEME&&theme!==process.env.QA_THEME)continue;
 const page=await browser.newPage({viewport:{width,height:900},hasTouch:width<900});page.setDefaultTimeout(7000);await page.clock.install({time:new Date(date+'T04:00:00Z')});
 await page.addInitScript(theme=>{localStorage.setItem('diary.theme',theme);class Recognition{start(){window.__voice=this;}stop(){this.onresult?.({results:[{isFinal:true,0:{transcript:'明天下午三点开会'}}]});this.onend?.();}abort(){this.onend?.();}}window.SpeechRecognition=Recognition;},theme);
 let docs=new Map(),versions=new Map(),account=1,failure='',failWriteAt=0,refreshFails=false,parseFailure=false,sharedAllowed=true;const writes=[],parses=[],errors=[],checks=[];
 const load=d=>{if(!docs.has(d))docs.set(d,emptyDiary(d));return structuredClone(docs.get(d));},version=d=>'v'+(versions.get(d)||0),commit=(d,document)=>{docs.set(d,document);versions.set(d,(versions.get(d)||0)+1);};
 const tasks=()=>[...docs].flatMap(([date,document])=>document.todos.map(task=>({date,version:version(date),task,sourceExists:false,completionExists:false})));
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/api/**',async route=>{
  const req=route.request(),path=new URL(req.url()).pathname;let json={};
  if(path==='/api/auth/me'||path==='/api/auth/login')json={id:account,username:'测试账号 '+account};
  else if(path==='/api/social')json={profile:{code:'CODE-'+account,name:'测试账号'},friends:[],requests:[],invitations:[],notices:[],cursor:0,windows:[...(sharedAllowed?[{id:windowId,name:'共同安排',role:'editor',color:'#7856bd',members:[]}]:[]),{id:viewerId,name:'仅查看窗口',role:'viewer',color:'#7856bd',members:[]}]};
  else if(path==='/api/social/events')return route.abort();
  else if(path.startsWith('/api/diaries/')){
   const d=path.slice('/api/diaries/'.length);
   if(req.method()==='PUT'){
    const input=req.postDataJSON();writes.push({path,date:d,input});
    if(failure==='timeout')return;
    if(failure&&(!failWriteAt||writes.length===failWriteAt)){const status=Number(failure);failure='';return route.fulfill({status,json:{error:status===409?'版本冲突，请重试':status===401?'登录失效':'正文校验失败',code:'TEST_ERROR',issues:[{path:'learn.content',message:'正文超出限制',code:'too_big'}],requestId:'test-request'}});}
    commit(d,input);
   }json={document:load(d),version:version(d),exists:true};
  }else if(path==='/api/capture/parse'){
   parses.push(req.postDataJSON());if(parseFailure)return route.fulfill({status:503,json:{error:'AI 暂不可用'}});
   json={today:date,timezone:'Asia/Shanghai',mode:'ai',drafts:[captureDraftSchema.parse({id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',kind:'plan',content:'AI 项目例会',date:'2026-10-26',time:'15:00',repeat:{type:'weekly',weekdays:[1]}}),captureDraftSchema.parse({id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',kind:'learn',content:'AI 学习记录',date:past,time:'20:00'})]};
  }else if(path==='/api/actions'&&req.method()==='POST'||path.endsWith('/actions')&&path.startsWith('/api/shared-windows/')){
   const input=req.postDataJSON();writes.push({path,input});
   if(failure==='timeout')return;
   if(failure&&(!failWriteAt||writes.length===failWriteAt)){const status=Number(failure);failure='';return route.fulfill({status,json:{error:status===409?'版本冲突，请重试':status===401?'登录失效':'标题校验失败',code:'TEST_ERROR',issues:[{path:'todos.0.title',message:'标题无效',code:'invalid_string'}],requestId:'test-request'}});}
   await new Promise(r=>setTimeout(r,80));
   if(path.startsWith('/api/shared-windows/'))return route.fulfill({json:{row:{windowId,windowName:'共同安排',role:'editor',date:input.date,version:'1',task:input.task,sourceExists:false,completionExists:false}}});
   const document=load(input.date);document.todos=document.todos.filter(t=>t.id!==input.task.id);document.todos.push(input.task);commit(input.date,document);json={diary:{document:load(input.date),version:version(input.date),exists:true}};
  }else if(path==='/api/actions'){if(refreshFails)return route.fulfill({status:503,json:{error:'列表刷新失败'}});json={tasks:tasks(),records:[]};}
  else if(path==='/api/schedule')json={tasks:tasks()};else if(path==='/api/shared-tasks')json={tasks:[]};
  else if(path==='/api/upload')json={path:'attachments/test.pdf',name:'test.pdf',size:8};
  else if(path==='/api/plan-categories')json={categories:[{id:'work',name:'工作',color:'#7bb4de',order:0},{id:'personal',name:'个人生活',color:'#c5a27e',order:1}]};
  else if(path==='/api/entities')json={entities:[]};else if(path==='/api/tags')json={tags:{person:[],place:[],activity:[],food:[],thing:[]}};else if(path==='/api/plan-views')json={views:[]};else if(path==='/api/tag-library')json={tags:[]};else if(path==='/api/quick-facts')json={facts:[]};else if(path==='/api/weeks')json={start:date,end:date,entries:[]};
  await route.fulfill({json});
 });
 const modal=()=>page.locator('.creation-dialog'),content=()=>modal().locator('[data-create-field=content]'),nav=name=>page.getByRole('navigation',{name:'主导航'}).getByRole('button',{name,exact:true}),kind=name=>modal().getByRole('group',{name:'创建类型'}).getByRole('button',{name,exact:true}),diaryKind=name=>modal().getByRole('group',{name:'日记类型'}).getByRole('button',{name,exact:true});
 const open=async()=>{await page.locator('.global-create').click();await modal().waitFor();await content().waitFor();while(await modal().locator('details.creation-group:not([open])>summary').count())await modal().locator('details.creation-group:not([open])>summary').first().click();};
 const close=async()=>{await modal().getByRole('button',{name:'取消新增',exact:true}).click();await modal().waitFor({state:'hidden'});await page.waitForFunction(()=>document.activeElement?.classList.contains('global-create'));};
 const fresh=async()=>{await page.evaluate(()=>{sessionStorage.clear();for(const key of Object.keys(localStorage))if(key.startsWith('diary.creation.')||key.startsWith('diary.draft.'))localStorage.removeItem(key);});docs=new Map();versions=new Map();account=1;failure='';failWriteAt=0;refreshFails=false;parseFailure=false;sharedAllowed=true;writes.length=0;parses.length=0;const document=emptyDiary(date);document.todos=[todoSchema.parse({id:'seed-task',title:'原有日程',dueDate:date,dueTime:'15:00'})];docs.set(date,document);await page.goto('http://127.0.0.1:4320/');try{await page.locator('.todo-panel[aria-busy=false]').waitFor({timeout:15000});}catch(error){throw new Error(String(error)+'\nPage: '+(await page.locator('body').innerText()).slice(0,4000));}};
 const check=async(name,fn)=>{if(process.env.QA_CASE&&!process.env.QA_CASE.split('|').some(part=>name.includes(part)))return;await fn();checks.push(name);console.log(width,theme,'PASS',name);};
 const shot=async name=>{if(!process.env.QA_FUNCTIONAL_ONLY){await page.mouse.move(1,1);await page.screenshot({path:`${output}/${width}-${theme}-${name}.png`,animations:'disabled'});}};
 const selectDate=async(label,value,scope=modal())=>{await scope.getByRole('button',{name:label,exact:true}).click();const popup=page.getByRole('dialog',{name:'选择'+label,exact:true});const [year,month,day]=value.split('-');for(const [part,text] of [['year',year],['month',month],['day',day]]){const segment=popup.locator(`[data-type=${part}]`).first();await segment.focus();await page.keyboard.type(String(Number(text)));}await popup.getByRole('button',{name:'确认',exact:true}).click();};
 try{
 await page.goto('http://127.0.0.1:4320/');await fresh();await open();
 await check('fullscreen shell, one action bar, stable footer and safe nested date controls',async()=>{
  const rect=await modal().boundingBox();assert(Math.abs(rect.x)<1&&Math.abs(rect.y)<1);assert.equal(Math.round(rect.width),width);assert.equal(Math.round(rect.height),900);assert.equal(await page.locator('.create-menu-dialog,.capture-backdrop').count(),0);assert.equal(await modal().getByRole('button',{name:'创建',exact:true}).count(),1);assert.equal(await modal().locator('.creation-header button[aria-label=取消新增]').count(),0);const cancelRect=await modal().getByRole('button',{name:'取消新增',exact:true}).boundingBox(),createRect=await modal().locator('.creation-submit').boundingBox();assert(Math.abs(cancelRect.y-createRect.y)<1&&createRect.x>cancelRect.x);assert(await page.locator('.global-navigation').evaluate(el=>!!el.closest('[inert]')));
  await content().fill('本地演示 · 新建安排');await modal().locator('[data-create-field=description]').fill('将需要处理的事情写清楚，稍后还可以补充。');
  const footer=modal().locator('.creation-footer'),before=await footer.boundingBox();await modal().locator('.creation-body').evaluate(el=>el.scrollTop=el.scrollHeight);const after=await footer.boundingBox();assert(Math.abs(before.y-after.y)<1);assert(after.y+after.height<=901);
  await modal().getByRole('button',{name:'截止时间',exact:true}).click();const popup=page.getByRole('dialog',{name:'选择截止时间',exact:true});await popup.waitFor();const r=await popup.boundingBox();assert(r.x>=7&&r.y>=7&&r.x+r.width<=width-7&&r.y+r.height<=893);await popup.getByRole('button',{name:'取消',exact:true}).click();
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await modal().locator('.creation-body').evaluate(el=>el.scrollTop=0);
 });await shot('plan');
 await check('check-in choice sits beside recurrence and survives cancel and reopen',async()=>{
  await modal().getByRole('radiogroup',{name:'重复频率',exact:true}).locator('.glass-choice').filter({hasText:/^每日$/}).click();await modal().getByRole('checkbox',{name:'加入打卡计划',exact:true}).check();await modal().locator('.repeat-fields').scrollIntoViewIfNeeded();const a=await modal().getByRole('checkbox',{name:'加入打卡计划',exact:true}).boundingBox(),b=await modal().locator('.repeat-fields legend').boundingBox();assert(a.x>b.x+b.width/2);assert.equal(writes.length,0);await close();await open();assert(await modal().getByRole('checkbox',{name:'加入打卡计划',exact:true}).isChecked());await modal().locator('.repeat-fields').scrollIntoViewIfNeeded();
 });await shot('checkin');
 await check('type switching and close/reopen preserve manual and AI text',async()=>{
  await modal().getByRole('textbox',{name:'AI 输入',exact:true}).fill('明天下午三点例会');await kind('日记').click();await diaryKind('新知').click();await content().fill('今天学到的新方法，留给下次使用。');await kind('日程').click();assert.equal(await content().inputValue(),'本地演示 · 新建安排');await close();assert.equal(await page.locator('.draft-dot').count(),1);await open();assert.equal(await content().inputValue(),'本地演示 · 新建安排');assert.equal(await modal().getByRole('textbox',{name:'AI 输入',exact:true}).inputValue(),'明天下午三点例会');await kind('日记').click();await diaryKind('新知').click();assert((await content().inputValue()).includes('新方法'));assert.equal(writes.length,0);assert.equal(parses.length,0);
 });await shot('diary');
 await check('short visual viewport and keyboard focus keep bottom operations reachable',async()=>{
  await page.setViewportSize({width,height:540});await page.waitForFunction(()=>Math.abs(document.querySelector('.creation-dialog').getBoundingClientRect().height-innerHeight)<1);const footer=await modal().locator('.creation-footer').boundingBox();assert(footer.y+footer.height<=541);if([375,1440].includes(width)&&theme==='light')await shot('short');await content().focus();await page.keyboard.press('Tab');assert(await page.evaluate(()=>!!document.activeElement?.closest('.creation-dialog')));assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.setViewportSize({width,height:900});await page.waitForFunction(()=>Math.abs(document.querySelector('.creation-dialog').getBoundingClientRect().height-innerHeight)<1);
 });
 if(process.env.QA_SCREENS_ONLY){await check('AI queue uses the same full screen and one create action',async()=>{await modal().getByRole('button',{name:'识别 AI 输入',exact:true}).click();await modal().getByRole('button',{name:/核对AI草稿$/}).waitFor();await page.waitForFunction(()=>document.querySelector('.creation-header [aria-pressed=true]')?.textContent==='日程');assert.equal(await modal().getByRole('button',{name:/一起创建/}).count(),1);assert.equal(writes.length,0);});await shot('ai-queue');}
 await close();
 await check('date selection shows only the selected day and restores calendar scroll',async()=>{
  const area=page.locator('.calendar-scroll'),button=page.getByRole('button',{name:`查看 ${date} 的日程`,exact:true});await button.scrollIntoViewIfNeeded();const before=await area.evaluate(el=>({top:el.scrollTop,left:el.scrollLeft}));await button.click();await page.getByRole('region',{name:`${date} 当天日程`,exact:true}).waitFor();assert(await page.locator('.calendar-timeline-shell').isHidden());assert.equal(await page.locator('.calendar-focused-day .calendar-chip').count(),1);assert.equal(await page.locator('.calendar-focused-day').evaluate(el=>getComputedStyle(el).position),'static');await shot('day');await page.getByRole('button',{name:'返回两周',exact:true}).click();await page.waitForFunction(before=>{const el=document.querySelector('.calendar-scroll');return Math.abs(el.scrollTop-before.top)<2&&Math.abs(el.scrollLeft-before.left)<2;},before);assert.equal(writes.length,0);
 });
 if(!process.env.QA_SCREENS_ONLY&&(width===375||width===1440)&&theme==='light'){
  await fresh();await check('entry defaults follow workspace, diary column and selected date',async()=>{
   for(const name of ['通讯','我的']){await nav(name).click();await open();assert.equal(await kind('日程').getAttribute('aria-pressed'),'true');await close();}
   await nav('日记').click();await selectDate('日记日期',past,page.locator('.diary-main-toolbar'));
   for(const name of ['事实','新知','输入','灵感']){
    if(width<900){await page.locator('.diary-column-selector .glass-select-trigger').click();await page.getByRole('option',{name:new RegExp('^'+name)}).click();}else await page.getByRole('tab',{name,exact:true}).click();
    await open();assert.equal(await diaryKind(name).getAttribute('aria-pressed'),'true');assert((await modal().getByRole('button',{name:'记录时间',exact:true}).innerText()).includes('2026/10/20'));await close();
   }
  });
  await fresh();await open();
  await check('AI IME guard and multiple drafts parse without writes; manual form survives',async()=>{
   await content().fill('手动内容保留');const ai=modal().getByRole('textbox',{name:'AI 输入',exact:true});await ai.fill('明天开会，昨天学会了新方法');await ai.dispatchEvent('keydown',{key:'Enter',code:'Enter',isComposing:true});assert.equal(parses.length,0);await ai.press('Shift+Enter');assert((await ai.inputValue()).endsWith('\n'));assert.equal(parses.length,0);await ai.press('Enter');await modal().getByRole('button',{name:/核对AI草稿$/}).waitFor();assert.equal(writes.length,0);assert.equal(parses.length,1);assert.equal(await content().inputValue(),'AI 项目例会');for(const id of ['classification','repeat'])assert.equal(await modal().locator('[data-create-group='+id+']').getAttribute('open'),'');await modal().getByRole('button',{name:'手动填写',exact:true}).click();assert.equal(await content().inputValue(),'手动内容保留');await selectCreationDraft(page,1);
   failure='409';failWriteAt=2;const create=modal().getByRole('button',{name:/一起创建/});await create.evaluate(b=>{b.click();b.click();});await modal().locator('.creation-error').waitFor();assert.equal(await content().inputValue(),'AI 学习记录');assert.equal(await modal().locator('.plan-entities-edit').count(),1);assert.equal(writes.length,2);assert.equal(writes[0].input.task.dueDate,'2026-10-26');
   await modal().getByRole('button',{name:/一起创建/}).click();await modal().waitFor({state:'hidden'});assert.equal(writes.length,3);assert.equal(writes.filter(w=>w.path==='/api/actions').length,1);assert.equal(load(past).entries.learn[0].content,'AI 学习记录');assert.equal(await page.locator('.app-shell').getAttribute('data-main-page'),'plan');await open();assert.equal(await content().inputValue(),'手动内容保留');await close();

  });
  await fresh();await open();
  await check('successive AI submissions append four unique drafts and create once as one batch',async()=>{
   const input=modal().getByRole('textbox',{name:'AI 输入',exact:true});await input.fill('第一批安排');await input.press('Enter');await modal().getByRole('button',{name:/核对AI草稿$/}).waitFor();await content().fill('第一条保留修改');await input.fill('第二批安排');await input.press('Enter');await modal().getByRole('button',{name:'AI草稿 · 4',exact:true}).waitFor();assert.equal(parses.length,2);assert.equal(writes.length,0);assert.equal(await input.inputValue(),'');await selectCreationDraft(page,1);assert.equal(await content().inputValue(),'第一条保留修改');await close();await page.reload();await open();await selectCreationDraft(page,3);await modal().getByRole('button',{name:/一起创建/}).evaluate(b=>{b.click();b.click();});await modal().waitFor({state:'hidden'});assert.equal(writes.length,4);const tasks=load(date).todos;assert.equal(tasks.filter(t=>t.title!=='原有日程').length,2);assert.equal(load(past).entries.learn.length,2);assert.equal(new Set([...tasks.map(t=>t.id),...load(past).entries.learn.map(e=>e.id)]).size,5);
  });
  await fresh();await open();
  await check('manual check-in membership persists in the existing create request',async()=>{
   await content().fill('每日阅读打卡');await modal().getByRole('radiogroup',{name:'重复频率',exact:true}).locator('.glass-choice').filter({hasText:/^每日$/}).click();await modal().getByRole('checkbox',{name:'加入打卡计划',exact:true}).check();await modal().getByRole('button',{name:'创建',exact:true}).click();await modal().waitFor({state:'hidden'});assert.equal(writes.length,1);assert.equal(writes[0].input.task.checkinEnabled,true);assert.equal(writes[0].input.task.repeat.type,'daily');
  });
  await fresh();await open();
  await check('speech input creates editable drafts, cancelling keeps prior text',async()=>{
   await modal().getByRole('textbox',{name:'AI 输入',exact:true}).fill('原有文字');await modal().getByRole('button',{name:'语音输入',exact:true}).click();await modal().getByRole('button',{name:'取消语音输入',exact:true}).click();assert.equal(await modal().getByRole('textbox',{name:'AI 输入',exact:true}).inputValue(),'原有文字');await modal().getByRole('button',{name:'语音输入',exact:true}).click();await modal().getByRole('button',{name:'停止并整理',exact:true}).click();await modal().getByRole('button',{name:/核对AI草稿$/}).waitFor();assert.equal(parses.length,1);assert.equal(writes.length,0);await close();
  });
  await fresh();await open();
  await check('failed AI retains original text and requires review before creating',async()=>{
   parseFailure=true;await modal().getByRole('textbox',{name:'AI 输入',exact:true}).fill('需要保留的原文');await modal().getByRole('button',{name:'识别 AI 输入',exact:true}).click();await modal().locator('.creation-review').waitFor();await modal().getByRole('button',{name:/一起创建/}).click();assert.equal(writes.length,0);await modal().locator('.creation-review input').click();await modal().locator('.creation-review').waitFor({state:'hidden'});assert.equal(await modal().getByRole('textbox',{name:'AI 输入',exact:true}).inputValue(),'需要保留的原文');await close();
  });
  await fresh();await open();
  await check('reload restores local draft; another account does not see it',async()=>{
   await content().fill('账号一的未提交内容');await close();await page.reload();await open();assert.equal(await content().inputValue(),'账号一的未提交内容');await close();account=2;await page.reload();await open();assert.equal(await content().inputValue(),'');await close();account=1;await page.reload();await open();assert.equal(await content().inputValue(),'账号一的未提交内容');await close();
  });
  await fresh();await nav('日记').click();await open();
  await check('all diary kinds, past-date ownership, attachment and long text retain original contracts',async()=>{
   assert.equal(await kind('日记').getAttribute('aria-pressed'),'true');await diaryKind('输入').click();await selectDate('记录时间',past);const text='中😀'.repeat(4500);await content().fill(text);assert.equal(await content().inputValue(),text);await modal().locator('input[type=file]').setInputFiles({name:'test.pdf',mimeType:'application/pdf',buffer:Buffer.from('test pdf')});await page.waitForFunction(()=>document.querySelector('.creation-attachments a')?.textContent==='test.pdf');await modal().getByRole('button',{name:'创建',exact:true}).click();await modal().waitFor({state:'hidden'});assert.equal(load(past).entries.input[0].content,text);assert.equal(load(past).entries.input[0].attachments[0].name,'test.pdf');assert.equal(await page.locator('.app-shell').getAttribute('data-main-page'),'diary');
   for(const kindName of ['事实','新知','灵感']){await open();await diaryKind(kindName).click();await content().fill(kindName+'记录');await modal().getByRole('button',{name:'创建',exact:true}).click();await modal().waitFor({state:'hidden'});}assert.equal(writes.length,4);
  });
  await fresh();await open();
  await check('over-limit paste and merged body reject writes and focus the content',async()=>{
   await content().fill('长'.repeat(2001));await modal().getByRole('button',{name:'创建',exact:true}).click();assert.equal(writes.length,0);await page.waitForFunction(()=>document.activeElement?.getAttribute('data-create-field')==='content');assert.equal((await content().inputValue()).length,2001);await kind('日记').click();await diaryKind('新知').click();const owner=load(date);owner.learn.content='旧'.repeat(30000);docs.set(date,owner);await content().fill('新'.repeat(25000));await modal().getByRole('button',{name:'创建',exact:true}).click();await modal().locator('.creation-error').waitFor();assert.equal(writes.length,0);assert.equal((await content().inputValue()).length,25000);await close();
  });
  for(const code of ['400','409','timeout','401']){
   await fresh();await open();await check(code+' failure keeps content, identity and allows retry',async()=>{
    await content().fill('失败后继续创建');failure=code;const sent=page.waitForRequest(req=>req.method()==='POST'&&new URL(req.url()).pathname==='/api/actions');await modal().getByRole('button',{name:'创建',exact:true}).click();await sent;if(code==='timeout')await page.clock.runFor(15100);
    if(code==='401'){const login=page.getByRole('dialog',{name:'重新登录',exact:true});await login.waitFor();await login.getByLabel('用户名').fill('test');await login.getByLabel('密码').fill('password');await login.locator('form button[type=submit]').click();await login.waitFor({state:'hidden'});}await modal().locator('.creation-error').waitFor();assert.equal(await content().inputValue(),'失败后继续创建');const id=writes[0].input.task.id;failure='';await modal().locator('.creation-submit').click();await modal().waitFor({state:'hidden'});assert.equal(writes.at(-1).input.task.id,id);assert.equal(load(date).todos.filter(t=>t.id===id).length,1);
   });
  }
  await fresh();await open();await check('refresh failure remains successful with a separate retry',async()=>{await content().fill('已保存，不因刷新失败回退');refreshFails=true;await modal().getByRole('button',{name:'创建',exact:true}).click();await modal().waitFor({state:'hidden'});assert.equal(writes.length,1);assert.equal(load(date).todos.length,2);await page.getByRole('button',{name:'重试刷新',exact:true}).waitFor();refreshFails=false;await page.getByRole('button',{name:'重试刷新',exact:true}).click();assert.equal(writes.length,1);});
  await fresh();await check('calendar pending preview survives creation and retains its original location',async()=>{await dragCalendar(page,{id:'seed-task',targetDate:'2026-10-26',time:'15:15',touch:width<900});await page.getByRole('button',{name:'确认改期',exact:true}).waitFor();await open();await page.keyboard.press('Escape');await modal().waitFor({state:'hidden'});await page.getByRole('button',{name:'确认改期',exact:true}).waitFor();await open();await content().fill('预览期间新增');await modal().getByRole('button',{name:'创建',exact:true}).click();await modal().waitFor({state:'hidden'});assert.equal(writes.length,1);await page.getByRole('button',{name:'确认改期',exact:true}).waitFor();assert.equal(await page.locator('.calendar-chip[data-record-id=seed-task][data-pending=true]').count(),1);await page.keyboard.press('Escape');});
  await fresh();await check('focused day keeps drag preview and cancellation without saving',async()=>{
   await page.getByRole('button',{name:`查看 ${date} 的日程`,exact:true}).click();await page.locator('.calendar-focused-day').waitFor();await dragCalendar(page,{id:'seed-task',targetDate:'2026-10-26',time:'15:15',touch:width<900,focused:true});await page.getByRole('region',{name:'2026-10-26 当天日程',exact:true}).waitFor();assert.equal(await page.locator('.calendar-focused-day .calendar-chip[data-pending=true]').count(),1);assert.equal(writes.length,0);await page.keyboard.press('Escape');assert.equal(await page.locator('.calendar-focused-day .calendar-chip').count(),0);await page.getByRole('button',{name:'返回两周',exact:true}).click();assert.equal(await page.locator('.calendar-timeline-row[data-date="2026-10-25"] .calendar-chip[data-record-id=seed-task]').count(),1);await page.getByRole('button',{name:`查看 ${date} 的日程`,exact:true}).click();await page.getByRole('button',{name:'今天',exact:true}).click();await page.locator('.calendar-timeline-shell').waitFor();assert.equal(await page.locator('.calendar-focused-day').count(),0);
  });
  await fresh();await open();await check('shared choice excludes viewers and revocation preserves draft',async()=>{await content().fill('共同安排草稿');await modal().locator('.shared-scope .glass-select-trigger').click();assert.equal(await page.getByRole('option',{name:/仅查看窗口/}).count(),0);await page.getByRole('option',{name:'共享 · 共同安排',exact:true}).click();sharedAllowed=false;await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));await modal().getByRole('button',{name:'改为私人日程',exact:true}).waitFor();assert(await modal().getByRole('button',{name:'创建',exact:true}).isDisabled());assert.equal(await content().inputValue(),'共同安排草稿');await modal().getByRole('button',{name:'改为私人日程',exact:true}).click();assert.equal(writes.length,0);await close();});
 }
 assert.deepEqual(errors,[]);results.push({width,theme,checks,errors});
 }catch(e){results.push({width,theme,checks,errors,error:e.stack});throw e;}finally{await page.close();}
}}finally{await browser.close();await writeFile(output+'/results.json',JSON.stringify(results,null,2));}
