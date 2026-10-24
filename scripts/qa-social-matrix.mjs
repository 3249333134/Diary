import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {emptyDiary,todoSchema} from '../packages/contracts/dist/index.js';
const shift=(date,n)=>{const d=new Date(date+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10);};
export async function matrix(browser,base,output,people,date){
 const results=[];
 for(const width of [375,624,768,1280,1440])for(const theme of ['light','dark']){
  if(process.env.QA_WIDTH&&Number(process.env.QA_WIDTH)!==width||process.env.QA_THEME&&process.env.QA_THEME!==theme)continue;
  const page=await browser.newPage({viewport:{width,height:900},hasTouch:width<900});page.setDefaultTimeout(7000);const checks=[],errors=[];
  page.on('pageerror',e=>errors.push(e.message));await page.addInitScript(theme=>localStorage.setItem('diary.theme',theme),theme);await page.clock.install({time:new Date(date+'T04:00:00Z')});
  const monday=shift(date,-((new Date(date+'T00:00:00Z').getUTCDay()+6)%7)),window={id:randomUUID(),name:'家庭安排',color:'#7963bd',version:'v0',role:'owner',members:[{...people[0].profile,role:'owner',status:'active'},{...people[1].profile,role:'editor',status:'active'}]};
  const social={profile:people[0].profile,friends:[people[1].profile],requests:[],invitations:[],windows:[window],notices:[],cursor:0};
  const diaries=new Map();
  const rows=Array.from({length:14},(_,i)=>({date,version:'v0',task:todoSchema.parse({id:'matrix-'+i,title:i%2?'每周共同阅读与复盘':'准备日常生活与项目材料',dueDate:shift(monday,i),dueTime:i%2?'20:00':'15:00',important:i%4<2,urgent:i%2===0,category:i%3?'work':'personal'}),sourceExists:false,completionExists:false,...i%2?{windowId:window.id,windowName:window.name,role:'owner'}:{}}));
  await page.route('**/api/**',async route=>{const p=new URL(route.request().url()).pathname;let json={};
   if(p==='/api/social/events')return route.abort();
   if(p==='/api/auth/me')json={id:1,username:'本地演示'};else if(p==='/api/social')json=social;else if(p==='/api/demo/accounts')json={accounts:[]};
   else if(p.startsWith('/api/diaries/')){const day=p.split('/').at(-1);if(route.request().method()==='PUT')diaries.set(day,route.request().postDataJSON());json={document:diaries.get(day)||emptyDiary(day),version:'v0',exists:true};}
   else if(p==='/api/actions'||p==='/api/schedule')json={tasks:rows.filter(r=>!r.windowId),records:[]};else if(p==='/api/shared-tasks')json={tasks:rows.filter(r=>r.windowId)};
   else if(p==='/api/plan-categories')json={categories:[{id:'work',name:'工作',color:'#7bb4de',order:0},{id:'personal',name:'个人生活',color:'#c5a27e',order:1}]};
   else if(p==='/api/entities')json={entities:[]};else if(p==='/api/tags')json={tags:{person:[],place:[],activity:[],food:[],thing:[]}};
   else if(p==='/api/weeks')json={start:date,end:date,entries:[]};else if(p==='/api/plan-views')json={views:[]};else if(p==='/api/quick-facts')json={facts:[]};else if(p==='/api/tag-library')json={tags:[]};
   else if(p==='/api/capture/parse')return route.fulfill({status:503,json:{error:'模拟 AI 失败'}});await route.fulfill({json});
  });
  const nav=name=>page.getByRole('navigation',{name:'主导航'}).getByRole('button',{name,exact:true});
  const select=async(scope,label)=>{await scope.locator('.glass-select-trigger').click();await page.getByRole('option',{name:label,exact:true}).click();};
  const check=async(name,fn)=>{try{await fn();checks.push({name,passed:true});console.log(width,theme,'PASS',name);}catch(e){checks.push({name,passed:false,error:e.stack});console.log(width,theme,'FAIL',name,e.message);await page.keyboard.press('Escape');}};
  const shot=async name=>{if(!process.env.QA_FUNCTIONAL_ONLY)await page.screenshot({path:`${output}/${width}-${theme}-${name}.png`});};
  await page.goto(base);await page.locator('.calendar-timeline-row').first().waitFor();
  await check('single navigation, central create, compact calendar and no overflow',async()=>{
   assert.equal(await page.locator('.global-navigation').count(),1);assert.equal(await page.locator('.capture-mobile-bar,.compact-browse-bar,.workspace-switch').count(),0);
   const rect=await page.locator('.global-create').boundingBox(),bar=await page.locator('.global-navigation').boundingBox();assert(Math.abs(rect.x+rect.width/2-bar.x-bar.width/2)<2);assert(rect.width>=44&&rect.height>=44);
   const g=await page.evaluate(()=>({top:document.querySelector('.calendar-scroll').getBoundingClientRect().top,gap:document.querySelector('.workspace-footer').getBoundingClientRect().top-document.querySelector('.todo-panel').getBoundingClientRect().bottom,overflow:document.documentElement.scrollWidth>innerWidth}));assert(g.top<=150);assert(Math.abs(g.gap-8)<1);assert(!g.overflow);await shot('schedule');
   await page.locator('.global-create').click();await page.getByRole('dialog',{name:'新建',exact:true}).waitFor();await shot('create-menu');await page.getByRole('button',{name:'关闭新建',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.global-create')===document.activeElement);
  });
  await check('central form, shared scope and cancel focus',async()=>{
   await page.locator('.global-create').click();await page.getByRole('dialog',{name:'新建',exact:true}).getByRole('button',{name:/^新建日程/}).click();const dialog=page.getByRole('dialog',{name:'计划编辑',exact:true});await select(dialog.locator('.shared-scope'),'共享 · 家庭安排');assert.equal(await dialog.getByRole('radiogroup',{name:'事项类别'}).count(),0);await dialog.getByLabel('标题',{exact:true}).fill('一起阅读');await shot('schedule-form');await dialog.getByRole('button',{name:'取消',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.global-create')===document.activeElement);
  });
  await check('diary columns preserve unsent text across main navigation',async()=>{
   await nav('日记').click();await page.locator('.diary-main-toolbar').waitFor();if(width<900){const label=page.locator('.diary-column-selector .glass-select-trigger>span');assert((await label.boundingBox()).height<24,'column label stays on one line');assert(await page.locator('.diary-main-toolbar').evaluate(el=>el.scrollWidth<=el.clientWidth+1));}assert.equal(await page.locator('.workspace-footer [role=tablist]').count(),0);
   const labels=['事实','新知','输入','灵感'];
   for(let i=0;i<4;i++){if(width<900){await page.locator('.diary-column-selector .glass-select-trigger').click();await page.getByRole('option',{name:new RegExp(labels[i])}).first().click();}else await page.getByRole('tab',{name:labels[i],exact:true}).click();
    const body=page.locator('.workspace-panel[data-active=true] .diary-panel-body');assert((await body.boundingBox()).y<=150);if(i===0)await shot('diary');else{const input=body.locator('.diary-entry-composer textarea');await input.fill('尚未提交的栏目 '+i);await nav('通讯').click();await nav('日记').click();assert.equal(await input.inputValue(),'尚未提交的栏目 '+i);}}
  });
  await check('AI failure retains original and draft through all main pages',async()=>{
   await page.locator('.global-create').click();await page.getByRole('dialog',{name:'新建',exact:true}).getByRole('button',{name:/AI 记一句话/}).click();const text=page.locator('#capture-text');await text.fill('这段原文需要保留');await page.getByRole('button',{name:'整理为草稿',exact:true}).click();await page.getByText('模拟 AI 失败',{exact:false}).waitFor();await page.getByRole('button',{name:'收起',exact:true}).click();for(const label of ['通讯','我的','日程','日记'])await nav(label).click();assert.equal(await page.locator('.global-create .draft-dot').count(),1);await page.locator('.global-create').click();await page.getByRole('dialog',{name:'新建',exact:true}).getByRole('button',{name:/AI 记一句话/}).click();assert.equal(await text.inputValue(),'这段原文需要保留');await page.getByRole('button',{name:'收起',exact:true}).click();
  });
  await check('central diary creation uses selected date and information validation remains reachable',async()=>{
   await nav('日记').click();await page.getByRole('button',{name:'前一天',exact:true}).click();await page.waitForTimeout(120);
   await page.locator('.global-create').click();await page.getByRole('dialog',{name:'新建',exact:true}).getByRole('button',{name:/^写日记/}).click();await page.getByRole('dialog',{name:'新建',exact:true}).getByRole('button',{name:'事实',exact:true}).click();
   const field=page.locator('.workspace-panel[data-active=true] .event-block textarea').first();await field.fill('来自底部新增的事实');await page.getByRole('button',{name:'保存日记',exact:true}).click();await page.waitForTimeout(150);assert.equal(diaries.get(shift(date,-1)).facts.events[0].note,'来自底部新增的事实');
   if(width<900){await page.locator('.diary-column-selector .glass-select-trigger').click();await page.getByRole('option',{name:'编辑今日信息',exact:true}).click();}else await page.getByRole('button',{name:'编辑今日信息',exact:true}).click();
   const note=page.locator('[data-field="facts.note"]');await note.fill('字'.repeat(20001));await page.getByRole('button',{name:'完成编辑',exact:true}).click();await page.getByRole('button',{name:'保存日记',exact:true}).click();await note.waitFor({state:'visible'});assert.equal(await note.inputValue(),'字'.repeat(20001));await note.fill('已保留完整草稿');await page.getByRole('button',{name:'完成编辑',exact:true}).click();await page.getByRole('button',{name:'保存日记',exact:true}).click();
  });
  await check('communications, account, shared windows, full screen and short viewport',async()=>{
   await nav('通讯').click();await page.getByRole('heading',{name:'通讯',exact:true}).waitFor();assert.equal(await page.locator('.receipt-notice').count(),0);await shot('communications');await nav('我的').click();await page.getByRole('heading',{name:'我的',exact:true}).waitFor();assert.equal(await page.getByLabel('我的好友码').inputValue(),people[0].profile.code);await shot('my-account');
   await nav('日程').click();await page.getByRole('navigation',{name:'计划视图'}).getByRole('button',{name:'窗口',exact:true}).click();await page.locator('.plan-window').filter({hasText:'家庭安排'}).waitFor();await shot('windows');await page.setViewportSize({width,height:560});await page.getByRole('button',{name:'全屏显示',exact:true}).click();await page.getByRole('button',{name:'退出全屏',exact:true}).click();assert(await page.locator('.global-navigation').evaluate(e=>e.getBoundingClientRect().bottom<=innerHeight));assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await shot('short');
  });
  results.push({kind:'matrix',width,theme,checks,errors});await page.close();
 }
 return results;
}
