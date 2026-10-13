import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { ChevronLeft, ChevronRight, GripVertical } from 'lucide-react';
import { createPortal } from 'react-dom';
import { visibleWeekHours,timeAtOffset,timeTop,HOUR_HEIGHT } from './calendarHours';
import type { ActionRow } from './api';
import { planClock, planState, planDueTime } from './planFilters';
import { usePlanCategories, categoryStyle } from './PlanCategories';
import './schedule.css';
import './schedule-refinements.css';

export function shiftDate(date:string,days:number){const d=new Date(date+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10);}
export function calendarRange(anchor:string,view:'week'|'month') {
  const d=new Date(anchor+'T00:00:00Z'),day=(d.getUTCDay()+6)%7;
  const first=view==='week'?shiftDate(anchor,-day):`${anchor.slice(0,7)}-01`;
  const from=view==='week'?first:shiftDate(first,-((new Date(first+'T00:00:00Z').getUTCDay()+6)%7));
  return {from,to:shiftDate(from,view==='week'?6:41)};
}
type Target={date:string;time:string};
export function PlanCalendar({view,anchor,onAnchor,rows,busy,onEdit,onMove}:{view:'week'|'month';anchor:string;onAnchor:(date:string)=>void;rows:ActionRow[];busy:boolean;onEdit:(row:ActionRow)=>void;onMove:(row:ActionRow,target:Target)=>Promise<boolean>}) {
  const range=calendarRange(anchor,view),days=Array.from({length:view==='week'?7:42},(_,i)=>shiftDate(range.from,i));
  const {categories}=usePlanCategories();const scroll=useRef<HTMLDivElement>(null);
  const ghost=useRef<HTMLDivElement>(null);
  const [showAllHours,setShowAllHours]=useState(false);
  const weekTimes=rows.filter(row=>days.includes(row.task.dueDate||row.task.plannedDate||'')).map(row=>planDueTime(row.task)||'');
  const hours=visibleWeekHours(weekTimes,showAllHours);
  const [expanded,setExpanded]=useState<string>(),[drag,setDrag]=useState<{row:ActionRow;target?:Target}>(),[pending,setPending]=useState<{row:ActionRow;target:Target}>();
  const gesture=useRef<{row:ActionRow;x:number;y:number;offsetX:number;offsetY:number;width:number;active:boolean;timer?:number;pointer:number;button:HTMLButtonElement;target?:Target}|undefined>(undefined);
  const initialScroll=useRef('');
  const end=()=>{const g=gesture.current;if(g){window.clearTimeout(g.timer);if(g.button.hasPointerCapture(g.pointer))g.button.releasePointerCapture(g.pointer);}gesture.current=undefined;setDrag(undefined);};
  useEffect(()=>{setExpanded(undefined);setPending(undefined);end();},[view,anchor]);
  useEffect(()=>{
    if(view!=='week'){initialScroll.current='';return;}
    const key=range.from+showAllHours;
    if(initialScroll.current===key)return;
    initialScroll.current=key;
    const frame=requestAnimationFrame(()=>{if(scroll.current)scroll.current.scrollTop=showAllHours?Math.max(0,(weekTimes.filter(Boolean).length?Math.min(...weekTimes.filter(Boolean).map(t=>Number(t.slice(0,2)))):9)-1)*HOUR_HEIGHT:0;});
    return()=>cancelAnimationFrame(frame);
  },[view,anchor,showAllHours]);
  useEffect(()=>{const key=(e:KeyboardEvent)=>{if(e.key==='Escape'){end();setPending(undefined);}};window.addEventListener('keydown',key);return()=>{window.removeEventListener('keydown',key);window.clearTimeout(gesture.current?.timer);};},[]);
  useEffect(()=>{if(!drag)return;const timer=window.setInterval(()=>{const g=gesture.current,box=scroll.current;if(!g||!box)return;const r=box.getBoundingClientRect();if(g.y<r.top+50)box.scrollTop-=14;else if(g.y>r.bottom-50)box.scrollTop+=14;if(g.x<r.left+35)box.scrollLeft-=14;else if(g.x>r.right-35)box.scrollLeft+=14;updateTarget();},35);return()=>window.clearInterval(timer);},[!!drag]);
  const begin=(e:PointerEvent<HTMLButtonElement>,row:ActionRow)=>{
    if(busy||row.task.done||row.task.status==='done'||row.task.status==='cancelled'||row.task.deletedAt)return;
    const rect=e.currentTarget.closest('.calendar-chip')!.getBoundingClientRect();
    const g={row,x:e.clientX,y:e.clientY,offsetX:Math.min(e.clientX-rect.left,240),offsetY:e.clientY-rect.top,width:Math.max(160,Math.min(rect.width,280)),active:e.pointerType==='mouse',pointer:e.pointerId,button:e.currentTarget} as NonNullable<typeof gesture.current>;
    gesture.current=g;e.currentTarget.setPointerCapture(e.pointerId);
    if(g.active)setDrag({row});else g.timer=window.setTimeout(()=>{g.active=true;setDrag({row});},350);
  };
  const move=(e:PointerEvent<HTMLButtonElement>)=>{
    const g=gesture.current;if(!g)return;if(!g.active){if(Math.hypot(e.clientX-g.x,e.clientY-g.y)>10)end();return;}
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
  const release=()=>{const g=gesture.current;if(g?.active&&g.target)setPending({row:g.row,target:g.target});end();};
  const chip=(row:ActionRow,timed=false)=>{const c=categories.find(c=>c.id===row.task.category),t=planDueTime(row.task),minutes=t?Number(t.slice(0,2))*60+Number(t.slice(3)):0;return <div key={row.task.id} data-dragging={drag?.row.task.id===row.task.id||undefined} className={`calendar-chip state-${planState(row.task)}`} style={{...categoryStyle(c?.color),...(timed?{top:timeTop(t||'00:00',hours)}: {})}}>
    <button type="button" className="calendar-chip-copy" onClick={()=>onEdit(row)}><small>截止 {t||'全天'}{row.task.seriesId||row.task.recurrenceAnchor?' · 重复':''}</small><strong>{row.task.title}</strong></button>
    <button type="button" className="calendar-drag-handle" aria-label={'拖动截止时间：'+row.task.title} title="长按拖动截止时间；点击卡片编辑" disabled={busy||row.task.done||row.task.status==='done'||row.task.status==='cancelled'||!!row.task.deletedAt} onPointerDown={e=>begin(e,row)} onPointerMove={move} onPointerUp={release} onPointerCancel={end}><GripVertical size={17}/></button>
  </div>;};
  const dayRows=(date:string)=>rows.filter(r=>(r.task.dueDate||r.task.plannedDate)===date);
  return <div className="plan-calendar"><header className="calendar-heading"><div><strong>{view==='week'?`${range.from.slice(5)} — ${range.to.slice(5)}`:anchor.slice(0,7)}</strong><small>截止时间 · 上海时间</small></div><nav aria-label="日历日期">{view==='week'&&<button type="button" className="calendar-hours-toggle" aria-pressed={showAllHours} disabled={!!drag} onClick={()=>setShowAllHours(v=>!v)}>{showAllHours?'隐藏空白时段':'显示全部时段'}</button>}<button type="button" aria-label="上一期" onClick={()=>onAnchor(view==='week'?shiftDate(anchor,-7):shiftDate(`${anchor.slice(0,7)}-01`,-1))}><ChevronLeft size={18}/></button><button type="button" onClick={()=>onAnchor(planClock().date)}>今天</button><button type="button" aria-label="下一期" onClick={()=>{const d=new Date(`${anchor.slice(0,7)}-01T00:00:00Z`);d.setUTCMonth(d.getUTCMonth()+1);onAnchor(view==='week'?shiftDate(anchor,7):d.toISOString().slice(0,10));}}><ChevronRight size={18}/></button></nav></header>
    {drag&&gesture.current&&createPortal(<div ref={ghost} className="calendar-drag-ghost" aria-hidden="true" style={{...categoryStyle(categories.find(c=>c.id===drag.row.task.category)?.color),width:gesture.current.width,transform:`translate3d(${gesture.current.x-gesture.current.offsetX}px,${gesture.current.y-gesture.current.offsetY}px,0)`}}><strong>{drag.row.task.title}</strong><small>截止 {drag.target?`${drag.target.date} ${drag.target.time||'全天'}`:'拖动到目标日期'}</small></div>,document.body)}
    {drag&&<p className="calendar-feedback" role="status">拖动「{drag.row.task.title}」{drag.target?` → ${drag.target.date} ${drag.target.time||'全天'}`:'到目标日期'} · Escape 取消</p>}
    {pending&&<div className="calendar-drop-review" role="status"><span>截止改为 {pending.target.date} {pending.target.time||'全天'}，仅修改这一期</span><button disabled={busy} type="button" className="save-button" onClick={()=>void onMove(pending.row,pending.target).then(ok=>{if(ok)setPending(undefined);})}>确认改期</button><button disabled={busy} type="button" onClick={()=>setPending(undefined)}>取消</button></div>}
    <div ref={scroll} className="calendar-scroll" data-view={view}>
      {expanded&&<section className="calendar-expanded calendar-selected-day"><header><h3>{expanded} · {dayRows(expanded).length} 项</h3><button type="button" onClick={()=>setExpanded(undefined)}>收起</button></header>{dayRows(expanded).map(r=>chip(r))}</section>}
      {view==='month'?<div className="calendar-month">{['一','二','三','四','五','六','日'].map(d=><div className="calendar-weekday" key={d}>周{d}</div>)}{days.map(date=><section key={date} data-calendar-date={date} data-drop-active={drag?.target?.date===date} data-other-month={date.slice(0,7)!==anchor.slice(0,7)} className="calendar-day"><button type="button" className="calendar-date" aria-label={`查看 ${date} 的日程`} onClick={()=>setExpanded(expanded===date?undefined:date)} aria-expanded={expanded===date}>{Number(date.slice(-2))}<small>{dayRows(date).length||''}</small></button>{dayRows(date).slice(0,3).map(r=>chip(r))}{dayRows(date).length>3&&<button type="button" className="calendar-more" onClick={()=>setExpanded(date)}>查看全部 {dayRows(date).length} 项</button>}</section>)}</div>:<div className="calendar-week"><div className="calendar-week-top">时间</div>{days.map(date=><button type="button" className="calendar-week-top" key={date} onClick={()=>setExpanded(expanded===date?undefined:date)} aria-label={`查看 ${date} 的日程`}>{date.slice(5)}<small>周{['日','一','二','三','四','五','六'][new Date(date+'T00:00:00Z').getUTCDay()]} · {dayRows(date).length} 项</small></button>)}<div className="calendar-all-label">全天</div>{days.map(date=><div className="calendar-all-day" data-calendar-date={date} key={'all'+date} data-drop-active={drag?.target?.date===date}>{dayRows(date).filter(r=>!(planDueTime(r.task))).map(r=>chip(r))}</div>)}{!!hours.length&&<><div className="calendar-hours" style={{gridTemplateRows:`repeat(${hours.length},${HOUR_HEIGHT}px)`}}>{hours.map(h=><span key={h}>{String(h).padStart(2,'0')}:00</span>)}</div>{days.map(date=><div className="calendar-day-hours" style={{height:hours.length*HOUR_HEIGHT+44}} data-calendar-date={date} data-timed="true" data-drop-active={drag?.target?.date===date} key={'hours'+date}>{dayRows(date).filter(r=>!!(planDueTime(r.task))).map(r=>chip(r,true))}</div>)}</>}</div>}
      {!!rows.filter(r=>!r.task.dueDate&&!r.task.plannedDate).length&&<section className="calendar-expanded"><h3>未安排</h3>{rows.filter(r=>!r.task.dueDate&&!r.task.plannedDate).map(r=>chip(r))}</section>}
    </div>
  </div>;
}
