import { useEffect, useRef, useState, type PointerEvent, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { visibleWeekHours } from './calendarHours';
import { HOUR_WIDTH, DEADLINE_WIDTH, LANE_HEIGHT, timelineMarkers, timelineOffset, timelineTime } from './calendarTimeline';
import type { ActionRow } from './api';
import { planState, planDueTime, planClock } from './planFilters';
import { usePlanCategories } from './PlanCategories';
import { urgency, urgencyStyle } from './planUrgency';
import { PlanActionDock } from './PlanActionDock';
import { calendarRange, shiftDate, type CalendarView } from './calendarDates';
export { calendarRange, shiftDate } from './calendarDates';
import {calendarRowKey,previewCalendarRows,updateCalendarPreviews,type CalendarPreview,type CalendarTarget} from './calendarPreview';
import './schedule.css';
import './schedule-refinements.css';

type Target=CalendarTarget;
type GestureMode='decide'|'drag'|'scrub'|'scroll';
type Gesture={row:ActionRow;x:number;y:number;startX:number;startY:number;lastX:number;lastY:number;offsetX:number;offsetY:number;width:number;startTop:number;mode:GestureMode;timer?:number;pointer:number;el:HTMLElement;target?:Target;date:string;startMinutes:number;minutes:number;edgeTick:number};
const minutesOf=(time:string)=>{const[h,m]=time.split(':').map(Number);return(h||0)*60+(m||0);};
const formatMinutes=(minutes:number)=>`${String(Math.floor(minutes/60)).padStart(2,'0')}:${String(minutes%60).padStart(2,'0')}`;
/** 滑动调时间时使用完整 24 小时刻度，卡片位置才能与时间线性对应，可自由向更早/更晚拖动 */
const ALL_HOURS=Array.from({length:24},(_,hour)=>hour);
export function PlanCalendar({view,anchor,rows,busy,onEdit,onMove,onToggle,active=true,showAllHours=false,onInteractionChange}:{view:CalendarView;anchor:string;showAllHours?:boolean;onInteractionChange?:(state:{dragging:boolean;pending:boolean;saving:boolean})=>void;rows:ActionRow[];busy:boolean;onEdit:(row:ActionRow)=>void;onMove:(row:ActionRow,target:Target)=>Promise<boolean>;onToggle:(row:ActionRow)=>void;active?:boolean}) {
  const range=calendarRange(anchor,view),days=Array.from({length:view==='month'?42:view==='fortnight'?14:7},(_,i)=>shiftDate(range.from,i));
  const {categories}=usePlanCategories();const scroll=useRef<HTMLDivElement>(null);
  const ghost=useRef<HTMLDivElement>(null);
  const [expanded,setExpanded]=useState<string>(),[drag,setDrag]=useState<{row:ActionRow;target?:Target}>(),[pending,setPending]=useState<CalendarPreview[]>([]);
  /** 月视图底部日程表默认展示今天（若在本月网格内）或当前选中日期 */
  const agendaDate=view==='month'?(expanded&&days.includes(expanded)?expanded:days.includes(planClock().date)?planClock().date:''):'';
  const [submitting,setSubmitting]=useState(false),[progress,setProgress]=useState({current:0,total:0}),[batchMessage,setBatchMessage]=useState('');
  const [frozen,setFrozen]=useState<{hours:number[];heights:Record<string,number>;allDay:boolean}>();
  const [viewportWidth,setViewportWidth]=useState(0);
  const saving=useRef(false);
  const moveCallback=useRef(onMove);moveCallback.current=onMove;
  const lastPreview=useRef<string|undefined>(undefined);
  const blocked=busy||submitting;
  useEffect(()=>{onInteractionChange?.({dragging:!!drag,pending:!!pending.length,saving:submitting});},[!!drag,!!pending.length,submitting,onInteractionChange]);
  useEffect(()=>()=>onInteractionChange?.({dragging:false,pending:false,saving:false}),[onInteractionChange]);
  const pendingKeys=new Set(pending.map(preview=>calendarRowKey(preview.row)));
  const displayRows=previewCalendarRows(rows,pending);
  const rangeRows=displayRows.filter(row=>days.includes(row.task.dueDate||row.task.plannedDate||''));
  const times=rangeRows.map(row=>planDueTime(row.task)||'');
  const hours=frozen?.hours||visibleWeekHours(times,showAllHours);
  const markersByDate=new Map(days.map(date=>[date,timelineMarkers(displayRows.filter(row=>(row.task.dueDate||row.task.plannedDate)===date&&planDueTime(row.task)).map(row=>({key:calendarRowKey(row),time:planDueTime(row.task)!})),hours)]));
  const markersFor=(date:string)=>markersByDate.get(date)||new Map<string,{anchor:number;lane:number}>();
  const allDay=!!frozen?.allDay||rangeRows.some(row=>!planDueTime(row.task));
  const contentHeight=(date:string)=>Math.max(60,...[...markersFor(date).values()].map(marker=>(marker.lane+1)*LANE_HEIGHT+8),displayRows.filter(row=>(row.task.dueDate||row.task.plannedDate)===date&&!planDueTime(row.task)).length*LANE_HEIGHT+8);
  const rowHeight=(date:string)=>frozen?.heights[date]||contentHeight(date);
  const axisWidth=Math.max(hours.length*HOUR_WIDTH,...[...markersByDate.values()].flatMap(markers=>[...markers.values()].map(marker=>marker.anchor+DEADLINE_WIDTH+12)));
  const freeze=(row:ActionRow,allHours=false)=>setFrozen(old=>old||{hours:allHours?ALL_HOURS:hours.length?hours:planDueTime(row.task)?[Number(planDueTime(row.task)!.slice(0,2))]:[],heights:Object.fromEntries(days.map(date=>[date,contentHeight(date)])),allDay:allDay||!planDueTime(row.task)});
  /** 冻结刻度后补齐横向滚动，让卡片停在手指下方，避免切换 24 小时刻度时位置跳变 */
  const anchorShift=useRef<number|null>(null);
  useEffect(()=>{if(anchorShift.current===null)return;const box=scroll.current;if(box)box.scrollLeft+=anchorShift.current;anchorShift.current=null;},[frozen]);
  useEffect(()=>{const box=scroll.current;if(!box)return;const observer=new ResizeObserver(()=>setViewportWidth(box.clientWidth));observer.observe(box);return()=>observer.disconnect();},[]);
  const gesture=useRef<Gesture|undefined>(undefined);
  const hoursRef=useRef<number[]>([]);hoursRef.current=hours;
  const initialScroll=useRef('');
  const end=(retainHours=false)=>{const g=gesture.current;if(g){window.clearTimeout(g.timer);if(g.el.hasPointerCapture(g.pointer))g.el.releasePointerCapture(g.pointer);}gesture.current=undefined;setDrag(undefined);if(!retainHours)setFrozen(undefined);};
  /** Dragging near the timeline edge grows the frozen hour axis so deadlines can pass the visible range. */
  const extendHoursTo=(hour:number)=>{
    if(hour<0||hour>23)return;
    setFrozen(old=>old&&!old.hours.includes(hour)?{...old,hours:[...old.hours,hour].sort((a,b)=>a-b)}:old);
  };
  const applyScrub=(g:Gesture)=>{
    g.target={date:g.date,time:formatMinutes(g.minutes)};
    setDrag({row:g.row,target:g.target});
  };
  const cancel=()=>{if(saving.current)return;setPending([]);setBatchMessage('');end();};
  useEffect(()=>{setExpanded(undefined);setPending([]);setBatchMessage('');end();},[view,anchor,active]);
  useEffect(()=>{
    if(!pending.length)return;
    const frame=requestAnimationFrame(()=>{
      // Keep the latest preview reachable above the bottom action slot.
      const card=Array.from(scroll.current?.querySelectorAll<HTMLElement>('.calendar-chip[data-pending=true]')||[]).find(card=>card.dataset.previewKey===lastPreview.current);
      card?.scrollIntoView({block:'nearest',inline:'nearest'});
    });
    return()=>cancelAnimationFrame(frame);
  },[pending]);
  useEffect(()=>{
    if(view==='month'){initialScroll.current='';return;}
    const key=range.from+showAllHours;
    if(initialScroll.current===key)return;
    initialScroll.current=key;
    const frame=requestAnimationFrame(()=>{if(scroll.current){scroll.current.scrollTop=0;scroll.current.scrollLeft=showAllHours?Math.max(0,(times.filter(Boolean).length?Math.min(...times.filter(Boolean).map(t=>Number(t.slice(0,2)))):9)-1)*HOUR_WIDTH:0;}});
    return()=>cancelAnimationFrame(frame);
  },[view,anchor,showAllHours]);
  useEffect(()=>{const key=(e:KeyboardEvent)=>{if(e.key==='Escape')cancel();};window.addEventListener('keydown',key);return()=>{window.removeEventListener('keydown',key);window.clearTimeout(gesture.current?.timer);};},[]);
  useEffect(()=>{
    if(!drag)return;
    const timer=window.setInterval(()=>{
      const g=gesture.current,box=scroll.current;
      if(!g||!box)return;
      const r=box.getBoundingClientRect();
      g.edgeTick++;
      if(g.mode==='scrub'){
        // Keep pushing the deadline while the pointer hugs the screen edge.
        if(g.x<r.left+28){box.scrollLeft-=10;if(g.edgeTick%2===0&&g.minutes>0){g.minutes=Math.max(0,g.minutes-15);applyScrub(g);}}
        else if(g.x>r.right-28){box.scrollLeft+=10;if(g.edgeTick%2===0&&g.minutes<1435){g.minutes=Math.min(1435,g.minutes+15);applyScrub(g);}}
        return;
      }
      if(g.mode!=='drag')return;
      if(g.y<r.top+50)box.scrollTop-=14;else if(g.y>r.bottom-50)box.scrollTop+=14;
      if(g.x<r.left+35){box.scrollLeft-=14;if(g.edgeTick%4===0){const hs=hoursRef.current;extendHoursTo((hs.length?hs[0]:1)-1);}}
      else if(g.x>r.right-35){box.scrollLeft+=14;if(g.edgeTick%4===0){const hs=hoursRef.current;extendHoursTo((hs.length?hs[hs.length-1]:22)+1);}}
      updateTarget();
    },35);
    return()=>window.clearInterval(timer);
  },[!!drag]);
  const begin=(e:PointerEvent<HTMLDivElement>,row:ActionRow)=>{
    if(gesture.current)end(!!pending.length);
    if(blocked||saving.current||!active)return;
    if(row.task.done||row.task.status==='done'||row.task.status==='cancelled'||row.task.deletedAt)return;
    if(e.pointerType==='mouse'&&e.button!==0)return;
    setBatchMessage('');
    const el=e.currentTarget,rect=el.getBoundingClientRect(),minutes=minutesOf(planDueTime(row.task)||'12:00');
    const date=row.task.dueDate||row.task.plannedDate||'';
    const startTop=(markersFor(date).get(calendarRowKey(row))?.lane||0)*LANE_HEIGHT+4;
    const g:Gesture={row,x:e.clientX,y:e.clientY,startX:e.clientX,startY:e.clientY,lastX:e.clientX,lastY:e.clientY,offsetX:Math.min(e.clientX-rect.left,240),offsetY:e.clientY-rect.top,width:Math.max(160,Math.min(rect.width,280)),startTop,mode:'decide',pointer:e.pointerId,el,date,startMinutes:minutes,minutes,edgeTick:0};
    gesture.current=g;
    el.setPointerCapture(e.pointerId);
    if(e.pointerType!=='mouse')g.timer=window.setTimeout(()=>{if(gesture.current!==g||g.mode!=='decide')return;g.mode='drag';freeze(row);setDrag({row});},350);
  };
  const move=(e:PointerEvent<HTMLDivElement>)=>{
    const g=gesture.current;if(!g||e.pointerId!==g.pointer)return;
    if(g.mode==='decide'){
      const dx=e.clientX-g.startX,dy=e.clientY-g.startY;
      if(e.pointerType==='mouse'){
        if(Math.hypot(dx,dy)<=6)return;
        g.mode='drag';freeze(g.row);setDrag({row:g.row});
      }else if(Math.abs(dy)>10&&Math.abs(dy)>Math.abs(dx)){
        // Vertical intent: hand the gesture to manual container scrolling.
        g.mode='scroll';window.clearTimeout(g.timer);g.lastX=e.clientX;g.lastY=e.clientY;return;
      }else if(Math.abs(dx)>12&&Math.abs(dx)>Math.abs(dy)){
        window.clearTimeout(g.timer);
        const time=planDueTime(g.row.task);
        if(view!=='month'&&time){
          // 切换到完整 24 小时刻度，卡片与时间一一对应，可向任意方向拖动
          anchorShift.current=g.startMinutes/60*HOUR_WIDTH-timelineOffset(time,hoursRef.current);
          g.mode='scrub';freeze(g.row,true);
        }else{g.mode='scroll';g.lastX=e.clientX;g.lastY=e.clientY;return;}
      }else return;
    }
    if(g.mode==='scroll'){
      const box=scroll.current;
      if(box){box.scrollLeft-=e.clientX-g.lastX;box.scrollTop-=e.clientY-g.lastY;}
      g.lastX=e.clientX;g.lastY=e.clientY;return;
    }
    e.preventDefault();g.x=e.clientX;g.y=e.clientY;
    if(g.mode==='scrub'){
      g.minutes=Math.max(0,Math.min(1435,g.startMinutes+Math.round((g.x-g.startX)/HOUR_WIDTH*60/15)*15));
      applyScrub(g);
    }else updateTarget();
  };
  const updateTarget=()=>{
    const g=gesture.current;if(!g||g.mode!=='drag')return;
    if(ghost.current)ghost.current.style.transform=`translate3d(${g.x-g.offsetX}px,${g.y-g.offsetY}px,0)`;
    const el=document.elementFromPoint(g.x,g.y)?.closest<HTMLElement>('[data-calendar-date]');
    if(!el||!scroll.current?.contains(el)){g.target=undefined;setDrag({row:g.row});return;}
    let time=planDueTime(g.row.task)||'';
    if(view!=='month'&&el.dataset.timed==='true'){const rect=el.getBoundingClientRect();time=timelineTime(g.x-rect.left,hoursRef.current);}
    else if(view!=='month')time='';
    g.target={date:el.dataset.calendarDate!,time};setDrag({row:g.row,target:g.target});
  };
  const release=(e:PointerEvent<HTMLDivElement>)=>{
    const g=gesture.current;if(!g||e.pointerId!==g.pointer)return;
    if(g.mode==='decide'){const row=g.row;end(!!pending.length);cancel();onEdit(rows.find(r=>calendarRowKey(r)===calendarRowKey(row))||row);return;}
    if(g.mode==='scroll'){end(!!pending.length);return;}
    const next=updateCalendarPreviews(pending,g.row,g.target);
    lastPreview.current=calendarRowKey(g.row);setPending(next);
    if(g.target&&view==='month'&&window.matchMedia('(max-width:599px)').matches)setExpanded(g.target.date);
    end(!!next.length);
  };
  const confirm=async()=>{
    if(!pending.length||blocked||saving.current)return;
    const batch=[...pending];saving.current=true;setSubmitting(true);setBatchMessage('');
    let saved=0;
    try{
      for(let i=0;i<batch.length;i++){
        const preview=batch[i];setProgress({current:i+1,total:batch.length});
        let success=false;try{success=await moveCallback.current(preview.row,preview.target);}catch{/* Keep the remaining previews available for retry. */}
        setPending(old=>old.filter(item=>calendarRowKey(item.row)!==calendarRowKey(preview.row)));
        if(!success){const remaining=batch.length-i-1;setBatchMessage(`${saved?`已保存 ${saved} 项；`:''}「${preview.row.task.title}」改期失败，已还原。${remaining?`剩余 ${remaining} 项待确认。`:''}`);break;}
        saved++;
      }
      if(saved===batch.length&&saved>1)setBatchMessage(`已保存 ${saved} 项改期`);
    }finally{saving.current=false;setSubmitting(false);if(saved===batch.length||saved===batch.length-1)setFrozen(undefined);}
  };
  const chip=(row:ActionRow,timed=false)=>{
    const key=calendarRowKey(row);
    const marker=timed?markersFor(row.task.dueDate||row.task.plannedDate||'').get(key):undefined;
    const c=categories.find(c=>c.id===row.task.category),t=planDueTime(row.task),isPending=pendingKeys.has(key);
    const previewing=!!drag&&calendarRowKey(drag.row)===key;
    const scrubbing=previewing&&gesture.current?.mode==='scrub';
    const shownTime=previewing&&drag!.target?drag!.target.time:t;
    const done=row.task.done||row.task.status==='done';
    return <div key={key} data-record-id={row.task.id} data-preview-key={key} data-pending={isPending||undefined} data-dragging={previewing||undefined} data-scrubbing={scrubbing||undefined} data-urgency={urgency(row.task)?.id||'unclassified'} title={`${row.task.title} · 截止 ${row.task.dueDate||row.task.plannedDate||'未安排'} ${shownTime||'全天'} · ${c?.name||'待分类'} · ${urgency(row.task)?.label||'象限待分类'}`} className={`calendar-chip state-${planState(row.task)}`} style={{...urgencyStyle(row.task),...(timed?{left:scrubbing&&drag!.target?.time?timelineOffset(drag!.target.time,hours):marker?.anchor??timelineOffset(t||'00:00',hours),top:scrubbing?gesture.current?.startTop??(marker?.lane||0)*LANE_HEIGHT+4:(marker?.lane||0)*LANE_HEIGHT+4,width:DEADLINE_WIDTH}: {})}} onPointerDown={e=>begin(e,row)} onPointerMove={move} onPointerUp={release} onPointerCancel={()=>end(!!pending.length)}>
      <label className="calendar-chip-check" data-done={done||undefined} onPointerDown={e=>e.stopPropagation()} onClick={e=>e.stopPropagation()}>
        <input type="checkbox" checked={done} disabled={busy} aria-label={`完成：${row.task.title}`} onChange={()=>onToggle(row)}/>
      </label>
      <button type="button" className="calendar-chip-copy" disabled={blocked} onClick={()=>{cancel();onEdit(rows.find(r=>calendarRowKey(r)===key)||row);}}><small>截止 {shownTime||'全天'} · {c?.name||'待分类'}{row.task.seriesId||row.task.recurrenceAnchor?' · 重复':''}{row.task.checkins?` · 打卡${row.task.checkins}次`:''}{isPending?' · 待确认':''}</small><strong>{row.task.title}</strong>{planState(row.task)!=='neutral'&&<span className={'calendar-state-badge badge-'+planState(row.task)}>{({done:'已完成',overdue:'已超期',soon:'即将到期',neutral:''})[planState(row.task)]}</span>}</button>
    </div>;
  };
  const dayRows=(date:string)=>displayRows.filter(r=>(r.task.dueDate||r.task.plannedDate)===date);
  const monthRows=(date:string)=>dayRows(date).sort((a,b)=>Number(pendingKeys.has(calendarRowKey(b)))-Number(pendingKeys.has(calendarRowKey(a)))).slice(0,3);
  const unarranged=displayRows.filter(row=>!row.task.dueDate&&!row.task.plannedDate);
  const renderTimeline=()=> <div className="calendar-timeline-canvas" style={{'--timeline-hours-width':`${axisWidth}px`,'--timeline-all-width':allDay?'var(--timeline-all-column-width,164px)':'0px'} as CSSProperties}>
    <div className="calendar-timeline-heading">
      <div className="timeline-corner">截止日期</div>
      {allDay&&<div className="timeline-all-heading">全天</div>}
      <div className="timeline-hour-axis" aria-label="截止小时刻度">{hours.map(hour=><span key={hour} style={{left:hours.indexOf(hour)*HOUR_WIDTH}}>{String(hour).padStart(2,'0')}:00</span>)}{!hours.length&&<span className="timeline-no-hours">暂无定时日程</span>}</div>
    </div>
    {days.map(date=><div className="calendar-timeline-row" data-date={date} key={date} style={{height:rowHeight(date)}}>
      <button type="button" className="timeline-date" data-calendar-date={date} data-drop-active={drag?.target?.date===date&&!drag.target.time||undefined} title={`${date} · 可拖入全天日程`} onClick={()=>setExpanded(expanded===date?undefined:date)} aria-label={`查看 ${date} 的日程`} aria-expanded={expanded===date}><strong>{date.slice(5)}</strong><small>{date.slice(0,4)} · 周{['日','一','二','三','四','五','六'][new Date(date+'T00:00:00Z').getUTCDay()]}</small><small>{dayRows(date).length} 项</small></button>
      {allDay&&<div className="timeline-all-day" data-calendar-date={date} data-drop-active={drag?.target?.date===date&&!drag.target.time||undefined}>{dayRows(date).filter(row=>!planDueTime(row.task)).map(row=>chip(row))}</div>}
      <div className="timeline-timed-cell" data-calendar-date={date} data-timed="true" data-drop-active={drag?.target?.date===date&&!!drag.target.time||undefined} style={{backgroundSize:`${HOUR_WIDTH}px 100%`}}><div className="timeline-markers" style={{height:contentHeight(date)}}>{dayRows(date).filter(row=>!!planDueTime(row.task)).map(row=>chip(row,true))}</div></div>
    </div>)}
    {!!unarranged.length&&<div className="timeline-unarranged-wrap"><details className="calendar-unarranged" style={{width:viewportWidth||'100%'}}><summary>未安排 · {unarranged.length}项</summary><div>{unarranged.map(row=>chip(row))}</div></details></div>}
  </div>;
  return <div className="plan-calendar" data-dragging={!!drag||undefined}>
    {drag&&gesture.current?.mode==='drag'&&createPortal(<div ref={ghost} className="calendar-drag-ghost" aria-hidden="true" style={{...urgencyStyle(drag.row.task),width:gesture.current.width,transform:`translate3d(${gesture.current.x-gesture.current.offsetX}px,${gesture.current.y-gesture.current.offsetY}px,0)`}}><strong>{drag.row.task.title}</strong><small>截止 {drag.target?`${drag.target.date} ${drag.target.time||'全天'}`:'拖动到目标日期'}</small></div>,document.body)}
    {drag&&<p className="calendar-feedback" role="status">{gesture.current?.mode==='scrub'?'左右滑动调整':'拖动'}「{drag.row.task.title}」{drag.target?` → ${drag.target.date} ${drag.target.time||'全天'}`:'到目标日期'} · Escape 取消</p>}

    {batchMessage&&<p className="calendar-batch-message" role="status">{batchMessage}</p>}
    <div ref={scroll} className="calendar-scroll" data-view={view}>
      {expanded&&view!=='month'&&<section className="calendar-expanded calendar-selected-day"><header><h3>{expanded} · {dayRows(expanded).length} 项</h3><button type="button" onClick={()=>setExpanded(undefined)}>收起</button></header>{dayRows(expanded).map(r=>chip(r))}</section>}
      {view==='month'?<div className="calendar-month">{['一','二','三','四','五','六','日'].map(d=><div className="calendar-weekday" key={d}>周{d}</div>)}{days.map(date=><section key={date} data-calendar-date={date} data-drop-active={drag?.target?.date===date} data-other-month={date.slice(0,7)!==anchor.slice(0,7)} data-selected={agendaDate===date||undefined} className="calendar-day"><button type="button" className="calendar-date" aria-label={`查看 ${date} 的日程`} onClick={()=>setExpanded(expanded===date?undefined:date)} aria-expanded={expanded===date}>{Number(date.slice(-2))}<small>{dayRows(date).length||''}</small></button>{monthRows(date).map(r=>chip(r))}{dayRows(date).length>3&&<button type="button" className="calendar-more" onClick={()=>setExpanded(date)}>查看全部 {dayRows(date).length} 项</button>}</section>)}</div>:renderTimeline()}
      {view==='month'&&!!unarranged.length&&<section className="calendar-expanded"><h3>未安排</h3>{unarranged.map(row=>chip(row))}</section>}
      {!!agendaDate&&<section className="calendar-day-agenda" aria-label={`${agendaDate} 的日程表`}><header><h3>{agendaDate} · 周{['日','一','二','三','四','五','六'][new Date(agendaDate+'T00:00:00Z').getUTCDay()]}</h3><small>{dayRows(agendaDate).length} 项日程</small>{expanded===agendaDate&&<button type="button" onClick={()=>setExpanded(undefined)}>收起</button>}</header>{dayRows(agendaDate).length?dayRows(agendaDate).map(r=>chip(r)):<p className="calendar-day-agenda-empty">这天暂无日程</p>}</section>}
    </div>
    <div className="calendar-action-slot" hidden={!pending.length&&!submitting}>
      <PlanActionDock className="calendar-drop-review" busy={blocked} onCancel={cancel} onConfirm={()=>void confirm()} label={pending.length>1?`确认改期（${pending.length}项）`:'确认改期'} status={submitting?`正在保存 ${progress.current}/${progress.total} 项改期`:pending.length===1?`待确认：截止 ${pending[0].target.date} ${pending[0].target.time||'全天'}，仅修改这一期`:`待确认：${pending.length} 项日程 · 仅修改截止时间`}/>
    </div>
  </div>;
}
