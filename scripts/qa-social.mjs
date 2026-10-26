import {chromium} from 'playwright-core';
import {spawn} from 'node:child_process';
import {mkdir,mkdtemp,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {todoSchema} from '../packages/contracts/dist/index.js';
import {dragCalendar} from './calendar-drag.mjs';
const output='qa/social/'+(process.env.QA_FUNCTIONAL_ONLY?'functional':process.env.QA_CONFIRM?'confirmation':'initial');await mkdir(output,{recursive:true});
const temp=await mkdtemp(path.join(tmpdir(),'diary-social-qa-')),base='http://127.0.0.1:4321';
const server=spawn(process.execPath,['scripts/qa-social-server.mjs'],{cwd:process.cwd(),env:{...process.env,SOCIAL_QA_DB:path.join(temp,'diary.sqlite'),SOCIAL_QA_PORT:'4321'},windowsHide:true,stdio:['ignore','pipe','pipe']});
let serverLog='';server.stdout.on('data',d=>serverLog+=d);server.stderr.on('data',d=>serverLog+=d);
let browser;const results=[],date=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const shift=(date,n)=>{const d=new Date(date+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10);};
const wait=async(fn,label)=>{for(let i=0;i<60;i++){const value=await fn();if(value)return value;await new Promise(r=>setTimeout(r,100));}throw new Error('Timed out: '+label);};
try{
 await wait(async()=>{try{return(await fetch(base+'/api/health')).ok;}catch{return false;}},'isolated server');
 browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
 const errors=[],checks=[],contexts=await Promise.all([1,2,3].map(()=>browser.newContext({viewport:{width:624,height:900},hasTouch:true})));
 const pages=await Promise.all(contexts.map(c=>c.newPage()));for(const page of pages){page.setDefaultTimeout(8000);page.on('pageerror',e=>errors.push(e.message));}
 const call=async(ctx,url,method='GET',body)=>{const res=await ctx.request.fetch(base+url,{method,...body?{data:body}:{}});const data=await res.json();assert(res.ok(),JSON.stringify({url,status:res.status(),data}));return data;};
 const snapshot=ctx=>call(ctx,'/api/social'),accounts=(await call(contexts[0],'/api/demo/accounts')).accounts;
 await call(contexts[1],'/api/demo/account','POST',{code:accounts.find(a=>a.name==='演示好友小林').code});await call(contexts[2],'/api/demo/account','POST',{code:accounts.find(a=>a.name==='演示好友小周').code});
 const people=await Promise.all(contexts.map(snapshot)),[owner,editor,viewer]=pages;for(const page of pages)await page.goto(base);
 const nav=(page,name)=>page.getByRole('navigation',{name:'主导航'}).getByRole('button',{name,exact:true});
 const select=async(page,scope,label)=>{await scope.locator('.glass-select-trigger').click();await page.getByRole('option',{name:label,exact:true}).click();};
 const check=async(name,fn)=>{await fn();checks.push({name,passed:true});console.log('real PASS',name);};
 await check('friend code requests approved through communications',async()=>{
  await nav(owner,'通讯').click();await owner.getByPlaceholder('输入对方的专属好友码').fill(people[1].profile.code);await owner.getByRole('button',{name:'发送申请',exact:true}).click();
  await nav(editor,'通讯').click();await editor.getByRole('button',{name:/申请与邀请/}).click();await editor.getByRole('button',{name:'同意',exact:true}).click();await wait(async()=>(await snapshot(contexts[0])).friends.length===1,'friend approved');
  await owner.getByPlaceholder('输入对方的专属好友码').fill(people[2].profile.code);await owner.getByRole('button',{name:'发送申请',exact:true}).click();await nav(viewer,'通讯').click();await viewer.getByRole('button',{name:/申请与邀请/}).click();await viewer.getByRole('button',{name:'同意',exact:true}).click();await wait(async()=>(await snapshot(contexts[0])).friends.length===2,'second friend');
 });
 let win,taskId;
 await check('create shared window and invite editor and viewer',async()=>{
  await nav(owner,'日程').click();await owner.getByRole('navigation',{name:'计划视图'}).getByRole('button',{name:'窗口',exact:true}).click();await owner.getByRole('button',{name:'新建共享窗口',exact:true}).click();
  const form=owner.getByRole('dialog',{name:'新建共享窗口',exact:true});await form.getByLabel('窗口名称',{exact:true}).fill('周末一起安排');await form.getByRole('button',{name:'创建并邀请好友',exact:true}).click();win=await wait(async()=>(await snapshot(contexts[0])).windows[0],'window created');
  const dialog=owner.getByRole('dialog',{name:'共享窗口成员',exact:true});await dialog.waitFor();
  await select(owner,dialog.locator('.shared-invite'),people[1].profile.name);await dialog.getByRole('radiogroup',{name:'邀请权限'}).getByText('可协作',{exact:true}).click();await dialog.getByRole('button',{name:'发送窗口邀请',exact:true}).click();await wait(async()=>(await snapshot(contexts[1])).invitations.length===1,'invitation');
  await select(owner,dialog.locator('.shared-invite'),people[2].profile.name);await dialog.getByRole('radiogroup',{name:'邀请权限'}).getByText('仅查看',{exact:true}).click();await dialog.getByRole('button',{name:'发送窗口邀请',exact:true}).click();await dialog.getByRole('button',{name:'关闭',exact:true}).click();
  for(const page of [editor,viewer]){await page.getByRole('button',{name:/申请与邀请/}).click();await page.getByRole('button',{name:'接受',exact:true}).click();}await wait(async()=>(await snapshot(contexts[0])).windows[0]?.members.filter(m=>m.status==='active').length===3,'members');
  const privateColumns=()=>owner.locator('.plan-window[data-window-id]');
  assert.equal(await privateColumns().count(),2,'creating a shared window preserves work and personal columns');
  assert.equal(await owner.getByRole('button',{name:'显示全部窗口',exact:true}).count(),0,'creation does not silently enable a window filter');
  await owner.getByRole('button',{name:'筛选计划',exact:true}).click();
  await select(owner,owner.getByRole('dialog',{name:'筛选计划',exact:true}).locator('.plan-filter-section').filter({has:owner.getByRole('heading',{name:'共享窗口',exact:true})}).locator('.glass-select'),win.name);
  await owner.getByRole('button',{name:'关闭计划筛选',exact:true}).click();
  assert.equal(await privateColumns().count(),0);await owner.getByText('仅显示：'+win.name,{exact:true}).waitFor();
  await owner.getByRole('button',{name:'显示全部窗口',exact:true}).click();assert.equal(await privateColumns().count(),2);

 });
 await check('shared creation visible to all; viewer writes denied and diaries remain private',async()=>{
  await owner.locator('.plan-window').filter({hasText:'周末一起安排'}).getByRole('button',{name:'添加待办',exact:true}).click();const dialog=owner.getByRole('dialog',{name:'新建日程或日记',exact:true});await dialog.getByLabel('标题',{exact:true}).fill('一起读书');assert((await dialog.locator('.shared-scope').innerText()).includes('周末一起安排'));await dialog.getByRole('button',{name:'创建',exact:true}).click();
  taskId=await wait(async()=>(await call(contexts[0],'/api/shared-tasks')).tasks.find(r=>r.task.title==='一起读书')?.task.id,'shared task');
  for(const page of [editor,viewer]){await nav(page,'日程').click();await page.getByRole('navigation',{name:'计划视图'}).getByRole('button',{name:'列表',exact:true}).click();await page.locator(`[data-record-id="${taskId}"]`).waitFor();}
  assert.equal((await call(contexts[1],'/api/diaries/'+date)).document.todos.length,0);assert(await viewer.locator(`[data-record-id="${taskId}"]`).getByRole('checkbox').isDisabled());
  const row=(await call(contexts[2],'/api/shared-tasks')).tasks[0];const denied=await contexts[2].request.post(`${base}/api/shared-windows/${win.id}/actions`,{data:{mode:'update',date:row.date,version:row.version,task:row.task,operationId:randomUUID()}});assert.equal(denied.status(),403);
 });
 await check('live updates, all-member completion facts and associated-only restore',async()=>{
  const card=editor.locator(`[data-record-id="${taskId}"]`);await card.getByRole('button',{name:/计划详情/}).click();await card.getByRole('button',{name:'修改',exact:true}).click();const edit=editor.getByRole('dialog',{name:'计划编辑',exact:true});await edit.getByLabel('标题',{exact:true}).fill('一起阅读与复盘');await edit.getByRole('button',{name:'保存',exact:true}).click();await wait(async()=>(await viewer.locator(`[data-record-id="${taskId}"]`).innerText()).includes('一起阅读与复盘'),'live title');
  await editor.locator(`[data-record-id="${taskId}"]`).getByRole('checkbox').click();await editor.getByRole('dialog',{name:'确认操作'}).getByRole('button',{name:'确认',exact:true}).click();await wait(async()=>(await call(contexts[0],'/api/shared-tasks')).tasks.find(r=>r.task.id===taskId)?.task.done,'done');
  for(const ctx of contexts){const facts=(await call(ctx,'/api/diaries/'+date)).document.facts.events;assert.equal(facts.length,1);assert(facts[0].remark.includes('实际完成人：演示好友小林'));}await wait(()=>viewer.locator(`[data-record-id="${taskId}"]`).getByRole('checkbox').isChecked(),'live completion');
  await editor.locator(`[data-record-id="${taskId}"]`).getByRole('checkbox').click();await editor.getByRole('dialog',{name:'确认操作'}).getByRole('button',{name:'确认',exact:true}).click();await wait(async()=>(await call(contexts[0],'/api/shared-tasks')).tasks.find(r=>r.task.id===taskId)?.task.done===false,'restore');for(const ctx of contexts)assert.equal((await call(ctx,'/api/diaries/'+date)).document.facts.events.length,0);
 });
 await check('shared multi-drag preview is local until confirmed; stale write conflicts',async()=>{
  const task=todoSchema.parse({id:randomUUID(),title:'准备读书清单',dueDate:date,dueTime:'15:00'});await call(contexts[0],`/api/shared-windows/${win.id}/actions`,'POST',{mode:'create',date,version:'0',task,operationId:randomUUID()});await owner.getByRole('navigation',{name:'计划视图'}).getByRole('button',{name:'两周',exact:true}).click();await owner.locator(`.calendar-chip[data-record-id="${taskId}"]`).waitFor();let saves=0;owner.on('request',r=>{if(r.url().endsWith('/actions')&&r.method()==='POST')saves++;});
  await dragCalendar(owner,{id:taskId,targetDate:shift(date,1),time:'15:15',touch:true});await dragCalendar(owner,{id:task.id,targetDate:shift(date,1),time:'15:30',touch:true});assert.equal(saves,0);await owner.getByRole('button',{name:'确认改期（2项）',exact:true}).click();await wait(async()=>(await call(contexts[0],'/api/shared-tasks')).tasks.filter(r=>r.task.dueDate===shift(date,1)).length===2,'moves');assert.equal(saves,2);
  const stale=(await call(contexts[1],'/api/shared-tasks')).tasks[0];await call(contexts[0],`/api/shared-windows/${win.id}/actions`,'POST',{mode:'update',date:stale.date,version:stale.version,task:{...stale.task,description:'创建者修改'},operationId:randomUUID()});const conflict=await contexts[1].request.post(`${base}/api/shared-windows/${win.id}/actions`,{data:{mode:'update',date:stale.date,version:stale.version,task:{...stale.task,description:'旧版本'},operationId:randomUUID()}});assert.equal(conflict.status(),409);
 });
 await check('private task copies require confirmation and preserve the original',async()=>{
  const privateTask=todoSchema.parse({id:randomUUID(),title:'私人待办',dueDate:date,dueTime:'18:00',description:'确认后共享的说明'}),diary=await call(contexts[0],'/api/diaries/'+date);
  await call(contexts[0],'/api/actions','POST',{mode:'create',date,version:diary.version,task:privateTask,operationId:randomUUID()});
  await owner.getByRole('button',{name:'筛选计划',exact:true}).click();await owner.getByRole('button',{name:'重置筛选',exact:true}).click();await owner.getByRole('button',{name:/^显示 \d+ 项/}).click();await owner.getByRole('navigation',{name:'计划视图'}).getByRole('button',{name:'列表',exact:true}).click();
  await owner.reload();await owner.getByRole('navigation',{name:'计划视图'}).getByRole('button',{name:'列表',exact:true}).click();const card=owner.locator(`[data-record-id="${privateTask.id}"]`);await card.getByRole('button',{name:/计划详情/}).click();await card.getByRole('button',{name:'修改',exact:true}).click();
  const dialog=owner.getByRole('dialog',{name:'新建日程或日记',exact:true});await select(owner,dialog.locator('.copy-shared-task'),'周末一起安排');await dialog.getByRole('button',{name:'复制并共享',exact:true}).click();await owner.getByRole('dialog',{name:'确认操作'}).getByRole('button',{name:'确认',exact:true}).click();
  const shared=await wait(async()=>(await call(contexts[0],'/api/shared-tasks')).tasks.find(r=>r.task.title==='私人待办'),'copy');assert.notEqual(shared.task.id,privateTask.id);assert((await call(contexts[0],'/api/actions')).tasks.some(r=>r.task.id===privateTask.id));
 });
 await check('revoking collaboration preserves unsaved form text, disables save, and notices can be read',async()=>{
  const card=editor.locator(`[data-record-id="${taskId}"]`);if(await card.getByRole('button',{name:/计划详情/}).getAttribute('aria-expanded')!=='true')await card.getByRole('button',{name:/计划详情/}).click();await card.getByRole('button',{name:'修改',exact:true}).click();const dialog=editor.getByRole('dialog',{name:'计划编辑',exact:true});await dialog.getByLabel('标题',{exact:true}).fill('保留未保存的编辑');
  await call(contexts[0],`/api/shared-windows/${win.id}/members`,'POST',{action:'role',code:people[1].profile.code,role:'viewer'});await wait(()=>dialog.getByRole('button',{name:'保存',exact:true}).isDisabled(),'save disabled after revoke');assert.equal(await dialog.getByLabel('标题',{exact:true}).inputValue(),'保留未保存的编辑');await dialog.getByRole('button',{name:'取消',exact:true}).click();
  await nav(editor,'通讯').click();await editor.getByRole('button',{name:'日程通知',exact:true}).click();await editor.getByRole('button',{name:'全部已读',exact:true}).click();await wait(async()=>(await snapshot(contexts[1])).notices.every(n=>n.read),'read notices');
 });
 results.push({kind:'multi-account',checks,errors});for(const context of contexts)await context.close();
 if(!process.env.QA_INTEGRATION_ONLY){const {matrix}=await import('./qa-social-matrix.mjs');results.push(...await matrix(browser,base,output,people,date));}
 await writeFile(output+'/results.json',JSON.stringify(results,null,2));if(results.some(r=>r.errors.length||r.checks.some(c=>!c.passed)))process.exitCode=1;
}catch(error){await writeFile(output+'/failure.txt',error.stack+String.fromCharCode(10)+serverLog.slice(-9000));throw error;}finally{if(browser)await browser.close();server.kill();await writeFile(output+'/server.log',serverLog);}
