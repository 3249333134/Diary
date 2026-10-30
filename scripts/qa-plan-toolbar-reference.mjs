import {chromium} from 'playwright-core';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';

const before=process.argv.includes('--before'),functional=!!process.env.QA_FUNCTIONAL_ONLY,output=`qa/plan-toolbar-reference/${before?'before':functional?'functional':'confirmation'}`;
await mkdir(output,{recursive:true});
const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
const results=[],errors=[],writes=[];
try{
 for(const width of before?[375,1440]:[375,624,768,1280,1440])for(const theme of before?['light']:['light','dark']){
  if(process.env.QA_WIDTH&&Number(process.env.QA_WIDTH)!==width)continue;
  const context=await browser.newContext({viewport:{width,height:900},hasTouch:width<900}),page=await context.newPage();page.setDefaultTimeout(9000);
  page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(theme=>localStorage.setItem('diary.theme',theme),theme);
  await page.route('**/api/**',route=>{if(route.request().method()!=='GET'){writes.push(route.request().url());return route.abort();}return route.continue();});
  await page.goto('http://127.0.0.1:4320/');const toolbar=page.locator('.plan-main-toolbar');await toolbar.waitFor();await page.waitForTimeout(200);
  const geometry=await toolbar.evaluate(el=>{const rect=e=>{const r=e.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom};};const nav=el.querySelector('.plan-view-switch');return{toolbar:rect(el),date:rect(el.querySelector('.plan-date-tools')),views:rect(nav),actions:rect(el.querySelector('.plan-toolbar-actions')),scroll:{left:nav.scrollLeft,width:nav.scrollWidth,client:nav.clientWidth},buttons:[...el.querySelectorAll('button')].map(button=>({label:button.getAttribute('aria-label')||button.textContent.trim(),...rect(button)})),overflow:document.documentElement.scrollWidth>innerWidth};});
  if(!functional&&(before||[375,1440].includes(width))){const clip=await toolbar.boundingBox();await page.screenshot({path:`${output}/${width}-${theme}.png`,clip:{x:clip.x,y:Math.max(0,clip.y-4),width:clip.width,height:clip.height+12}});}
  if(!before){
   assert(!geometry.overflow);assert(geometry.date.right<=geometry.views.x+1);assert(geometry.views.right<=geometry.actions.x+1);assert(geometry.actions.right<=geometry.toolbar.right+1);
   for(const button of geometry.buttons)assert(button.width>=43.5&&button.height>=43.5,JSON.stringify(button));
   assert.equal(await toolbar.locator('.glass-select-trigger').count(),0);
   const nav=page.getByRole('navigation',{name:'计划视图'});assert.deepEqual(await nav.locator('button').allTextContents(),['两周','月','周','窗口','列表']);
   const actionsBefore=await page.locator('.plan-toolbar-actions').boundingBox();
   for(const label of ['月','周','窗口','列表','两周']){const button=nav.getByRole('button',{name:label,exact:true});await button.click();assert.equal(await button.getAttribute('aria-pressed'),'true');}
   const actionsAfter=await page.locator('.plan-toolbar-actions').boundingBox();assert(Math.abs(actionsBefore.x-actionsAfter.x)<1);
   await nav.getByRole('button',{name:'两周',exact:true}).focus();await page.keyboard.press('End');assert.equal(await page.evaluate(()=>document.activeElement?.textContent.trim()),'列表');await page.keyboard.press('Enter');assert.equal(await nav.getByRole('button',{name:'列表',exact:true}).getAttribute('aria-pressed'),'true');
   if(width===1440){await page.setViewportSize({width:375,height:900});await page.waitForFunction(()=>{const nav=document.querySelector('.plan-view-switch'),selected=nav.querySelector('[data-selected]'),r=selected.getBoundingClientRect(),b=nav.getBoundingClientRect();return r.left>=b.left-1&&r.right<=b.right+1;});const bounds=await nav.boundingBox();await page.mouse.move(bounds.x+bounds.width/2,bounds.y+bounds.height/2);await page.mouse.wheel(-300,0);await page.waitForFunction(()=>document.querySelector('.plan-view-switch').scrollLeft<1);assert.equal(await nav.getByRole('button',{name:'列表',exact:true}).getAttribute('aria-pressed'),'true');await page.setViewportSize({width,height:900});}
   await nav.getByRole('button',{name:'列表',exact:true}).focus();await page.keyboard.press('Home');await page.keyboard.press('Enter');
   await toolbar.getByRole('button',{name:'筛选计划',exact:true}).click();await page.getByRole('dialog',{name:'筛选计划',exact:true}).waitFor();await page.getByRole('button',{name:'关闭计划筛选',exact:true}).click();
   await toolbar.getByRole('button',{name:'全屏显示',exact:true}).click();await toolbar.getByRole('button',{name:'退出全屏',exact:true}).click();
   await page.setViewportSize({width,height:560});await page.waitForTimeout(100);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));const footer=await page.locator('.workspace-footer').boundingBox();assert(footer.y+footer.height<=561);
  }
  results.push({width,theme,geometry,passed:true});await context.close();
 }
 assert.deepEqual(errors,[]);assert.deepEqual(writes,[]);
}finally{await browser.close();await writeFile(output+'/results.json',JSON.stringify({results,errors,writes},null,2));}
