import {chromium} from 'playwright-core';
import {spawn} from 'node:child_process';
import {mkdir,mkdtemp,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {organizationExampleName,organizationExamplePaths} from './fixtures/organization-example.mjs';

const output='qa/organization-hierarchy/'+(process.env.QA_FUNCTIONAL_ONLY?'functional':process.env.QA_CONFIRM?'confirmation':'initial');
await mkdir(output,{recursive:true});
const temp=await mkdtemp(path.join(tmpdir(),'diary-org-tree-')),base='http://127.0.0.1:4323';
const server=spawn(process.execPath,['scripts/qa-social-server.mjs'],{env:{...process.env,SOCIAL_QA_DB:path.join(temp,'diary.sqlite'),SOCIAL_QA_PORT:'4323'},windowsHide:true,stdio:['ignore','pipe','pipe']});
let log='',browser;server.stdout.on('data',data=>log+=data);server.stderr.on('data',data=>log+=data);
const results=[],errors=[];
try{
 for(let attempt=0;attempt<80;attempt++){try{if((await fetch(base+'/api/health')).ok)break;}catch{}if(attempt===79)throw new Error('临时演示未启动');await new Promise(resolve=>setTimeout(resolve,100));}
 browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
 const context=await browser.newContext({viewport:{width:624,height:950},hasTouch:true}),page=await context.newPage();
 page.setDefaultTimeout(9000);page.on('pageerror',error=>errors.push(error.message));
 const call=async(url,body)=>{const response=await context.request.fetch(base+url,{method:body?'POST':'GET',...body?{data:body}:{}}),result=await response.json();assert(response.ok(),JSON.stringify({url,status:response.status(),result}));return result;};
 let org=(await call('/api/organizations',{name:organizationExampleName,operationId:randomUUID()})).organization;
 const refresh=async()=>org=(await call('/api/social')).organizations.find(o=>o.id===org.id);
 const action=async(change)=>{await refresh();await call(`/api/organizations/${org.id}/actions`,{...change,version:org.version,operationId:randomUUID()});await refresh();};
 for(const names of organizationExamplePaths){let parentId;for(const name of names.slice(0,-1))parentId=org.departments.find(d=>d.name===name&&d.parentId===parentId).id;await action({action:'department',departmentId:randomUUID(),parentId:parentId||'',name:names.at(-1)});}
 const open=async(page,url=base)=>{await page.goto(url);await page.getByRole('navigation',{name:'主导航'}).getByRole('button',{name:'通讯',exact:true}).click();await page.locator('.social-tabs').getByRole('button',{name:'组织',exact:true}).click();await page.locator('.org-tree-list').waitFor();};
 const node=(page,names)=>page.locator('.org-tree-select').filter({has:page.getByText(names.at(-1),{exact:true})});
 const confirm=async()=>page.getByRole('dialog',{name:'确认操作',exact:true}).getByRole('button',{name:'确认',exact:true}).click();
 const check=async(name,work)=>{await work();results.push({name,passed:true});console.log('PASS',name);};
 await open(page);
 await check('nested department lists remain visible on mobile and branches expand independently with keyboard',async()=>{
  assert.equal(await page.locator('.org-tree-select').count(),14);const front=node(page,['前端组']);
  assert(await front.evaluate(el=>el.closest('li').parentElement.closest('li').querySelector('.org-tree-select').title==='研发中心 / 技术部'));
  await page.getByRole('button',{name:'收起技术部的下级部门',exact:true}).press('Enter');await front.waitFor({state:'hidden'});assert(await node(page,['产品设计组']).isVisible());
  await page.getByRole('button',{name:'展开技术部的下级部门',exact:true}).press('Enter');await front.waitFor();
 });
 let added;
 await check('a department inline plus creates a fourth-level child only after preview confirmation',async()=>{
  await page.getByRole('button',{name:'在研发中心 / 技术部 / 前端组下新增子部门',exact:true}).click();const dialog=page.getByRole('dialog',{name:'新增子部门',exact:true});assert((await dialog.locator('.org-parent-context').innerText()).includes('第 4 级'));
  await dialog.getByRole('textbox',{name:'部门名称',exact:true}).fill('移动端应用小组');await dialog.getByRole('button',{name:'预览并保存',exact:true}).click();await page.getByRole('dialog',{name:'确认操作',exact:true}).waitFor();assert(!(await refresh()).departments.some(d=>d.name==='移动端应用小组'));await confirm();await dialog.waitFor({state:'hidden'});await node(page,['移动端应用小组']).waitFor();added=(await refresh()).departments.find(d=>d.name==='移动端应用小组');assert.equal(added.parentId,org.departments.find(d=>d.name==='前端组').id);
 });
 await check('editing a parent moves the department and keeps its complete path accurate',async()=>{
  await node(page,['移动端应用小组']).click();await page.getByRole('button',{name:'编辑部门',exact:true}).click();const dialog=page.getByRole('dialog',{name:'编辑部门',exact:true});await dialog.getByRole('button',{name:/上级部门$/}).click();await page.getByRole('option',{name:'研发中心 / 产品部',exact:true}).click();await dialog.getByRole('button',{name:'预览并保存',exact:true}).click();await confirm();await dialog.waitFor({state:'hidden'});await node(page,['移动端应用小组']).waitFor();assert.equal(await node(page,['移动端应用小组']).getAttribute('title'),'研发中心 / 产品部 / 移动端应用小组');assert.equal((await refresh()).departments.find(d=>d.id===added.id).parentId,org.departments.find(d=>d.name==='产品部').id);
  await action({action:'removeDepartment',departmentId:added.id});await node(page,['移动端应用小组']).waitFor({state:'hidden'});
 });
 await check('search retains ancestor paths; cancelling a nested department preserves the structure',async()=>{
  await page.getByRole('textbox',{name:'搜索组织成员或部门',exact:true}).fill('技术部');await node(page,['产品部']).waitFor({state:'hidden'});assert(await node(page,['研发中心']).isVisible());assert(await node(page,['前端组']).isVisible());await page.getByRole('textbox',{name:'搜索组织成员或部门',exact:true}).fill('');await node(page,['产品部']).waitFor();
  await page.getByRole('button',{name:'在研发中心 / 技术部下新增子部门',exact:true}).click();const dialog=page.getByRole('dialog',{name:'新增子部门',exact:true});await dialog.getByRole('textbox',{name:'部门名称',exact:true}).fill('取消的子部门');await dialog.getByRole('button',{name:'取消',exact:true}).click();assert.equal((await refresh()).departments.length,14);
 });
 if(!process.env.QA_FUNCTIONAL_ONLY){
  for(const width of [375,624,768,1280,1440])for(const theme of ['light','dark']){
   const ctx=await browser.newContext({viewport:{width,height:1000},hasTouch:width<900}),view=await ctx.newPage();view.setDefaultTimeout(9000);view.on('pageerror',error=>errors.push(error.message));await view.addInitScript(theme=>localStorage.setItem('diary.theme',theme),theme);await open(view);
   assert.equal(await view.locator('.org-tree-select').count(),14);assert(await view.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));assert(await view.locator('.org-tree button').evaluateAll(buttons=>buttons.every(button=>button.getBoundingClientRect().height>=44&&button.getBoundingClientRect().width>=44)));
   const shot=async name=>{await view.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));await view.screenshot({path:`${output}/${width}-${theme}-${name}.png`,animations:'disabled'});};await shot('organization');
   if(width===375||width===1440){await view.getByRole('button',{name:'在研发中心 / 技术部下新增子部门',exact:true}).click();await view.getByRole('dialog',{name:'新增子部门',exact:true}).waitFor();assert((await view.locator('.org-parent-context').innerText()).includes('第 3 级'));await shot('new-child');await view.getByRole('dialog',{name:'新增子部门',exact:true}).getByRole('button',{name:'取消',exact:true}).click();}
   if(theme==='light'){await view.setViewportSize({width,height:590});await view.waitForFunction(()=>document.querySelector('.global-navigation').getBoundingClientRect().bottom<=innerHeight+1);await shot('short');}
   results.push({name:`${width} ${theme} hierarchy and viewport`,passed:true});await ctx.close();
  }
  if(process.env.QA_LIVE){const live=await browser.newContext({viewport:{width:624,height:1000}}),view=await live.newPage();view.setDefaultTimeout(9000);await view.goto('http://127.0.0.1:4320/');await view.getByRole('navigation',{name:'主导航'}).getByRole('button',{name:'通讯',exact:true}).click();await view.locator('.social-tabs').getByRole('button',{name:'组织',exact:true}).click();await view.locator('.org-toolbar .glass-select-trigger').click();await view.getByRole('option',{name:organizationExampleName,exact:true}).click();await view.getByRole('button',{name:'收起市场运营中心的下级部门',exact:true}).click();await view.getByRole('button',{name:'收起综合管理部的下级部门',exact:true}).click();await view.screenshot({path:'qa/organization-hierarchy/live-example.png',animations:'disabled'});await live.close();}
 }
 assert.deepEqual(errors,[]);await writeFile(output+'/results.json',JSON.stringify({results,errors},null,2));
}catch(error){await writeFile(output+'/failure.txt',error.stack+'\n'+log.slice(-5000));throw error;}finally{await browser?.close();server.kill();}
