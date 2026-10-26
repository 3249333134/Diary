import { useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { visibleWeekHours } from './calendarHours';
import { HOUR_WIDTH, DEADLINE_WIDTH, LANE_HEIGHT, timelineMarkers, timelineOffset, timelineTime, hiddenHourRanges, offscreenDirection } from './calendarTimeline';
import type { ActionRow } from './api';
import { planState, planDueTime, planClock } from './planFilters';
import { usePlanCategories } from './PlanCategories';
import { urgency, urgencyStyle } from './planUrgency';
import { PlanActionDock } from './PlanActionDock';
import { calendarRange, shiftDate, type CalendarView } from './calendarDates';
export { calendarRange, shiftDate } from './calendarDates';
import {calendarRowKey,previewCalendarRows,updateCalendarPreviews,type CalendarPreview,type CalendarTarget} from './calendarPreview';
import { useFrameTask } from './useFrameTask';
import { SharedPlanBadge } from './SharedPlanBadge';
import { GripVertical, Users } from 'lucide-react';
import { monthAgendaGroups, monthDaySummary, monthGridDates, selectedMonthDate } from './calendarMonth';
import './schedule.css';
import './schedule-refinements.css';

type Target=CalendarTarget;
type GestureMode='decide'|'drag'|'scrub'|'scroll';
type Gesture={row:ActionRow;x:number;y:number;startX:number;startY:number;lastX:number;lastY:number;offsetX:number;offsetY:number;width:number;startTop:number;mode:GestureMode;timer?:number;pointer:number;el:HTMLElement;target?:Target;date:string;startMinutes:number;minutes:number;edgeTick:number};
type CanvasPan={pointer:number;x:number;y:number;nextX:number;nextY:number;left:number;top:number;el:HTMLDivElement;moved:boolean};
const minutesOf=(time:string)=>{const[h,m]=time.split(':').map(Number);return(h||0)*60+(m||0);};
const formatMinutes=(minutes:number)=>`${String(Math.floor(minutes/60)).padStart(2,'0')}:${String(minutes%60).padStart(2,'0')}`;
/** 拖动/滑动调时间时使用完整 24 小时刻度，落点连续，不会跳过被压缩的小时 */
const ALL_HOURS=Array.from({length:24},(_,hour)=>hour);
export function PlanCalendar({view,anchor,rows,busy,onEdit,onMove,onToggle,active=true,showAllHours=false,onInteractionChange,onOpenHoursSettings,monthDate,onMonthDate,navigationRevision=0}:{navigationRevision?:number;monthDate?:string;onMonthDate:(date:string)=>void;onOpenHoursSettings:()=>void;view:CalendarView;anchor:string;showAllHours?:boolean;onInteractionChange?:(state:{dragging:boolean;pending:boolean;saving:boolean})=>void;rows:ActionRow[];busy:boolean;onEdit:(row:ActionRow)=>void;onMove:(row:ActionRow,target:Target)=>Promise<boolean>;onToggle:(row:ActionRow)=>void;active?:boolean}) {
  const range=useMemo(()=>calendarRange(anchor,view),[anchor,view]);
  /** 两周视图可在两端继续扩展，滑动即可看到更早/更晚的周 */
  const [weeks,setWeeks]=useState({before:0,after:0});
  const days=useMemo(()=>Array.from({length:view==='fortnight'?14+weeks.before*7+weeks.after*7:view==='month'?42:7},(_,i)=>shiftDate(range.from,view==='fortnight'?i-weeks.before*7:i)),[range,view,weeks]);
  const monthDays=useMemo(()=>monthGridDates(anchor),[anchor.slice(0,7)]);
  const {categories}=usePlanCategories();const scroll=useRef<HTMLDivElement>(null);
  const edgeLock=useRef(0),edgePending=useRef<{mode:'before'|'after';height:number;top:number}|undefined>(undefined);
  const ghost=useRef<HTMLDivElement>(null);
  const gesture=useRef<Gesture|undefined>(undefined);
  const [expanded,setExpanded]=useState<string>(),[drag,setDrag]=useState<{row:ActionRow;target?:Target}>(),[pending,setPending]=useState<CalendarPreview[]>([]);
  const timelinePosition=useRef({left:0,top:0}),dayHeading=useRef<HTMLHeadingElement>(null),dayMode=useRef(false);
  const showDay=(date:string)=>{if(scroll.current)timelinePosition.current={left:scroll.current.scrollLeft,top:scroll.current.scrollTop};setExpanded(date);};
  const closeDay=()=>{const date=expanded;setExpanded(undefined);requestAnimationFrame(()=>scroll.current?.querySelector<HTMLButtonElement>(`.timeline-date[data-calendar-date="${date}"]`)?.focus({preventScroll:true}));};
  useLayoutEffect(()=>{if(!expanded&&!dayMode.current)return;dayMode.current=!!expanded;const box=scroll.current;if(!box)return;if(expanded&&!drag){box.scrollLeft=0;box.scrollTop=0;dayHeading.current?.focus({preventScroll:true});}else{box.scrollLeft=timelinePosition.current.left;box.scrollTop=timelinePosition.current.top;}},[expanded,!!drag]);
  const agendaDate=selectedMonthDate(anchor,planClock().date,monthDate);
  const [monthFocus,setMonthFocus]=useState('');
  const [submitting,setSubmitting]=useState(false),[progress,setProgress]=useState({current:0,total:0}),[batchMessage,setBatchMessage]=useState('');
  const [frozen,setFrozen]=useState<{hours:number[];heights:Record<string,number>;allDay:boolean}>();
  const [viewportWidth,setViewportWidth]=useState(0);
  const [offscreen,setOffscreen]=useState<Record<string,{left:number;right:number}>>({});
  const saving=useRef(false);
  const moveCallback=useRef(onMove);moveCallback.current=onMove;
  const lastPreview=useRef<string|undefined>(undefined);
  const blocked=busy||submitting;
  useEffect(()=>{onInteractionChange?.({dragging:!!drag,pending:!!pending.length,saving:submitting});},[!!drag,!!pending.length,submitting,onInteractionChange]);
  useEffect(()=>()=>onInteractionChange?.({dragging:false,pending:false,saving:false}),[onInteractionChange]);
  const pendingKeys=useMemo(()=>new Set(pending.map(preview=>calendarRowKey(preview.row))),[pending]);
  const displayRows=useMemo(()=>previewCalendarRows(rows,pending),[rows,pending]);
  const rowsByDate=useMemo(()=>{
    const grouped=new Map<string,ActionRow[]>();
    for(const row of displayRows){const date=row.task.dueDate||row.task.plannedDate||'';const group=grouped.get(date);if(group)group.push(row);else grouped.set(date,[row]);}
    return grouped;
  },[displayRows]);
  const monthSummaries=useMemo(()=>new Map(monthDays.map(date=>[date,monthDaySummary(rowsByDate.get(date)||[])])),[monthDays,rowsByDate]);
  const agendaGroups=useMemo(()=>monthAgendaGroups(rowsByDate.get(agendaDate)||[]),[rowsByDate,agendaDate]);
  const rangeRows=useMemo(()=>displayRows.filter(row=>days.includes(row.task.dueDate||row.task.plannedDate||'')),[displayRows,days]);
  const times=useMemo(()=>rangeRows.map(row=>planDueTime(row.task)||''),[rangeRows]);
  const hours=useMemo(()=>frozen?.hours||visibleWeekHours(times,showAllHours),[frozen,times,showAllHours]);
  const markersByDate=useMemo(()=>new Map(days.map(date=>[date,timelineMarkers((rowsByDate.get(date)||[]).filter(row=>planDueTime(row.task)).map(row=>({key:calendarRowKey(row),time:planDueTime(row.task)!})),hours)])),[days,rowsByDate,hours]);
  const markersFor=(date:string)=>markersByDate.get(date)||new Map<string,{anchor:number;lane:number}>();
  const allDay=!!frozen?.allDay||rangeRows.some(row=>!planDueTime(row.task));
  const contentHeight=(date:string)=>Math.max(60,...[...markersFor(date).values()].map(marker=>(marker.lane+1)*LANE_HEIGHT+8),(rowsByDate.get(date)||[]).filter(row=>!planDueTime(row.task)).length*LANE_HEIGHT+8);
  const rowHeight=(date:string)=>frozen?.heights[date]||contentHeight(date);
  const axisWidth=Math.max(hours.length*HOUR_WIDTH,...[...markersByDate.values()].flatMap(markers=>[...markers.values()].map(marker=>marker.anchor+DEADLINE_WIDTH+12)));
  const freeze=(row:ActionRow,allHours=false)=>setFrozen(old=>old||{hours:allHours?ALL_HOURS:hours.length?hours:planDueTime(row.task)?[Number(planDueTime(row.task)!.slice(0,2))]:[],heights:Object.fromEntries(days.map(date=>[date,contentHeight(date)])),allDay:allDay||!planDueTime(row.task)});
  /** 拖动时切换为完整时间线，横向滚动补偿让卡片仍停在手指下方 */
  const anchorShift=useRef<number|null>(null);
  useEffect(()=>{if(anchorShift.current===null)return;const box=scroll.current;if(box)box.scrollLeft+=anchorShift.current;anchorShift.current=null;},[frozen]);
  useEffect(()=>{const box=scroll.current;if(!box)return;const observer=new ResizeObserver(()=>setViewportWidth(box.clientWidth));observer.observe(box);return()=>observer.disconnect();},[]);
  useEffect(()=>{
    const box=scroll.current;if(!box||!active||view==='month')return;
    let frame=0;
    const measure=()=>{
      frame=0;if(!box.clientWidth)return;const viewport=box.getBoundingClientRect(),next:Record<string,{left:number;right:number}>={};
      box.querySelectorAll<HTMLElement>('.calendar-timeline-row').forEach(row=>{
        const date=row.dataset.date!,label=row.querySelector<HTMLElement>('.timeline-date')!,visibleLeft=Math.max(viewport.left,label.getBoundingClientRect().right);
        const counts={left:0,right:0};
        row.querySelectorAll<HTMLElement>('.calendar-chip').forEach(card=>{const rect=card.getBoundingClientRect(),direction=offscreenDirection(rect.left,rect.right,visibleLeft,viewport.left+box.clientWidth);if(direction)counts[direction]++;});
        if(counts.left||counts.right)next[date]=counts;
      });
      setOffscreen(old=>JSON.stringify(old)===JSON.stringify(next)?old:next);
    };
    const schedule=()=>{if(!frame)frame=requestAnimationFrame(measure);};
    box.addEventListener('scroll',schedule,true);schedule();
    return()=>{box.removeEventListener('scroll',schedule,true);cancelAnimationFrame(frame);};
  },[view,anchor,active,showAllHours,viewportWidth,rows,pending,frozen,expanded,!!drag,drag&&gesture.current?.mode==='scrub'?drag.target?.time:undefined]);
  const pan=useRef<CanvasPan|undefined>(undefined);
  const suppressGestureClick=useRef(false);
  const [panning,setPanning]=useState(false);
  const gestureScrollBox=(g:Gesture)=>{
    const box=scroll.current;if(!box||view!=='month'||viewportWidth<900)return box;
    return document.elementFromPoint(g.x,g.y)?.closest<HTMLElement>('[data-month-scroll]')||g.el.closest<HTMLElement>('[data-month-scroll]')||box;
  };
  const panFrame=useFrameTask(()=>{
    const current=pan.current;if(!current?.moved)return;
    current.el.scrollLeft=current.left-(current.nextX-current.x);
    current.el.scrollTop=current.top-(current.nextY-current.y);
  });
  const pointerFrame=useFrameTask(()=>{
    const g=gesture.current;if(!g)return;
    if(g.mode==='scroll'){
      const box=gestureScrollBox(g);if(box){box.scrollLeft-=g.x-g.lastX;box.scrollTop-=g.y-g.lastY;}
      g.lastX=g.x;g.lastY=g.y;
    }else if(g.mode==='scrub')applyScrub(g);
    else updateTarget();
  });
  const endPan=()=>{
    panFrame.cancel();
    const current=pan.current;pan.current=undefined;
    if(current?.moved)suppressGestureClick.current=true;
    if(current?.el.hasPointerCapture(current.pointer))current.el.releasePointerCapture(current.pointer);
    setPanning(false);
  };
  const beginPan=(e:PointerEvent<HTMLDivElement>)=>{
    if(!active||view==='month'||pan.current||gesture.current||!e.isPrimary||e.button!==0)return;
    const target=e.target as HTMLElement;
    if(target.closest('.calendar-chip,button,input,select,textarea,a,summary,[role=button]'))return;
    const surface=target.closest<HTMLElement>('.timeline-timed-cell,.timeline-all-day');
    if(!surface||!e.currentTarget.contains(surface))return;
    // Leave native scrollbars and all card controls to their own interactions.
    for(const box of [surface,e.currentTarget]){
      const rect=box.getBoundingClientRect();
      if(e.clientX>=rect.left+box.clientLeft+box.clientWidth||e.clientY>=rect.top+box.clientTop+box.clientHeight)return;
    }
    const el=e.currentTarget;
    pan.current={pointer:e.pointerId,x:e.clientX,y:e.clientY,nextX:e.clientX,nextY:e.clientY,left:el.scrollLeft,top:el.scrollTop,el,moved:false};
    el.setPointerCapture(e.pointerId);
  };
  const movePan=(e:PointerEvent<HTMLDivElement>)=>{
    const current=pan.current;if(!current||current.pointer!==e.pointerId)return;
    const dx=e.clientX-current.x,dy=e.clientY-current.y;
    if(!current.moved){if(Math.hypot(dx,dy)<=6)return;current.moved=true;setPanning(true);}
    e.preventDefault();
    current.nextX=e.clientX;current.nextY=e.clientY;panFrame.schedule();
  };
  const releasePan=(e:PointerEvent<HTMLDivElement>)=>{if(pan.current?.pointer===e.pointerId){if(e.type!=='pointercancel')panFrame.flush();endPan();}};
  useEffect(()=>{endPan();},[view,anchor,active]);
  useEffect(()=>()=>{const current=pan.current;pan.current=undefined;if(current?.el.hasPointerCapture(current.pointer))current.el.releasePointerCapture(current.pointer);},[]);
  const hoursRef=useRef<number[]>([]);hoursRef.current=hours;
  const initialScroll=useRef('');
  const end=(retainHours=false)=>{pointerFrame.cancel();const g=gesture.current;if(g){if(g.mode!=='decide')suppressGestureClick.current=true;window.clearTimeout(g.timer);if(g.el.hasPointerCapture(g.pointer))g.el.releasePointerCapture(g.pointer);}gesture.current=undefined;setDrag(undefined);if(!retainHours)setFrozen(undefined);};
  useEffect(()=>{
    const allowed=new Set(rows.filter(row=>!row.readOnly).map(calendarRowKey));
    const kept=pending.filter(p=>!p.row.windowId||allowed.has(calendarRowKey(p.row)));
    if(kept.length!==pending.length){setPending(kept);setBatchMessage('共享窗口或权限已变化，对应未确认改期已撤销。');if(!kept.length)setFrozen(undefined);}
    if(gesture.current?.row.windowId&&!allowed.has(calendarRowKey(gesture.current.row)))end(false);
  },[rows]);
  /** 指针贴着屏幕边缘时继续推进截止时间 */
  const applyScrub=(g:Gesture)=>{
    g.target={date:g.date,time:formatMinutes(g.minutes)};
    publishDrag(g);
  };
  /** 拖动时展开为完整 24 小时刻度，并补偿横向滚动让卡片停在手指下方 */
  const freezeFull=(row:ActionRow)=>{
    const time=planDueTime(row.task);
    if(time)anchorShift.current=minutesOf(time)/60*HOUR_WIDTH-timelineOffset(time,hoursRef.current);
    freeze(row,true);
  };
  const publishDrag=(g:Gesture)=>setDrag(old=>old?.row===g.row&&old.target?.date===g.target?.date&&old.target?.time===g.target?.time?old:{row:g.row,target:g.target});
  const cancel=()=>{if(saving.current)return;setPending([]);setBatchMessage('');end();};
  useEffect(()=>{setExpanded(undefined);setPending([]);setBatchMessage('');setMonthFocus('');setWeeks({before:0,after:0});edgeLock.current=performance.now()+700;end();},[view,anchor,active,navigationRevision]);
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
    const key=range.from+showAllHours+navigationRevision;
    if(initialScroll.current===key)return;
    initialScroll.current=key;
    const frame=requestAnimationFrame(()=>{if(scroll.current){scroll.current.scrollTop=0;scroll.current.scrollLeft=showAllHours?Math.max(0,(times.filter(Boolean).length?Math.min(...times.filter(Boolean).map(t=>Number(t.slice(0,2)))):9)-1)*HOUR_WIDTH:0;}});
    return()=>cancelAnimationFrame(frame);
  },[view,anchor,showAllHours,navigationRevision]);
  /** 滑动到两周列表两端时继续向前/向后追加一周，并保持当前内容位置不跳 */
  const extendWeeks=()=>{
    const box=scroll.current;if(!box||view!=='fortnight'||performance.now()<edgeLock.current||edgePending.current)return;
    if(box.scrollTop<=1&&weeks.before<52){edgePending.current={mode:'before',height:box.scrollHeight,top:box.scrollTop};setWeeks(old=>({...old,before:old.before+1}));}
    else if(box.scrollHeight-box.scrollTop-box.clientHeight<=1&&weeks.after<52){edgePending.current={mode:'after',height:box.scrollHeight,top:box.scrollTop};setWeeks(old=>({...old,after:old.after+1}));}
  };
  useLayoutEffect(()=>{const box=scroll.current,pending=edgePending.current;if(!pending||!box)return;edgePending.current=undefined;box.scrollTop=pending.mode==='before'?pending.top+box.scrollHeight-pending.height:pending.top;if(pan.current)pan.current.top=box.scrollTop;},[weeks]);
  useEffect(()=>{const key=(e:KeyboardEvent)=>{if(e.key==='Escape'){endPan();cancel();}};window.addEventListener('keydown',key);return()=>{window.removeEventListener('keydown',key);window.clearTimeout(gesture.current?.timer);};},[]);
  useEffect(()=>{
    if(!drag)return;
    const timer=window.setInterval(()=>{
      const g=gesture.current,box=g&&gestureScrollBox(g);
      if(!g||!box)return;
      const r=box.getBoundingClientRect();
      g.edgeTick++;
      if(g.mode==='scrub'){
        // Keep pushing the deadline while the pointer hugs the screen edge.
        if(g.x<r.left+28){box.scrollLeft-=24;if(g.edgeTick%2===0&&g.minutes>0){g.minutes=Math.max(0,g.minutes-15);applyScrub(g);}}
        else if(g.x>r.right-28){box.scrollLeft+=24;if(g.edgeTick%2===0&&g.minutes<1435){g.minutes=Math.min(1435,g.minutes+15);applyScrub(g);}}
        return;
      }
      if(g.mode!=='drag')return;
      if(g.y<r.top+50)box.scrollTop-=14;else if(g.y>r.bottom-50)box.scrollTop+=14;
      if(g.x<r.left+35)box.scrollLeft-=14;
      else if(g.x>r.right-35)box.scrollLeft+=14;
      updateTarget();
    },35);
    return()=>window.clearInterval(timer);
  },[!!drag]);
  const begin=(e:PointerEvent<HTMLElement>,row:ActionRow)=>{
    if((view==='month'||expanded)&&!(e.target as HTMLElement).closest('.calendar-chip-drag'))return;
    if(gesture.current)end(!!pending.length);
    if(blocked||saving.current||!active||row.readOnly)return;
    if(row.task.done||row.task.status==='done'||row.task.status==='cancelled'||row.task.deletedAt)return;
    if(e.pointerType==='mouse'&&e.button!==0)return;
    setBatchMessage('');
    const el=e.currentTarget.closest<HTMLElement>('.calendar-chip')!,rect=el.getBoundingClientRect(),minutes=minutesOf(planDueTime(row.task)||'12:00');
    const date=row.task.dueDate||row.task.plannedDate||'';
    const startTop=(markersFor(date).get(calendarRowKey(row))?.lane||0)*LANE_HEIGHT+4;
    const g:Gesture={row,x:e.clientX,y:e.clientY,startX:e.clientX,startY:e.clientY,lastX:e.clientX,lastY:e.clientY,offsetX:Math.min(e.clientX-rect.left,240),offsetY:e.clientY-rect.top,width:Math.max(160,Math.min(rect.width,280)),startTop,mode:'decide',pointer:e.pointerId,el,date,startMinutes:minutes,minutes,edgeTick:0};
    gesture.current=g;
    el.setPointerCapture(e.pointerId);
    if(e.pointerType!=='mouse')g.timer=window.setTimeout(()=>{if(gesture.current!==g||g.mode!=='decide')return;g.mode='drag';freezeFull(row);setDrag({row});},350);
  };
  const move=(e:PointerEvent<HTMLDivElement>)=>{
    const g=gesture.current;if(!g||e.pointerId!==g.pointer)return;
    if(g.mode==='decide'){
      const dx=e.clientX-g.startX,dy=e.clientY-g.startY;
      if(e.pointerType==='mouse'){
        if(Math.hypot(dx,dy)<=6)return;
        g.mode='drag';freezeFull(g.row);setDrag({row:g.row});
      }else if(Math.abs(dy)>10&&Math.abs(dy)>Math.abs(dx)){
        // Vertical intent: hand the gesture to manual container scrolling.
        g.mode='scroll';window.clearTimeout(g.timer);g.lastX=e.clientX;g.lastY=e.clientY;return;
      }else if(Math.abs(dx)>12&&Math.abs(dx)>Math.abs(dy)){
        window.clearTimeout(g.timer);
        if(view!=='month'&&planDueTime(g.row.task)){
          // 拖动期间切换完整时间线，时间连续可落点
          g.mode='scrub';freezeFull(g.row);
        }else{g.mode='scroll';g.lastX=e.clientX;g.lastY=e.clientY;return;}
      }else return;
    }
    if(g.mode==='scroll'){
      g.x=e.clientX;g.y=e.clientY;pointerFrame.schedule();return;
    }
    e.preventDefault();g.x=e.clientX;g.y=e.clientY;
    if(g.mode==='scrub')g.minutes=Math.max(0,Math.min(1435,g.startMinutes+Math.round((g.x-g.startX)/HOUR_WIDTH*60/15)*15));
    pointerFrame.schedule();
  };
  const updateTarget=()=>{
    const g=gesture.current;if(!g||g.mode!=='drag')return;
    if(ghost.current)ghost.current.style.transform=`translate3d(${g.x-g.offsetX}px,${g.y-g.offsetY}px,0)`;
    const el=document.elementFromPoint(g.x,g.y)?.closest<HTMLElement>('[data-calendar-date]');
    if(!el||!scroll.current?.contains(el)){g.target=undefined;publishDrag(g);return;}
    let time=planDueTime(g.row.task)||'';
    if(view!=='month'&&el.dataset.timed==='true'){const rect=el.getBoundingClientRect();time=timelineTime(g.x-rect.left,hoursRef.current);}
    else if(view!=='month')time='';
    g.target={date:el.dataset.calendarDate!,time};publishDrag(g);
  };
  const release=(e:PointerEvent<HTMLDivElement>)=>{
    const g=gesture.current;if(!g||e.pointerId!==g.pointer)return;
    if(g.mode==='decide'){const row=g.row;end(!!pending.length);if(view!=='month'){cancel();onEdit(rows.find(r=>calendarRowKey(r)===calendarRowKey(row))||row);}return;}
    // A released drag can otherwise click a checkbox now under the moved card.
    suppressGestureClick.current=true;
    pointerFrame.flush();
    if(g.mode==='drag'){g.x=e.clientX;g.y=e.clientY;updateTarget();}
    if(g.mode==='scroll'){end(!!pending.length);return;}
    const next=updateCalendarPreviews(pending,g.row,g.target);
    lastPreview.current=calendarRowKey(g.row);setPending(next);
    if(g.target&&view==='month')onMonthDate(g.target.date);
    if(g.target&&expanded){if(scroll.current)timelinePosition.current={left:scroll.current.scrollLeft,top:scroll.current.scrollTop};setExpanded(g.target.date);}
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
    const c=row.windowName?{name:`共享 · ${row.windowName}`} :categories.find(c=>c.id===row.task.category),t=planDueTime(row.task),isPending=pendingKeys.has(key);
    const previewing=!!drag&&calendarRowKey(drag.row)===key;
    const scrubbing=previewing&&gesture.current?.mode==='scrub';
    const shownTime=previewing&&drag!.target?drag!.target.time:t;
    const done=row.task.done||row.task.status==='done';
    const scheduled=row.task.dueDate||row.task.plannedDate;
    const description=`${row.task.title} · ${scheduled?`截止 ${scheduled} ${shownTime||'全天'}`:'未安排'} · ${c?.name||'待分类'} · ${urgency(row.task)?.label||'象限待分类'}`;
    return <div key={key} data-record-id={row.task.id} data-shared={!!row.windowId||undefined} data-preview-key={key} data-pending={isPending||undefined} data-dragging={previewing||undefined} data-scrubbing={scrubbing||undefined} data-urgency={urgency(row.task)?.id||'unclassified'} className={`calendar-chip state-${planState(row.task)}`} style={{...urgencyStyle(row.task),...(timed?{left:scrubbing&&drag!.target?.time?timelineOffset(drag!.target.time,hours):marker?.anchor??timelineOffset(t||'00:00',hours),top:scrubbing?gesture.current?.startTop??(marker?.lane||0)*LANE_HEIGHT+4:(marker?.lane||0)*LANE_HEIGHT+4,width:DEADLINE_WIDTH}: {})}} onPointerDown={e=>begin(e,row)} onPointerMove={move} onPointerUp={release} onPointerCancel={()=>end(!!pending.length)}>
      <label className="calendar-chip-check" data-done={done||undefined} onPointerDown={e=>e.stopPropagation()} onClick={e=>e.stopPropagation()}>
        <input type="checkbox" checked={done} disabled={blocked||row.readOnly||row.task.status==='cancelled'||!!row.task.deletedAt} aria-label={`完成：${row.task.title}`} onChange={()=>onToggle(row)}/>
      </label>
      <button type="button" className="calendar-chip-copy" aria-label={description} disabled={blocked} onClick={()=>{cancel();onEdit(rows.find(r=>calendarRowKey(r)===key)||row);}}>{row.windowId?<small className="calendar-shared-meta"><SharedPlanBadge name={row.windowName} compact={view!=='month'}/><span className="calendar-deadline-text">{scheduled?'截止 '+(shownTime||'全天'):'未安排'}</span><span className="calendar-meta-overflow">{view!=='month'?row.windowName:''}{row.task.seriesId||row.task.recurrenceAnchor?' · 重复':''}{isPending?' · 待确认':''}</span></small>:<small>{scheduled?'截止 '+(shownTime||'全天'):'未安排'} · {c?.name||'待分类'}{row.task.seriesId||row.task.recurrenceAnchor?' · 重复':''}{row.task.checkinEnabled!==false&&(row.task.checkinEnabled===true||row.task.checkins)?` · 打卡${row.task.checkins||0}次`:''}{isPending?' · 待确认':''}</small>}<strong>{row.task.title}</strong>{planState(row.task)!=='neutral'&&<span className={'calendar-state-badge badge-'+planState(row.task)}>{({done:'已完成',overdue:'已超期',soon:'即将到期',neutral:''})[planState(row.task)]}</span>}{row.task.status==='cancelled'&&<span className="calendar-state-badge">已取消</span>}</button>
      {(view==='month'||!!expanded)&&<button type="button" className="calendar-chip-drag" disabled={blocked||row.readOnly||done||row.task.status==='cancelled'||!!row.task.deletedAt} aria-label={`拖动改期：${row.task.title}`} title="拖动到日期改期；键盘可按 Enter 打开编辑" onClick={e=>{if(e.detail===0)onEdit(rows.find(r=>calendarRowKey(r)===key)||row);}}><GripVertical size={18}/></button>}
    </div>;
  };
  const dayRows=(date:string)=>rowsByDate.get(date)||[];
  const unarranged=displayRows.filter(row=>!row.task.dueDate&&!row.task.plannedDate);
  const renderMonth=()=> <div className="calendar-month-layout" data-month-split={viewportWidth>=900||undefined}>
    <section className="calendar-month-overview" data-month-scroll aria-label={`${anchor.slice(0,7)} 月历`}>
      <div role="grid" aria-label={`${anchor.slice(0,7)} 选择日期`}>
        <div className="calendar-weekdays" role="row">{['一','二','三','四','五','六','日'].map((d,index)=><div className="calendar-weekday" role="columnheader" data-weekend={index>4||undefined} key={d}>周{d}</div>)}</div>
        <div className="calendar-month" role="rowgroup">{Array.from({length:monthDays.length/7},(_,week)=><div className="calendar-month-week" role="row" key={week}>{monthDays.slice(week*7,week*7+7).map((date,index)=>{
          const summary=monthSummaries.get(date)!;
          const pendingCount=dayRows(date).filter(row=>pendingKeys.has(calendarRowKey(row))).length;
          const label=`查看 ${date} 的日程，周${['一','二','三','四','五','六','日'][index]}，${summary.count} 项${summary.shared?`，共享 ${summary.shared} 项`:''}${pendingCount?`，待确认 ${pendingCount} 项`:''}${summary.tones.map(t=>`，${t.label} ${t.count} 项`).join('')}`;
          return <div key={date} role="gridcell" aria-selected={agendaDate===date} data-calendar-date={date} data-pending={!!pendingCount||undefined} data-drop-active={drag?.target?.date===date||undefined} data-other-month={date.slice(0,7)!==anchor.slice(0,7)} data-weekend={index>4||undefined} data-today={date===planClock().date||undefined} data-selected={agendaDate===date||undefined} className="calendar-day">
            <button type="button" className="calendar-date" data-shared={!!summary.shared||undefined} disabled={submitting} tabIndex={(monthDays.includes(monthFocus)?monthFocus:agendaDate)===date?0:-1} aria-label={label} aria-controls="calendar-month-agenda" aria-current={date===planClock().date?'date':undefined} onFocus={()=>setMonthFocus(date)} onClick={()=>onMonthDate(date)} onKeyDown={e=>{
              const at=monthDays.indexOf(date),offset=({ArrowLeft:-1,ArrowRight:1,ArrowUp:-7,ArrowDown:7} as Record<string,number>)[e.key];
              const next=e.key==='Home'?at-index:e.key==='End'?at+6-index:offset===undefined?undefined:Math.max(0,Math.min(monthDays.length-1,at+offset));
              if(next!==undefined){e.preventDefault();scroll.current?.querySelector<HTMLButtonElement>(`.calendar-day[data-calendar-date="${monthDays[next]}"] .calendar-date`)?.focus();}
            }}><span className="month-date-top"><span className="calendar-day-number">{Number(date.slice(-2))}</span><small aria-hidden="true">{summary.count>99?'99+':summary.count||''}</small></span><span className="month-day-marks" aria-hidden="true">{summary.tones.map(t=><i key={t.id} style={{background:t.color}}/>)}{!!summary.shared&&<Users size={11}/>}</span></button>
          </div>;
        })}</div>)}</div>
      </div>
    </section>
    <div className="calendar-month-day-pane" data-month-scroll>
      <section id="calendar-month-agenda" className="calendar-day-agenda" aria-label={`${agendaDate} 的日程表`}>
        <header><h3>{agendaDate} · 周{['日','一','二','三','四','五','六'][new Date(agendaDate+'T00:00:00Z').getUTCDay()]}</h3><small role="status" aria-live="polite">{dayRows(agendaDate).length} 项日程</small></header>
        {agendaGroups.length?agendaGroups.map(group=><section className="month-agenda-group" key={group.time} aria-label={group.time?`截止 ${group.time}`:'全天截止'}><h4>{group.time||'全天'}{group.time&&<small>截止</small>}</h4><div>{group.rows.map(row=>chip(row))}</div></section>):<p className="calendar-day-agenda-empty">这天暂无日程，可通过底部＋新增。</p>}
      </section>
      {!!unarranged.length&&<details className="calendar-unarranged calendar-month-unarranged"><summary>未安排 · {unarranged.length}项</summary><div>{unarranged.map(row=>chip(row))}</div></details>}
    </div>
  </div>;
  const renderTimeline=()=> <div className="calendar-timeline-canvas" style={{'--timeline-hours-width':`${axisWidth}px`,'--timeline-all-width':allDay?'var(--timeline-all-column-width,164px)':'0px'} as CSSProperties}>
    <div className="calendar-timeline-heading">
      <div className="timeline-corner">截止日期</div>
      {allDay&&<div className="timeline-all-heading">全天</div>}
      <div className="timeline-hour-axis" aria-label="截止小时刻度">{hours.map(hour=><span key={hour} style={{left:hours.indexOf(hour)*HOUR_WIDTH}}>{String(hour).padStart(2,'0')}:00</span>)}{hiddenHourRanges(hours).map(gap=><button type="button" key={'gap'+gap.index} className="timeline-hour-gap" style={{left:gap.index*HOUR_WIDTH-44}} aria-label={`空白时段已隐藏：${gap.from} 至 ${gap.to}，打开时段设置`} title={`已隐藏 ${gap.from}—${gap.to}，点击设置显示时段`} aria-haspopup="dialog" onClick={onOpenHoursSettings}>⋯</button>)}{!hours.length&&<span className="timeline-no-hours">暂无定时日程</span>}</div>
    </div>
    {days.map((date,index)=><div className="calendar-timeline-row" data-date={date} data-week-start={view==='fortnight'&&index%7===0&&index>0||undefined} key={date} style={{height:rowHeight(date)}}>
      <button type="button" className="timeline-date" data-today={date===planClock().date||undefined} data-calendar-date={date} data-drop-active={drag?.target?.date===date&&!drag.target.time||undefined} title={`${date} · 可拖入全天日程`} onClick={()=>showDay(date)} aria-label={`查看 ${date} 的日程`} aria-expanded={expanded===date} aria-describedby={offscreen[date]?`timeline-offscreen-${date}`:undefined}><strong>{date.slice(5)}</strong><small>{date.slice(0,4)} · 周{['日','一','二','三','四','五','六'][new Date(date+'T00:00:00Z').getUTCDay()]}</small><small>{!!offscreen[date]?.left&&<span className="timeline-outside" aria-hidden="true">← </span>}{dayRows(date).length} 项{!!offscreen[date]?.right&&<span className="timeline-outside" aria-hidden="true"> →</span>}</small>{offscreen[date]&&<span className="sr-only" id={`timeline-offscreen-${date}`}>{offscreen[date].left?`左侧还有 ${offscreen[date].left} 项。`:''}{offscreen[date].right?`右侧还有 ${offscreen[date].right} 项。`:''}点击日期查看当天全部日程。</span>}</button>
      {allDay&&<div className="timeline-all-day" data-calendar-date={date} data-drop-active={drag?.target?.date===date&&!drag.target.time||undefined}>{dayRows(date).filter(row=>!planDueTime(row.task)).map(row=>chip(row))}</div>}
      <div className="timeline-timed-cell" data-calendar-date={date} data-timed="true" data-drop-active={drag?.target?.date===date&&!!drag.target.time||undefined} style={{backgroundSize:`${HOUR_WIDTH}px 100%`}}><div className="timeline-markers" style={{height:contentHeight(date)}}>{dayRows(date).filter(row=>!!planDueTime(row.task)).map(row=>chip(row,true))}</div></div>
    </div>)}
    {!!unarranged.length&&<div className="timeline-unarranged-wrap"><details className="calendar-unarranged" style={{width:viewportWidth||'100%'}}><summary>未安排 · {unarranged.length}项</summary><div>{unarranged.map(row=>chip(row))}</div></details></div>}
  </div>;
  return <div className="plan-calendar" data-dragging={!!drag||undefined}>
    {drag&&gesture.current?.mode==='drag'&&createPortal(<div ref={ghost} className="calendar-drag-ghost" aria-hidden="true" style={{...urgencyStyle(drag.row.task),width:gesture.current.width,transform:`translate3d(${gesture.current.x-gesture.current.offsetX}px,${gesture.current.y-gesture.current.offsetY}px,0)`}}><strong>{drag.row.task.title}</strong><div className="calendar-ghost-meta">{drag.row.windowId&&<SharedPlanBadge name={drag.row.windowName} compact/>}<small>截止 {drag.target?`${drag.target.date} ${drag.target.time||'全天'}`:'拖动到目标日期'}</small></div></div>,document.body)}
    {drag&&<p className="calendar-feedback" role="status">{gesture.current?.mode==='scrub'?'左右滑动调整':'拖动'}「{drag.row.task.title}」{drag.target?` → ${drag.target.date} ${drag.target.time||'全天'}`:'到目标日期'} · Escape 取消</p>}

    {batchMessage&&<p className="calendar-batch-message" role="status">{batchMessage}</p>}
    <div ref={scroll} className="calendar-scroll" data-view={view} data-panning={panning||undefined} onScroll={extendWeeks} onPointerDownCapture={()=>{suppressGestureClick.current=false;}} onClickCapture={e=>{if(suppressGestureClick.current&&e.detail>0){suppressGestureClick.current=false;e.preventDefault();e.stopPropagation();}}} onPointerDown={beginPan} onPointerMove={movePan} onPointerUp={releasePan} onPointerCancel={releasePan} onLostPointerCapture={releasePan}>
      {expanded&&view!=='month'&&<section className="calendar-focused-day calendar-day-agenda" hidden={!!drag} aria-label={`${expanded} 当天日程`}><header><h3 ref={dayHeading} tabIndex={-1}>{expanded} · 周{['日','一','二','三','四','五','六'][new Date(expanded+'T00:00:00Z').getUTCDay()]}</h3><small>{dayRows(expanded).length} 项日程</small><button type="button" onClick={closeDay}>返回{view==='fortnight'?'两周':'周视图'}</button></header>{monthAgendaGroups(dayRows(expanded)).map(group=><section className="month-agenda-group" key={group.time}><h4>{group.time||'全天'}{group.time&&<small>截止</small>}</h4><div>{group.rows.map(row=>chip(row))}</div></section>)}{!dayRows(expanded).length&&<p className="calendar-day-agenda-empty">这天暂无日程，可通过底部＋新增。</p>}</section>}
      {view==='month'?renderMonth():<div className="calendar-timeline-shell" hidden={!!expanded&&!drag}>{renderTimeline()}</div>}
    </div>
    <div className="calendar-action-slot" hidden={!pending.length&&!submitting}>
      <PlanActionDock className="calendar-drop-review" busy={blocked} onCancel={cancel} onConfirm={()=>void confirm()} label={pending.length>1?`确认改期（${pending.length}项）`:'确认改期'} status={submitting?`正在保存 ${progress.current}/${progress.total} 项改期`:pending.length===1?`待确认：截止 ${pending[0].target.date} ${pending[0].target.time||'全天'}，仅修改这一期`:`待确认：${pending.length} 项日程 · 仅修改截止时间`}/>
    </div>
  </div>;
}
