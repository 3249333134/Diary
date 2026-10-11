import { chromium } from 'playwright-core';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const base='http://127.0.0.1:4320';
const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
await mkdir('qa/plans',{recursive:true});const results=[];
const get=async route=>{const r=await fetch(base+route);assert(r.ok);return r.json();};
const post=async(route,input)=>{const r=await fetch(base+route,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(input)});const out=await r.json();assert(r.ok,JSON.stringify(out));return out;};
try{
  for(const width of [375,768,1440])for(const theme of ['light','dark']){
    const page=await browser.newPage({viewport:{width,height:900}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.addInitScript(theme=>localStorage.setItem('diary.theme',theme),theme);
    await page.goto(base);await page.getByRole('button',{name:'计划',exact:true}).click();await page.locator('.plan-board .plan-card').first().waitFor();
    const layout=await page.evaluate(()=>({outer:document.documentElement.scrollHeight<=innerHeight+2,horizontal:document.documentElement.scrollWidth<=innerWidth+2,boardHeight:document.querySelector('.plan-board-scroll').clientHeight,boardOverflow:document.querySelector('.plan-board-scroll').scrollHeight>document.querySelector('.plan-board-scroll').clientHeight}));
    assert(layout.horizontal);if(width<900){assert(layout.outer);assert(layout.boardHeight>120);assert(layout.boardOverflow);}
    assert.equal(await page.locator('.plan-quadrant').count(),5);assert.deepEqual(errors,[]);
    await page.screenshot({path:`qa/plans/${width}-${theme}.png`,fullPage:true});results.push({width,theme,layout,errors});await page.close();
  }
  const seed=(await get('/api/actions')).tasks[0];const owner=await get(`/api/diaries/${seed.date}`);
  const fixture={...seed.task,id:crypto.randomUUID(),title:'浏览器验收计划',category:'work',important:true,urgent:true,done:false,status:'todo',dueDate:'2000-01-01',source:undefined,completion:undefined,deletedAt:undefined};
  await post('/api/actions',{mode:'create',date:seed.date,version:owner.version,task:fixture,operationId:crypto.randomUUID()});
  const page=await browser.newPage({viewport:{width:1440,height:1000}});await page.goto(base);await page.getByRole('button',{name:'计划',exact:true}).click();await page.locator('.plan-card').first().waitFor();
  const rows=(await get('/api/actions')).tasks;const row=rows.find(r=>r.task.id===fixture.id);assert(row);
  const card=page.locator(`[data-plan-id="${row.task.id}"]`);
  await page.locator('.plan-board-scroll').scrollIntoViewIfNeeded();
  const handle=card.locator('.plan-drag-handle');const box=await handle.boundingBox();const target=await page.locator('.plan-quadrant.q2 h3').boundingBox();
  await page.mouse.move(box.x+20,box.y+20);await page.mouse.down();await page.mouse.move(target.x+40,target.y+10,{steps:12});await page.mouse.up();
  await page.waitForFunction(id=>document.querySelector(`.q2 [data-plan-id="${id}"]`),row.task.id);
  let latest=(await get('/api/actions')).tasks.find(r=>r.task.id===row.task.id);assert.equal(latest.task.important,true);assert.equal(latest.task.urgent,false);
  await card.locator('.plan-card-summary').click();await card.getByRole('combobox',{name:/移动到：/}).click();await page.getByRole('option',{name:'个人生活',exact:true}).click();await page.waitForFunction(id=>document.querySelector(`[data-plan-id="${id}"]`).classList.contains('category-personal'),row.task.id);
  await card.getByRole('checkbox').click();await card.getByRole('button',{name:'查看日记',exact:true}).waitFor();
  latest=(await get('/api/actions')).tasks.find(r=>r.task.id===row.task.id);assert(latest.task.completion);assert.equal(latest.task.done,true);
  const diary=await get(`/api/diaries/${latest.task.completion.date}`);const fact=diary.document.facts.events.find(e=>e.id===latest.task.completion.id);assert(fact);assert.deepEqual(fact.plannedStart,{date:row.task.startDate,time:row.task.startTime});
  await post('/api/actions',{mode:'complete',automaticRecord:true,date:latest.date,version:row.version,task:latest.task,operationId:crypto.randomUUID()});
  assert.equal((await get(`/api/diaries/${latest.task.completion.date}`)).document.facts.events.filter(e=>e.id===fact.id).length,1);
  await page.route('**/api/actions',async route=>{if(route.request().method()==='POST'){await route.fulfill({status:409,contentType:'application/json',body:JSON.stringify({error:'模拟版本冲突'})});await page.unroute('**/api/actions');}else await route.continue();});
  await card.getByRole('combobox',{name:/移动到：/}).click();await page.getByRole('option',{name:'工作',exact:true}).click();await page.locator('.plan-retry').waitFor();assert((await get('/api/actions')).tasks.find(r=>r.task.id===row.task.id).task.category==='personal');
  await page.getByRole('button',{name:'重试归类',exact:true}).click();await page.waitForFunction(id=>document.querySelector(`[data-plan-id="${id}"]`).classList.contains('category-work'),row.task.id);
  if(await page.getByRole('button',{name:'筛选计划',exact:true}).isVisible()){await page.getByRole('button',{name:'筛选计划',exact:true}).click();await page.getByRole('button',{name:'展开完整顶部',exact:true}).click();}
  await page.getByRole('button',{name:'筛选计划',exact:true}).click();await page.getByRole('button',{name:'新建视图',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'编辑标签视图'});await dialog.locator('.field input').first().fill('验收标签视图');await dialog.getByLabel('共享标签',{exact:true}).fill(row.task.tags[0]);await dialog.getByLabel('共享标签',{exact:true}).press('Enter');await dialog.getByRole('button',{name:'保存视图',exact:true}).click();
  const view=(await get('/api/plan-views')).views.find(v=>v.name==='验收标签视图');assert(view);await page.getByRole('combobox',{name:'标签视图',exact:true}).click();await page.getByRole('option',{name:view.name,exact:true}).click();
  const ids=await page.locator('.plan-card').evaluateAll(cards=>cards.map(c=>c.dataset.planId));const current=(await get('/api/actions')).tasks;assert(ids.every(id=>current.find(r=>r.task.id===id).task.tags.includes(row.task.tags[0])));await page.getByRole('combobox',{name:'标签视图',exact:true}).click();await page.getByRole('option',{name:'全部标签',exact:true}).click();
  await page.getByRole('dialog',{name:'筛选计划',exact:true}).getByRole('button',{name:/显示 .* 项/}).click();await card.getByRole('button',{name:'查看日记',exact:true}).click();await page.locator(`[data-record-id="${fact.id}"]`).waitFor();
  await page.getByRole('button',{name:'计划',exact:true}).click();
  await page.locator('.unified-capture textarea').first().fill('今天与张三讨论资料，明天下午三点工作开会');await page.getByRole('button',{name:'整理为草稿',exact:true}).click();await page.locator('.capture-fields').nth(1).waitFor();
  assert.equal(await page.locator('.capture-fields').count(),2);const parse=await post('/api/capture/parse',{text:'模拟失败'});assert.equal(parse.mode,'manual');assert.equal(parse.drafts[0].needsReview,true);
  await page.close();
  const touch=await browser.newPage({viewport:{width:375,height:900},hasTouch:true});await touch.goto(base);await touch.getByRole('button',{name:'计划',exact:true}).click();await touch.locator('.plan-drag-handle').first().waitFor();
  const h=touch.locator('.plan-drag-handle').first();const id=await h.evaluate(el=>el.closest('[data-plan-id]').dataset.planId);const hb=await h.boundingBox();const cdp=await touch.context().newCDPSession(touch);
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:hb.x+20,y:hb.y+20}]});await touch.waitForTimeout(400);assert.equal(await touch.locator('.plan-drag-preview').count(),1);
  const tab=await touch.locator('[data-plan-drop="work"]').boundingBox();
  await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:tab.x+20,y:tab.y+20}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await touch.waitForFunction(id=>document.querySelector(`[data-plan-id="${id}"]`).classList.contains('category-work'),id);await touch.close();
  results.push({interaction:'desktop drag, move menu, conflict retry, shared tag view, auto diary, duplicate retry, diary navigation, mixed AI, failed AI fallback, simulated touch long press',passed:true});
  await writeFile('qa/plans/results.json',JSON.stringify(results,null,2));console.log(JSON.stringify(results,null,2));
}finally{await browser.close();}
