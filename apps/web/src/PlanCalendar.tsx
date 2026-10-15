import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { ChevronLeft, ChevronRight, GripVertical } from 'lucide-react';
import { createPortal } from 'react-dom';
import { visibleWeekHours,timeAtOffset,timeTop,HOUR_HEIGHT } from './calendarHours';
import type { ActionRow } from './api';
import { planClock, planState, planDueTime } from './planFilters';
import { usePlanCategories, categoryStyle } from './PlanCategories';
import {calendarRowKey,previewCalendarRows,updateCalendarPreviews,type CalendarPreview,type CalendarTarget} from './calendarPreview';
import './schedule.css';
import './schedule-refinements.css';

export function shiftDate(date:string,days:number){const d=new Date(date+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10);}
export function calendarRange(anchor:string,view:'week'|'month') {
  const d=new Date(anchor+'T00:00:00Z'),day=(d.getUTCDay()+6)%7;
  const first=view==='week'?shiftDate(anchor,-day):`${anchor.slice(0,7)}-01`;
  const from=view==='week'?first:shiftDate(first,-((new Date(first+'T00:00:00Z').getUTCDay()+6)%7));
  return {from,to:shiftDate(from,view==='week'?6:41)};
}
type Target=CalendarTarget;
export function PlanCalendar({view,anchor,onAnchor,rows,busy,onEdit,onMove,active=true}:{view:'week'|'month';anchor:string;onAnchor:(date:string)=>void;rows:ActionRow[];busy:boolean;onEdit:(row:ActionRow)=>void;onMove:(row:ActionRow,target:Target)=>Promise<boolean>;active?:boolean}) {
  const range=calendarRange(anchor,view),days=Array.from({length:view==='week'?7:42},(_,i)=>shiftDate(range.from,i));
  const {categories}=usePlanCategories();const scroll=useRef<HTMLDivElement>(null);
  const ghost=useRef<HTMLDivElement>(null);
  const [showAllHours,setShowAllHours]=useState(false);
  const [expanded,setExpanded]=useState<string>(),[drag,setDrag]=useState<{row:ActionRow;target?:Target}>(),[pending,setPending]=useState<CalendarPreview[]>([]);
  const [submitting,setSubmitting]=useState(false),[progress,setProgress]=useState({current:0,total:0}),[batchMessage,setBatchMessage]=useState('');
  const [frozenHours,setFrozenHours]=useState<number[]>();
  const saving=useRef(false);
  const moveCallback=useRef(onMove);moveCallback.current=onMove;
  const lastPreview=useRef<string|undefined>(undefined);
  const blocked=busy||submitting;
  const pendingKeys=new Set(pending.map(preview=>calendarRowKey(preview.row)));
  const displayRows=previewCalendarRows(rows,pending);
  const weekTimes=displayRows.filter(row=>days.includes(row.task.dueDate||row.task.plannedDate||'')).map(row=>planDueTime(row.task)||'');
  const hours=frozenHours||visibleWeekHours(weekTimes,showAllHours);
  const gesture=useRef<{row:ActionRow;x:number;y:number;offsetX:number;offsetY:number;width:number;active:boolean;timer?:number;pointer:number;button:HTMLButtonElement;target?:Target}|undefined>(undefined);
  const initialScroll=useRef('');
  const end=(retainHours=false)=>{const g=gesture.current;if(g){window.clearTimeout(g.timer);if(g.button.hasPointerCapture(g.pointer))g.button.releasePointerCapture(g.pointer);}gesture.current=undefined;setDrag(undefined);if(!retainHours)setFrozenHours(undefined);};
  const cancel=()=>{if(saving.current)return;setPending([]);setBatchMessage('');end();};
  useEffect(()=>{setExpanded(undefined);setPending([]);setBatchMessage('');end();},[view,anchor,active]);
  useEffect(()=>{
    if(!pending.length)return;
    const frame=requestAnimationFrame(()=>{
      // The review bar changes the available height after release. Keep the preview reachable.
      const card=Array.from(scroll.current?.querySelectorAll<HTMLElement>('.calendar-chip[data-pending=true]')||[]).find(card=>card.dataset.previewKey===lastPreview.current);
      card?.scrollIntoView({block:'nearest',inline:'nearest'});
    });
    return()=>cancelAnimationFrame(frame);
  },[pending]);
  useEffect(()=>{
    if(view!=='week'){initialScroll.current='';return;}
    const key=range.from+showAllHours;
    if(initialScroll.current===key)return;
    initialScroll.current=key;
    const frame=requestAnimationFrame(()=>{if(scroll.current)scroll.current.scrollTop=showAllHours?Math.max(0,(weekTimes.filter(Boolean).length?Math.min(...weekTimes.filter(Boolean).map(t=>Number(t.slice(0,2)))):9)-1)*HOUR_HEIGHT:0;});
    return()=>cancelAnimationFrame(frame);
  },[view,anchor,showAllHours]);
  useEffect(()=>{const key=(e:KeyboardEvent)=>{if(e.key==='Escape')cancel();};window.addEventListener('keydown',key);return()=>{window.removeEventListener('keydown',key);window.clearTimeout(gesture.current?.timer);};},[]);
  useEffect(()=>{if(!drag)return;const timer=window.setInterval(()=>{const g=gesture.current,box=scroll.current;if(!g||!box)return;const r=box.getBoundingClientRect();if(g.y<r.top+50)box.scrollTop-=14;else if(g.y>r.bottom-50)box.scrollTop+=14;if(g.x<r.left+35)box.scrollLeft-=14;else if(g.x>r.right-35)box.scrollLeft+=14;updateTarget();},35);return()=>window.clearInterval(timer);},[!!drag]);
  const begin=(e:PointerEvent<HTMLButtonElement>,row:ActionRow)=>{
    if(blocked||saving.current||!active||row.task.done||row.task.status==='done'||row.task.status==='cancelled'||row.task.deletedAt)return;
    setBatchMessage('');
    const rect=e.currentTarget.closest('.calendar-chip')!.getBoundingClientRect();
    const g={row,x:e.clientX,y:e.clientY,offsetX:Math.min(e.clientX-rect.left,240),offsetY:e.clientY-rect.top,width:Math.max(160,Math.min(rect.width,280)),active:e.pointerType==='mouse',pointer:e.pointerId,button:e.currentTarget} as NonNullable<typeof gesture.current>;
    gesture.current=g;e.currentTarget.setPointerCapture(e.pointerId);
    if(g.active){setFrozenHours(hours);setDrag({row});}else g.timer=window.setTimeout(()=>{g.active=true;setFrozenHours(hours);setDrag({row});},350);
  };
  const move=(e:PointerEvent<HTMLButtonElement>)=>{
    const g=gesture.current;if(!g)return;if(!g.active){if(Math.hypot(e.clientX-g.x,e.clientY-g.y)>10)end(!!pending.length);return;}
    e.preventDefault();g.x=e.clientX;g.y=e.clientY;
    updateTarget();
  };
  const updateTarget=()=>{
    const g=gesture.current;if(!g?.active)return;
    if(ghost.current)ghost.current.style.transform=`translate3d(${g.x-g.offsetX}px,${g.y-g.offsetY}px,0)`;
    const el=document.elementFromPoint(g.x,g.y)?.closest<HTMLElement>('[data-calendar-date]');
    if(!el){g.target=undefined;setDrag({row:g.row});return;}
    let time=planDueTime(g.row.task)||'';
    if(view==='week'&&el.dataset.timed==='true'){const rect=el.getBoundingClientRect();time=timeAtOffset(g.y-rect.top,hours);}
    else if(view==='week')time='';
    g.target={date:el.dataset.calendarDate!,time};setDrag({row:g.row,target:g.target});
  };
  const release=()=>{const g=gesture.current;if(!g?.active){end(!!pending.length);return;}const next=updateCalendarPreviews(pending,g.row,g.target);lastPreview.current=calendarRowKey(g.row);setPending(next);if(g.target&&view==='month'&&window.matchMedia('(max-width:599px)').matches)setExpanded(g.target.date);end(!!next.length);};
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
    }finally{saving.current=false;setSubmitting(false);if(saved===batch.length||saved===batch.length-1)setFrozenHours(undefined);}
  };
  const chip=(row:ActionRow,timed=false)=>{const c=categories.find(c=>c.id===row.task.category),t=planDueTime(row.task),isPending=pendingKeys.has(calendarRowKey(row));return <div key={calendarRowKey(row)} data-record-id={row.task.id} data-preview-key={calendarRowKey(row)} data-pending={isPending||undefined} data-dragging={drag&&calendarRowKey(drag.row)===calendarRowKey(row)||undefined} className={`calendar-chip state-${planState(row.task)}`} style={{...categoryStyle(c?.color),...(timed?{top:timeTop(t||'00:00',hours)}: {})}}>
    <button type="button" className="calendar-chip-copy" disabled={blocked} onClick={()=>{cancel();onEdit(rows.find(r=>calendarRowKey(r)===calendarRowKey(row))||row);}}><small>截止 {t||'全天'}{row.task.seriesId||row.task.recurrenceAnchor?' · 重复':''}{row.task.checkins?` · 打卡${row.task.checkins}次`:''}{isPending?' · 待确认':''}</small><strong>{row.task.title}</strong></button>
    <button type="button" className="calendar-drag-handle" aria-label={'拖动截止时间：'+row.task.title} title="长按拖动截止时间；点击卡片编辑" disabled={blocked||row.task.done||row.task.status==='done'||row.task.status==='cancelled'||!!row.task.deletedAt} onPointerDown={e=>begin(e,row)} onPointerMove={move} onPointerUp={release} onPointerCancel={()=>end(!!pending.length)}><GripVertical size={17}/></button>
  </div>;};
  const dayRows=(date:string)=>displayRows.filter(r=>(r.task.dueDate||r.task.plannedDate)===date);
  const monthRows=(date:string)=>dayRows(date).sort((a,b)=>Number(pendingKeys.has(calendarRowKey(b)))-Number(pendingKeys.has(calendarRowKey(a)))).slice(0,3);
  return <div className="plan-calendar" data-dragging={!!drag||undefined}><header className="calendar-heading"><div><strong>{view==='week'?`${range.from.slice(5)} — ${range.to.slice(5)}`:anchor.slice(0,7)}</strong><small>截止时间</small></div><nav aria-label="日历日期">{view==='week'&&<button type="button" className="calendar-hours-toggle" aria-pressed={showAllHours} disabled={!!drag||!!pending.length||blocked} onClick={()=>setShowAllHours(v=>!v)}>{showAllHours?'隐藏空白时段':'显示全部时段'}</button>}<button type="button" disabled={blocked} aria-label="上一期" onClick={()=>onAnchor(view==='week'?shiftDate(anchor,-7):shiftDate(`${anchor.slice(0,7)}-01`,-1))}><ChevronLeft size={18}/></button><button type="button" disabled={blocked} onClick={()=>onAnchor(planClock().date)}>今天</button><button type="button" disabled={blocked} aria-label="下一期" onClick={()=>{const d=new Date(`${anchor.slice(0,7)}-01T00:00:00Z`);d.setUTCMonth(d.getUTCMonth()+1);onAnchor(view==='week'?shiftDate(anchor,7):d.toISOString().slice(0,10));}}><ChevronRight size={18}/></button></nav></header>
    {drag&&gesture.current&&createPortal(<div ref={ghost} className="calendar-drag-ghost" aria-hidden="true" style={{...categoryStyle(categories.find(c=>c.id===drag.row.task.category)?.color),width:gesture.current.width,transform:`translate3d(${gesture.current.x-gesture.current.offsetX}px,${gesture.current.y-gesture.current.offsetY}px,0)`}}><strong>{drag.row.task.title}</strong><small>截止 {drag.target?`${drag.target.date} ${drag.target.time||'全天'}`:'拖动到目标日期'}</small></div>,document.body)}
    {drag&&<p className="calendar-feedback" role="status">拖动「{drag.row.task.title}」{drag.target?` → ${drag.target.date} ${drag.target.time||'全天'}`:'到目标日期'} · Escape 取消</p>}
    {(pending.length>0||submitting)&&<div className="calendar-drop-review" role="status"><span>{submitting?`正在保存 ${progress.current}/${progress.total} 项改期`:pending.length===1?`待确认：截止 ${pending[0].target.date} ${pending[0].target.time||'全天'}，仅修改这一期`:`待确认：${pending.length} 项日程 · 仅修改截止时间`}</span><button disabled={blocked} type="button" className="save-button" onClick={()=>void confirm()}>{blocked?'正在保存…':pending.length>1?`确认改期（${pending.length}项）`:'确认改期'}</button><button disabled={blocked} type="button" onClick={cancel}>取消</button></div>}
    {batchMessage&&<p className="calendar-batch-message" role="status">{batchMessage}</p>}
    <div ref={scroll} className="calendar-scroll" data-view={view}>
      {expanded&&<section className="calendar-expanded calendar-selected-day"><header><h3>{expanded} · {dayRows(expanded).length} 项</h3><button type="button" onClick={()=>setExpanded(undefined)}>收起</button></header>{dayRows(expanded).map(r=>chip(r))}</section>}
      {view==='month'?<div className="calendar-month">{['一','二','三','四','五','六','日'].map(d=><div className="calendar-weekday" key={d}>周{d}</div>)}{days.map(date=><section key={date} data-calendar-date={date} data-drop-active={drag?.target?.date===date} data-other-month={date.slice(0,7)!==anchor.slice(0,7)} className="calendar-day"><button type="button" className="calendar-date" aria-label={`查看 ${date} 的日程`} onClick={()=>setExpanded(expanded===date?undefined:date)} aria-expanded={expanded===date}>{Number(date.slice(-2))}<small>{dayRows(date).length||''}</small></button>{monthRows(date).map(r=>chip(r))}{dayRows(date).length>3&&<button type="button" className="calendar-more" onClick={()=>setExpanded(date)}>查看全部 {dayRows(date).length} 项</button>}</section>)}</div>:<div className="calendar-week"><div className="calendar-week-top">时间</div>{days.map(date=><button type="button" className="calendar-week-top" key={date} onClick={()=>setExpanded(expanded===date?undefined:date)} aria-label={`查看 ${date} 的日程`}>{date.slice(5)}<small>周{['日','一','二','三','四','五','六'][new Date(date+'T00:00:00Z').getUTCDay()]} · {dayRows(date).length} 项</small></button>)}<div className="calendar-all-label">全天</div>{days.map(date=><div className="calendar-all-day" data-calendar-date={date} key={'all'+date} data-drop-active={drag?.target?.date===date}>{dayRows(date).filter(r=>!(planDueTime(r.task))).map(r=>chip(r))}</div>)}{!!hours.length&&<><div className="calendar-hours" style={{gridTemplateRows:`repeat(${hours.length},${HOUR_HEIGHT}px)`}}>{hours.map(h=><span key={h}>{String(h).padStart(2,'0')}:00</span>)}</div>{days.map(date=><div className="calendar-day-hours" style={{height:hours.length*HOUR_HEIGHT+44}} data-calendar-date={date} data-timed="true" data-drop-active={drag?.target?.date===date} key={'hours'+date}>{dayRows(date).filter(r=>!!(planDueTime(r.task))).map(r=>chip(r,true))}</div>)}</>}</div>}
      {!!displayRows.filter(r=>!r.task.dueDate&&!r.task.plannedDate).length&&<section className="calendar-expanded"><h3>未安排</h3>{displayRows.filter(r=>!r.task.dueDate&&!r.task.plannedDate).map(r=>chip(r))}</section>}
    </div>
  </div>;
}
