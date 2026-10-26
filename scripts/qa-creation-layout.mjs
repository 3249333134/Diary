import {chromium} from 'playwright-core';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {emptyDiary,captureDraftSchema,defaultPlanCategories} from '../packages/contracts/dist/index.js';

const out=process.env.QA_OUTPUT||'qa/creation-layout/'+(process.env.QA_CONFIRM?'confirmation':process.env.QA_FUNCTIONAL_ONLY?'functional':'initial');await mkdir(out,{recursive:true});
const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true}),results=[];
try{for(const width of [375,624,768,1280,1440])for(const theme of ['light','dark']){
 if(process.env.QA_WIDTHS&&!process.env.QA_WIDTHS.split(',').includes(String(width))||process.env.QA_THEME&&theme!==process.env.QA_THEME)continue;
 const touch=width===375,page=await browser.newPage({viewport:{width,height:1100},deviceScaleFactor:1.25,hasTouch:touch}),checks=[],errors=[],writes=[];page.setDefaultTimeout(8000);
 page.on('pageerror',e=>errors.push(e.message));await page.addInitScript(theme=>localStorage.setItem('diary.theme',theme),theme);
 await page.route('**/api/**',async route=>{
  const req=route.request(),path=new URL(req.url()).pathname;let json={};
  if(path==='/api/capture/parse')json={today:'2026-10-26',timezone:'Asia/Shanghai',mode:'ai',drafts:[captureDraftSchema.parse({id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',kind:'plan',content:'明天三点看电影',date:'2026-10-27',time:'15:00'})]};
  else if(!['GET','HEAD'].includes(req.method())){writes.push(path);return route.abort();}
  else if(path==='/api/auth/me')json={id:1,username:'界面测试'};
  else if(path.startsWith('/api/diaries/')){const date=path.split('/').at(-1);json={document:emptyDiary(date),version:'0',exists:false};}
  else if(path==='/api/social')json={profile:{code:'LAYOUT-TEST',name:'界面测试'},friends:[],requests:[],invitations:[],notices:[],windows:[],cursor:0};
  else if(path==='/api/social/events')return route.abort();
  else if(path==='/api/actions')json={tasks:[],records:[]};
  else if(path==='/api/schedule'||path==='/api/shared-tasks')json={tasks:[]};
  else if(path==='/api/tags')json={tags:{person:[],place:[],activity:[],food:[],thing:[]}};
  else if(path==='/api/entities')json={entities:[]};else if(path==='/api/plan-categories')json={categories:defaultPlanCategories};else if(path==='/api/plan-views')json={views:[]};else if(path==='/api/tag-library')json={tags:[]};else if(path==='/api/quick-facts')json={facts:[]};else if(path==='/api/weeks')json={entries:[]};
  await route.fulfill({json});
 });
 const modal=()=>page.locator('.creation-dialog'),content=()=>modal().locator('[data-create-field=content]');
 const shot=async name=>{if(!process.env.QA_FUNCTIONAL_ONLY){await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));await page.waitForFunction(()=>document.elementFromPoint(20,20)?.closest('.creation-dialog'));await page.screenshot({path:`${out}/${width}-${theme}-${name}.png`,animations:'disabled'});}};
 const check=async(name,fn)=>{await fn();checks.push(name);console.log(width,theme,'PASS',name);};
 const bounds=async()=>{
  await page.waitForFunction(()=>{const box=document.querySelector('.creation-overlay')?.getBoundingClientRect(),vv=visualViewport,touch=matchMedia('(pointer:coarse)').matches||/Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent),visible=touch||Math.abs(vv.scale-1)>.01,h=visible?Math.min(innerHeight,vv.height):innerHeight,w=visible?Math.min(document.documentElement.clientWidth,vv.width):document.documentElement.clientWidth;return box&&Math.abs(box.height-h)<2&&Math.abs(box.width-w)<2;});
  const result=await page.evaluate(()=>{const r=s=>document.querySelector(s).getBoundingClientRect(),overlay=r('.creation-overlay'),footer=r('.creation-footer'),bar=r('.creation-action-bar'),body=r('.creation-body'),c=getComputedStyle(document.querySelector('.creation-footer'));return {height:overlay.height,bottom:overlay.bottom,footerBottom:footer.bottom,barBottom:bar.bottom,gap:footer.bottom-bar.bottom,padding:Number.parseFloat(c.paddingBottom),bodyBottom:body.bottom,footerTop:footer.top,width:overlay.width,barRight:bar.right,right:overlay.right};});
  assert(Math.abs(result.bottom-result.footerBottom)<2,'footer must remain at the visible bottom');assert(result.gap<=result.padding+1,'footer must not reserve empty space below actions');assert(result.bodyBottom<=result.footerTop+1);assert(result.barRight<=result.right+1);
  const shells=await page.locator('.creation-overlay,.creation-dialog,.creation-dialog>.plan-dialog-content').evaluateAll(elements=>elements.map(el=>({className:el.className,top:el.scrollTop,left:el.scrollLeft})));assert(shells.every(el=>el.top===0&&el.left===0),`only the form may scroll: ${JSON.stringify(shells)}`);return result;
 };
 try{
  await page.goto('http://127.0.0.1:4320/');await page.locator('.global-create').click();await modal().waitFor();await content().fill('保留手动内容');await page.getByRole('textbox',{name:'AI 输入',exact:true}).fill('明天三点看电影');await page.getByRole('button',{name:'识别 AI 输入',exact:true}).click();await modal().getByRole('button',{name:'草稿 1 · 日程',exact:true}).waitFor();await modal().getByRole('button',{name:'手动填写',exact:true}).click();
  await check('repeat options and diary types retain the fixed header and footer',async()=>{
   const stable=async()=>{await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));await bounds();};
   for(const height of [1100,650]){
    await page.setViewportSize({width,height});
    for(const name of ['每日','每周','每月','不重复','每月']){
     const choice=modal().locator('.repeat-fields .glass-choice').filter({hasText:name});await choice.click();await stable();
     const aligned=await choice.evaluate(label=>{const input=label.querySelector('input').getBoundingClientRect(),rect=label.getBoundingClientRect();return input.bottom>=rect.top&&input.top<=rect.bottom;});assert(aligned,'hidden radio focus target must stay within its visible label');
    }
    if(height===1100){await modal().locator('.repeat-fields').evaluate(el=>el.scrollIntoView({block:'center'}));await stable();await shot('repeat');}
    await modal().locator('.repeat-fields input[value=monthly]').press('ArrowLeft');await stable();
    await modal().locator('.creation-header button').filter({hasText:'日记'}).click();await stable();
    for(const name of ['新知','输入','灵感','事实']){await modal().locator('.creation-form>.glass-segments button').filter({hasText:name}).click();await stable();}
    await modal().locator('.creation-header button').filter({hasText:'日程'}).click();await stable();assert.equal(await content().inputValue(),'保留手动内容');
   }
   await page.setViewportSize({width,height:1100});await stable();
  });
  await check('classification, date popovers and validation focus scroll only the form',async()=>{
   for(const [group,name] of [['事项类别','工作'],['四象限','重要不紧急'],['优先级','高']]){await modal().getByRole('radiogroup',{name:group,exact:true}).locator('.glass-choice').filter({hasText:new RegExp('^'+name+'$')}).click();await bounds();}
   await modal().getByRole('button',{name:'截止时间',exact:true}).click();const picker=page.getByRole('dialog',{name:'选择截止时间',exact:true});await picker.waitFor();await picker.getByRole('button',{name:'取消',exact:true}).click();await bounds();
   await content().fill('');await modal().locator('.creation-submit').click();await modal().locator('.creation-error').waitFor();await page.waitForFunction(()=>document.querySelector('.creation-dialog [data-create-field=content]')===document.activeElement);await bounds();await content().fill('保留手动内容');
  });
  await check('file picker, removal and local draft reopening retain file metadata',async()=>{
   const picker=modal().getByRole('button',{name:'选择文件',exact:true}),chooser=page.waitForEvent('filechooser');await picker.click();await(await chooser).setFiles([{name:'季度复盘报告 😀.pdf',mimeType:'application/pdf',buffer:Buffer.from('pdf')},{name:'会议记录.txt',mimeType:'text/plain',buffer:Buffer.from('notes')}]);assert.equal(await modal().locator('.creation-file-list li').count(),2);assert.equal(await modal().locator('input[type=file]').evaluate(el=>getComputedStyle(el).display),'none');await modal().getByRole('button',{name:'移除附件：会议记录.txt',exact:true}).click();await modal().getByRole('button',{name:'取消新增',exact:true}).click();await modal().waitFor({state:'hidden'});await page.locator('.global-create').click();await modal().waitFor();assert.equal(await modal().locator('.creation-file-list li').count(),1);assert.equal(await content().inputValue(),'保留手动内容');
  });
  await check('only the form scrolls and footer has no excess space below actions',async()=>{const a=await bounds();await modal().locator('.creation-body').evaluate(el=>el.scrollTop=el.scrollHeight);const b=await bounds();assert(Math.abs(a.footerTop-b.footerTop)<1);assert.equal(await modal().locator('.creation-draft-tools').count(),1);});await shot('files');
  await check('shrink and grow the window without retaining a stale footer height',async()=>{await page.setViewportSize({width,height:650});await bounds();await page.setViewportSize({width,height:1100});await bounds();});
  await check(touch?'touch keyboard uses its visible height':'desktop ignores an outdated smaller visual viewport',async()=>{
   await page.evaluate(touch=>{Object.defineProperty(visualViewport,'height',{configurable:true,get:()=>touch?540:800});window.dispatchEvent(new Event('resize'));},touch);const box=await bounds();assert.equal(Math.round(box.height),touch?540:1100);if(width===624&&theme==='light')await shot('resized');await page.evaluate(()=>{delete visualViewport.height;window.dispatchEvent(new Event('resize'));});await bounds();
  });
  await check('pinch zoom keeps both footer buttons within the visible width',async()=>{const cdp=await page.context().newCDPSession(page);await cdp.send('Emulation.setPageScaleFactor',{pageScaleFactor:1.25});await page.waitForFunction(()=>visualViewport.scale>1.2);await bounds();const submit=await modal().locator('.creation-submit').boundingBox(),cancel=await modal().locator('.creation-cancel').boundingBox();assert(submit.width>=44&&cancel.width>=44);await shot('zoom');await cdp.send('Emulation.setPageScaleFactor',{pageScaleFactor:1});await page.waitForFunction(()=>Math.abs(visualViewport.scale-1)<.01);await bounds();await cdp.detach();});
  await check('cancel clear preserves text and files; confirm clear leaves the AI queue intact',async()=>{
   await modal().getByRole('button',{name:'清空当前草稿',exact:true}).click();let confirm=page.getByRole('dialog',{name:'确认操作',exact:true});await confirm.getByRole('button',{name:'取消',exact:true}).click();assert.equal(await content().inputValue(),'保留手动内容');assert.equal(await modal().locator('.creation-file-list li').count(),1);await modal().getByRole('button',{name:'清空当前草稿',exact:true}).click();confirm=page.getByRole('dialog',{name:'确认操作',exact:true});await confirm.getByRole('button',{name:'确认',exact:true}).click();assert.equal(await content().inputValue(),'');assert.equal(await modal().locator('.creation-file-list li').count(),0);assert.equal(await modal().getByRole('button',{name:'草稿 1 · 日程',exact:true}).count(),1);
  });
  assert.deepEqual(writes,[]);assert.deepEqual(errors,[]);results.push({width,theme,checks,errors,writes});
 }catch(e){results.push({width,theme,checks,errors,writes,error:e.stack});throw e;}finally{await page.close();}
}}finally{await browser.close();await writeFile(out+'/results.json',JSON.stringify(results,null,2));}
