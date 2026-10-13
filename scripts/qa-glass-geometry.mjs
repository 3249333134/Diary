import {chromium} from 'playwright-core';
import {writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
const results=[];
try{for(const width of [375,768,1440]){
 const page=await browser.newPage({viewport:{width,height:540},hasTouch:width<900});
 await page.goto('http://127.0.0.1:4320');
 await page.getByRole('button',{name:'计划',exact:true}).click();
 await page.getByRole('button',{name:'新增计划',exact:true}).click();
 const editor=page.getByRole('dialog',{name:'计划编辑'});
 await editor.getByRole('button',{name:'截止时间',exact:true}).click();
 const picker=page.getByRole('dialog',{name:'选择截止时间'});
 const confirm=picker.getByRole('button',{name:'确认',exact:true});
 assert(await confirm.evaluate(el=>parseFloat(getComputedStyle(el).fontSize)>=12));
 const footer=await picker.locator('footer').boundingBox(),panel=await page.locator('.glass-date-popup').boundingBox();
 assert(panel.x>=7&&panel.x+panel.width<=width-7&&panel.y>=7&&panel.y+panel.height<=533);
 assert(footer.y+footer.height<=533);
 const time=picker.locator('.glass-date-segments').last();await time.scrollIntoViewIfNeeded();
 const field=await time.boundingBox();assert(field.y+field.height<=footer.y+1);
 await picker.getByRole('button',{name:'取消',exact:true}).click();
 await editor.getByRole('button',{name:'取消',exact:true}).click();
 await page.getByRole('button',{name:'日记',exact:true}).click();
 await page.getByRole('button',{name:'日记日期',exact:true}).click();
 const calendar=page.getByRole('dialog',{name:'选择日记日期'});
 const bounds=await page.locator('.glass-date-popup').boundingBox();assert(bounds.x>=7&&bounds.x+bounds.width<=width-7&&bounds.y+bounds.height<=533);
 await calendar.getByRole('button',{name:'取消',exact:true}).click();
 results.push({width,height:540,passed:true,scope:'real demo API, date-panel layout and visible action text, no diary writes'});await page.close();
}await writeFile('qa/glass/geometry.json',JSON.stringify(results,null,2));console.log(JSON.stringify(results));}finally{await browser.close();}
