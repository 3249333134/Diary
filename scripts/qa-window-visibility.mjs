import {chromium} from 'playwright-core';
import {mkdir,writeFile,access} from 'node:fs/promises';
import assert from 'node:assert/strict';

// Read-only demo checks: UI filters never write schedules or categories.
const output='qa/window-visibility'+(process.env.QA_CONFIRM?'/confirmation':'');await mkdir(output,{recursive:true});
const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
const results=[];
const shot=async(page,name)=>{const file=`${output}/${name}.png`;if(process.env.QA_FUNCTIONAL_ONLY||process.env.QA_CONFIRM&&await access(file).then(()=>true,()=>false))return;await page.screenshot({path:file});};
try{
 for(const width of [375,887,1440])for(const theme of ['light','dark']){
  const page=await browser.newPage({viewport:{width,height:950},hasTouch:width<900});page.setDefaultTimeout(8000);
  await page.addInitScript(theme=>localStorage.setItem('diary.theme',theme),theme);
  const writes=[],errors=[];page.on('request',req=>{if(req.url().includes('/api/')&&req.method()!=='GET')writes.push(req.url());});page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:4320/');await page.getByRole('navigation',{name:'计划视图'}).getByRole('button',{name:'窗口',exact:true}).click();
  const columns=page.locator('.plan-window[data-window-id]');await columns.first().waitFor();await columns.locator('.plan-card').first().waitFor();
  const privateIds=await columns.locator('.plan-card').evaluateAll(es=>es.map(e=>e.dataset.recordId));assert(privateIds.length>0);const names=await columns.locator('.plan-window-name').allTextContents();assert(names.includes('工作')&&names.includes('个人生活'));
  const shared=page.locator('.plan-window').filter({has:page.getByRole('button',{name:/成员管理/})}).first(),name=await shared.locator('.plan-window-name').innerText();
  await shot(page,`${width}-${theme}-all`);
  await page.getByRole('button',{name:'筛选计划',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'筛选计划',exact:true});
  const choose=async label=>{await dialog.locator('.plan-filter-section').filter({has:page.getByRole('heading',{name:'共享窗口',exact:true})}).locator('.glass-select-trigger').click();await page.getByRole('option',{name:label,exact:true}).click();};
  await choose(name);await page.getByRole('button',{name:'关闭计划筛选',exact:true}).click();assert.equal(await columns.count(),0);
  await page.getByText('仅显示：'+name,{exact:true}).waitFor();const clear=page.getByRole('button',{name:'显示全部窗口',exact:true});assert((await clear.boundingBox()).height>=44);
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await shot(page,`${width}-${theme}-filtered`);
  await clear.click();assert.equal(await columns.count(),names.length);const restoredIds=await columns.locator('.plan-card').evaluateAll(es=>es.map(e=>e.dataset.recordId));assert(privateIds.every(id=>restoredIds.includes(id)));assert.equal(await shared.count(),1);
  await page.getByRole('button',{name:'筛选计划',exact:true}).click();await choose('仅私人日程');await page.getByRole('button',{name:'关闭计划筛选',exact:true}).click();assert.equal(await columns.count(),names.length);assert.equal(await shared.count(),0);
  await page.getByRole('button',{name:'显示全部窗口',exact:true}).click();assert.equal(await shared.count(),1);
  assert.deepEqual(writes,[]);assert.deepEqual(errors,[]);results.push({width,theme,privateWindows:names,privateTaskCount:restoredIds.length,sharedWindow:name,passed:true});await page.close();
 }
}finally{await browser.close();await writeFile(`${output}/results.json`,JSON.stringify(results,null,2));}
console.log(JSON.stringify(results));
