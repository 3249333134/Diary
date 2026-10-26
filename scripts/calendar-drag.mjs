import assert from 'node:assert/strict';
/** Browser-simulated mouse / long-press drag, using the calendar's visible coordinate system. */
export async function dragCalendar(page,{id,title,targetDate,time='',month=false,focused=false,touch=false,invalid=false,sourceDate}) {
  const area=page.locator('.calendar-scroll');
  if(month){
    await page.locator(`.calendar-day[data-calendar-date="${sourceDate}"] .calendar-date`).click();
  }
  const handle=(month?page.locator('.calendar-month-day-pane'):focused?page.locator('.calendar-focused-day'):page.locator('.calendar-timeline-canvas')).locator(`.calendar-chip[data-record-id="${id}"] ${month||focused?'.calendar-chip-drag':'.calendar-chip-copy'}`).first();
  await handle.scrollIntoViewIfNeeded();
  await area.evaluate((el,{id,month,focused})=>{if(month||focused)return;const handle=el.querySelector(`.calendar-timeline-canvas .calendar-chip[data-record-id="${id}"] .calendar-chip-copy`),r=handle.getBoundingClientRect(),b=el.getBoundingClientRect();el.scrollTop+=r.y+r.height/2-(b.y+44+(b.height-44)/2);el.scrollLeft+=r.x+r.width/2-(b.x+96+(b.width-96)/2);},{id,month,focused});
  await page.waitForTimeout(40);const a=await handle.boundingBox(),card=await handle.locator('..').boundingBox();
  const cdp=touch?await page.context().newCDPSession(page):undefined;
  try{
    const start={x:a.x+a.width/2,y:a.y+a.height/2};
    if(cdp){await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[start]});await page.waitForTimeout(380);}else{await page.mouse.move(start.x,start.y);await page.mouse.down();await page.mouse.move(start.x+8,start.y);}
    await page.locator('.calendar-drag-ghost').waitFor();
    const target=page.locator(month?`.calendar-month .calendar-day[data-calendar-date="${targetDate}"]`:`${time?'.timeline-timed-cell':'.timeline-date'}[data-calendar-date="${targetDate}"]`);
    let point;
    if(month){await target.scrollIntoViewIfNeeded();const r=await target.boundingBox(),b=await area.boundingBox();point={x:r.x+r.width/2,y:Math.max(b.y+8,Math.min(b.y+b.height-8,r.y+r.height/2))};}
    else {
      const hours=await page.locator('.timeline-hour-axis>span:not(.timeline-no-hours)').allTextContents();
      const offset=time?hours.indexOf(time.slice(0,2)+':00')*160+Number(time.slice(3))/60*160+1:0;
      if(time&&offset<0)throw new Error('Target hour is not visible: '+time);
      await area.evaluate((el,{targetDate,time,offset})=>{const cell=el.querySelector(`${time?'.timeline-timed-cell':'.timeline-date'}[data-calendar-date="${targetDate}"]`),r=cell.getBoundingClientRect(),b=el.getBoundingClientRect();el.scrollTop+=r.y+r.height/2-(b.y+44+(b.height-44)/2);if(time)el.scrollLeft+=r.x+offset-(b.x+96+(b.width-96)/2);else el.scrollLeft=0;},{targetDate,time,offset});
      const r=await target.boundingBox();point={x:time?r.x+offset:r.x+r.width/2,y:r.y+r.height/2};
    }
    if(invalid)point={x:2,y:2};
    if(cdp){await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[point]});await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});}else{await page.mouse.move(point.x,point.y,{steps:4});await page.waitForFunction(({x,y})=>{const r=document.querySelector('.calendar-drag-ghost')?.getBoundingClientRect();return r&&Math.abs(r.x-x)<2&&Math.abs(r.y-y)<2;},{x:point.x-Math.min(start.x-card.x,240),y:point.y-(start.y-card.y)});const ghost=await page.locator('.calendar-drag-ghost').boundingBox();assert(Math.abs(ghost.x-(point.x-Math.min(start.x-card.x,240)))<2&&Math.abs(ghost.y-(point.y-(start.y-card.y)))<2,'drag preview follows pointer');await page.mouse.up();}
    await page.waitForTimeout(80);
  }finally{if(cdp)await cdp.detach();else await page.mouse.up();}
}
