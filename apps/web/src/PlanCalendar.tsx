import {localMinute,type SearchResult} from '@diary/contracts';
import {groupCalendarDays,intervalHours,endpointMarkers,intervalPreviewMarker,rowSpan} from './calendarIntervals';
import './calendar-intervals.css';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { visibleWeekHours } from './calendarHours';
import { HOUR_WIDTH, DEADLINE_WIDTH, LANE_HEIGHT, timelineMarkers, timelineOffset, timelineTime, hiddenHourRanges, offscreenDirection, snapTimelineMinutes } from './calendarTimeline';
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
import { GripVertical, Users, Feather } from 'lucide-react';
import { monthAgendaGroups, monthDaySummary, monthGridDates, selectedMonthDate } from './calendarMonth';
import {useScrollMemory} from './workspaceState';
import {useSocial} from './Social';
import './schedule.css';
import './schedule-refinements.css';
import {SearchDiaryHits} from './GlobalSearch';

type Target=CalendarTarget;
type GestureMode='decide'|'drag'|'scrub'|'scroll';
type Gesture={row:ActionRow;edge:'start'|'end';timeOffset:number;x:number;y:number;startX:number;startY:number;lastX:number;lastY:number;offsetX:number;offsetY:number;width:number;startTop:number;mode:GestureMode;armed?:boolean;timer?:number;pointer:number;el:HTMLElement;target?:Target;date:string;startMinutes:number;minutes:number;edgeTick:number};
type CanvasPan={pointer:number;x:number;y:number;nextX:number;nextY:number;left:number;top:number;el:HTMLDivElement;moved:boolean};
const minutesOf=(time:string)=>{const[h,m]=time.split(':').map(Number);return(h||0)*60+(m||0);};
const formatMinutes=(minutes:number)=>`${String(Math.floor(minutes/60)).padStart(2,'0')}:${String(minutes%60).padStart(2,'0')}`;
/** 拖动/滑动调时间时使用完整 24 小时刻度，落点连续，不会跳过被压缩的小时 */
const ALL_HOURS=Array.from({length:24},(_,hour)=>hour);
export function PlanCalendar({view,anchor,rows,busy,onEdit,onMove,onToggle,active=true,showAllHours=false,onInteractionChange,onOpenHoursSettings,monthDate,onMonthDate,navigationRevision=0,inspectRequest,search,diarySearch}:{diarySearch?:{items:SearchResult[];onOpen:(item:SearchResult)=>void};search?:{query:string;matches:(row:ActionRow)=>boolean;navigation?:{id:number;locate:boolean};onCount:(count:number)=>void};inspectRequest?:{id:number;row:ActionRow};navigationRevision?:number;monthDate?:string;onMonthDate:(date:string)=>void;onOpenHoursSettings:()=>void;view:CalendarView;anchor:string;showAllHours?:boolean;onInteractionChange?:(state:{dragging:boolean;pending:boolean;saving:boolean})=>void;rows:ActionRow[];busy:boolean;onEdit:(row:ActionRow)=>void;onMove:(row:ActionRow,target:Target)=>Promise<boolean>;onToggle:(row:ActionRow)=>void;active?:boolean}) {
  const range=useMemo(()=>calendarRange(anchor,view),[anchor,view]);
  /** 两周视图可在两端继续扩展，滑动即可看到更早/更晚的周 */
  const [weeks,setWeeks]=useState({before:0,after:0});
  const days=useMemo(()=>Array.from({length:view==='fortnight'?14+weeks.before*7+weeks.after*7:view==='month'?42:7},(_,i)=>shiftDate(range.from,view==='fortnight'?i-weeks.before*7:i)),[range,view,weeks]);
  const monthDays=useMemo(()=>monthGridDates(anchor),[anchor.slice(0,7)]);
  const {categories}=usePlanCategories();const scroll=useRef<HTMLDivElement>(null);
  const edgeLock=useRef(0),edgePending=useRef<{mode:'before'|'after';height:number;top:number}|undefined>(undefined);
  const ghost=useRef<HTMLDivElement>(null);
  const gesture=useRef<Gesture|undefined>(undefined);
  const [selectedKey,setSelectedKey]=useState<string>(),[selectionRevision,setSelectionRevision]=useState(0);
  const [hovered,setHovered]=useState<{key:string;edge:'start'|'end'}>(),[focused,setFocused]=useState<{key:string;edge:'start'|'end'}>();
  const hoverLeave=useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
  const clearHover=()=>{clearTimeout(hoverLeave.current);hoverLeave.current=undefined;setHovered(undefined);};
  /** 拖动选中的时间条后，所选时间段保持展开，直到用户点「收起」 */
  const pinned=useRef(false);
  const clearOperation=()=>{clearHover();setFocused(undefined);if(!pinned.current)setSelectedKey(undefined);};
  const editRow=(row:ActionRow)=>{clearOperation();onEdit(row);};
  const rangeTarget=(target:EventTarget|null)=>target instanceof Element?target.closest<HTMLElement>('[data-range-key]'):null;
  const enterRange=(event:PointerEvent<HTMLElement>)=>{if(event.pointerType!=='mouse'||event.buttons||gesture.current||!active||view==='month'||expanded)return;const target=rangeTarget(event.target);if(!target)return;clearTimeout(hoverLeave.current);const next={key:target.dataset.rangeKey!,edge:target.dataset.rangeEdge==='end'?'end' as const:'start' as const};setHovered(old=>old?.key===next.key&&old.edge===next.edge?old:next);};
  const leaveRange=(event:PointerEvent<HTMLElement>)=>{if(event.pointerType!=='mouse'||gesture.current)return;const from=rangeTarget(event.target),to=rangeTarget(event.relatedTarget);if(!from||from.dataset.rangeKey===to?.dataset.rangeKey)return;clearTimeout(hoverLeave.current);hoverLeave.current=setTimeout(()=>{setHovered(undefined);if(!gesture.current&&!pending.length&&!focused&&!pinned.current)setSelectedKey(old=>old===from.dataset.rangeKey?undefined:old);},140);};
  useEffect(()=>()=>clearTimeout(hoverLeave.current),[]);
  const selectedFocus=useRef<{key:string;date:string;time:string}|undefined>(undefined);
  const [expanded,setExpanded]=useState<string>(),[drag,setDrag]=useState<{row:ActionRow;target?:Target}>(),[pending,setPending]=useState<CalendarPreview[]>([]);
  const {data:socialData}=useSocial();
  useScrollMemory(socialData.profile.code,`plan.calendar.${view}.${range.from}`,scroll,active&&rows.length>0&&!expanded);
  const timelinePosition=useRef({left:0,top:0}),dayHeading=useRef<HTMLHeadingElement>(null),dayMode=useRef(false);
  const showDay=(date:string)=>{clearOperation();if(scroll.current)timelinePosition.current={left:scroll.current.scrollLeft,top:scroll.current.scrollTop};setExpanded(date);};
  const closeDay=()=>{const date=expanded;setExpanded(undefined);requestAnimationFrame(()=>scroll.current?.querySelector<HTMLButtonElement>(`.timeline-date[data-calendar-date="${date}"]`)?.focus({preventScroll:true}));};
  useLayoutEffect(()=>{if(!expanded&&!dayMode.current)return;dayMode.current=!!expanded;const box=scroll.current;if(!box)return;if(expanded&&!drag){box.scrollLeft=0;box.scrollTop=0;dayHeading.current?.focus({preventScroll:true});}else{box.scrollLeft=timelinePosition.current.left;box.scrollTop=timelinePosition.current.top;}},[expanded,!!drag]);
  const agendaDate=selectedMonthDate(anchor,planClock().date,monthDate);
  const [monthFocus,setMonthFocus]=useState('');
  const [submitting,setSubmitting]=useState(false),[progress,setProgress]=useState({current:0,total:0}),[batchMessage,setBatchMessage]=useState('');
  const [frozen,setFrozen]=useState<{hours:number[];heights:Record<string,number>;allDay:boolean}>();
  const [viewportWidth,setViewportWidth]=useState(0);
  const [viewport,setViewport]=useState({left:0,top:0,height:900,dateWidth:104});
  const measuredViewport=useRef({width:-1,dateWidth:104});
  const viewportFrame=useFrameTask(()=>{const box=scroll.current;if(!box||!active)return;if(box.clientWidth!==measuredViewport.current.width)measuredViewport.current={width:box.clientWidth,dateWidth:parseFloat(getComputedStyle(box).getPropertyValue('--timeline-date-width'))||104};
    // Overscan exceeds this bucket: panning can use native scrolling without repainting every card for each pixel.
    const next={left:Math.floor(box.scrollLeft/96)*96,top:Math.floor(box.scrollTop/96)*96,height:box.clientHeight,dateWidth:measuredViewport.current.dateWidth};setViewport(old=>old.left===next.left&&old.top===next.top&&old.height===next.height&&old.dateWidth===next.dateWidth?old:next);refreshOffscreen();});
  const [offscreen,setOffscreen]=useState<Record<string,{left:number;right:number}>>({});
  const saving=useRef(false);
  const moveCallback=useRef(onMove);moveCallback.current=onMove;
  const lastPreview=useRef<string|undefined>(undefined);
  const blocked=busy||submitting;
  useEffect(()=>{onInteractionChange?.({dragging:!!drag,pending:!!pending.length,saving:submitting});},[!!drag,!!pending.length,submitting,onInteractionChange]);
  useEffect(()=>()=>onInteractionChange?.({dragging:false,pending:false,saving:false}),[onInteractionChange]);
  const pendingKeys=useMemo(()=>new Set(pending.map(preview=>calendarRowKey(preview.row))),[pending]);
  const allDisplayRows=useMemo(()=>previewCalendarRows(rows,pending),[rows,pending]);
  const displayRows=useMemo(()=>search?.query?allDisplayRows.filter(search.matches):allDisplayRows,[allDisplayRows,search?.query,search?.matches]);
  const selected=displayRows.find(row=>calendarRowKey(row)===selectedKey);
  const operationKey=drag?calendarRowKey(drag.row):hovered?.key||focused?.key||(pending.length?lastPreview.current:undefined);
  const operationEdge=gesture.current?.edge||hovered?.edge||focused?.edge||'start';
  const operationRow=useMemo(()=>{const row=displayRows.find(r=>calendarRowKey(r)===operationKey);if(!row||!drag?.target)return row;return previewCalendarRows([row],updateCalendarPreviews([],row,drag.target))[0];},[displayRows,operationKey,drag]);

  const diaryByDate=useMemo(()=>{const map=new Map<string,SearchResult[]>();for(const item of diarySearch?.items||[])map.set(item.date,[...(map.get(item.date)||[]),item]);return map;},[diarySearch?.items]);
  const diaryRows=(date:string)=>diaryByDate.get(date)||[];
  const diaryCards=(date:string)=><SearchDiaryHits items={diaryRows(date)} onOpen={item=>diarySearch?.onOpen(item)}/>;
  const rowsByDate=useMemo(()=>groupCalendarDays(displayRows,days),[displayRows,days]);
  const monthSummaries=useMemo(()=>new Map(monthDays.map(date=>[date,monthDaySummary(rowsByDate.get(date)||[])])),[monthDays,rowsByDate]);
  const agendaGroups=useMemo(()=>monthAgendaGroups(rowsByDate.get(agendaDate)||[],agendaDate),[rowsByDate,agendaDate]);
  const rangeRows=useMemo(()=>displayRows.filter(row=>days.some(date=>rowsByDate.get(date)?.includes(row))),[displayRows,days,rowsByDate]);
  useEffect(()=>{if(search?.query)search.onCount((view==='month'?rangeRows.filter(row=>monthDays.some(date=>(rowsByDate.get(date)||[]).includes(row))):rangeRows).length+displayRows.filter(row=>!row.task.dueDate&&!row.task.plannedDate).length+(diarySearch?.items||[]).filter(item=>(view==='month'?monthDays:days).includes(item.date)).length);},[rangeRows,displayRows,view,monthDays,rowsByDate,search?.query,search?.onCount,diarySearch?.items]);
  const searchDayOrigin=useRef<{scope:string;expanded?:string;monthDate:string}|undefined>(undefined);
  useEffect(()=>{pinned.current=false;clearOperation();const scope=view+':'+anchor;if(search?.query){if(searchDayOrigin.current?.scope!==scope)searchDayOrigin.current={scope,expanded,monthDate:agendaDate};}else if(searchDayOrigin.current){if(searchDayOrigin.current.scope===scope){setExpanded(searchDayOrigin.current.expanded);if(view==='month')onMonthDate(searchDayOrigin.current.monthDate);}searchDayOrigin.current=undefined;}},[search?.query,view,anchor]);

  const times=useMemo(()=>intervalHours(rangeRows,selectedKey),[rangeRows,selectedKey]);
  const hours=useMemo(()=>frozen?.hours||visibleWeekHours(times,showAllHours),[frozen,times,showAllHours]);
  const markersByDate=useMemo(()=>new Map(days.map(date=>[date,endpointMarkers((rowsByDate.get(date)||[]).filter(row=>rowSpan(row)||planDueTime(row.task)),date,hours,selectedKey)])),[days,rowsByDate,hours,selectedKey]);
  const markersFor=(date:string)=>markersByDate.get(date)||new Map<string,{anchor:number;lane:number}>();
  useLayoutEffect(()=>{if(drag||!pending.length)return;setFrozen(old=>{if(!old)return old;const heights={...old.heights};let changed=false;for(const date of days){const needed=contentHeight(date);if(needed>(heights[date]||0)){heights[date]=needed;changed=true;}}return changed?{...old,heights}:old;});},[pending,!!drag,selectedKey]);
  const allDay=!!frozen?.allDay||days.some(date=>diaryRows(date).length>0)||rangeRows.some(row=>!rowSpan(row)&&!planDueTime(row.task));
  const contentHeight=(date:string)=>Math.max(84,...[...markersFor(date).values()].map(marker=>(marker.lane+1)*LANE_HEIGHT+8),(rowsByDate.get(date)||[]).filter(row=>!rowSpan(row)&&!planDueTime(row.task)).length*LANE_HEIGHT+diaryRows(date).length*LANE_HEIGHT+8);
  const rowHeight=(date:string)=>frozen?.heights[date]||contentHeight(date);
  const rowLayouts=useMemo(()=>{let top=44;return new Map(days.map(date=>{const height=rowHeight(date)+1,result={top,height};top+=height;return[date,result];}));},[days,markersByDate,frozen,diaryByDate]);
  useLayoutEffect(()=>{const focus=selectedFocus.current,box=scroll.current;if(!focus||focus.key!==selectedKey||!box)return;selectedFocus.current=undefined;const date=focus.date<days[0]?days[0]:focus.date>days.at(-1)!?days.at(-1)!:focus.date;box.scrollLeft=Math.max(0,(allDay?164:0)+timelineOffset(focus.time,hours)-16);box.scrollTop=Math.max(0,(rowLayouts.get(date)?.top||44)-44);viewportFrame.schedule();},[selectedKey,hours,rowLayouts,selectionRevision]);
  useLayoutEffect(()=>{
    if(!search?.query||!search.navigation?.locate||drag||pending.length)return;const box=scroll.current;if(!box)return;
    const dates=view==='month'?monthDays:days,choices=rangeRows.flatMap(row=>{const span=rowSpan(row),start=span?.start.slice(0,10),end=row.task.dueDate||row.task.plannedDate,points=[...(start&&dates.includes(start)?[{date:start,time:span!.start.slice(11)}]:[]),...(end&&dates.includes(end)?[{date:end,time:planDueTime(row.task)||'00:00'}]:[])];return points.map(point=>({...point,row}));}).sort((a,b)=>Math.abs(Date.parse(a.date)-Date.parse(planClock().date))-Math.abs(Date.parse(b.date)-Date.parse(planClock().date))||a.time.localeCompare(b.time));
    const locateUnarranged=()=>{const details=box.querySelector<HTMLDetailsElement>('.calendar-unarranged');if(details){details.open=true;details.scrollIntoView({block:'nearest'});}};
    const diaryDate=dates.find(date=>diaryRows(date).length);const choice=choices[0];if(view==='month'){const date=choice?.date||dates.find(date=>(rowsByDate.get(date)||[]).length)||diaryDate;if(date){onMonthDate(date);requestAnimationFrame(()=>box.querySelector('.calendar-day-agenda')?.scrollIntoView({block:'nearest'}));}else locateUnarranged();return;}
    if(choice){setExpanded(undefined);requestAnimationFrame(()=>{box.scrollLeft=!rowSpan(choice.row)&&!planDueTime(choice.row.task)?0:Math.max(0,(allDay?164:0)+timelineOffset(choice.time,hours)-12);box.scrollTop=Math.max(0,(rowLayouts.get(choice.date)?.top||44)-44);viewportFrame.schedule();});}
    else{const date=dates.find(date=>(rowsByDate.get(date)||[]).length)||diaryDate;if(date){setExpanded(undefined);requestAnimationFrame(()=>{box.scrollLeft=0;box.scrollTop=Math.max(0,(rowLayouts.get(date)?.top||44)-44);viewportFrame.schedule();});}else locateUnarranged();}
  },[search?.navigation?.id]);
  const axisWidth=Math.max(hours.length*HOUR_WIDTH,...[...markersByDate.values()].flatMap(markers=>[...markers.values()].map(marker=>marker.anchor+Math.max(DEADLINE_WIDTH,marker.width)+24)));
  const freeze=(row:ActionRow,allHours=false)=>setFrozen(old=>old||{hours:allHours?ALL_HOURS:hours.length?hours:planDueTime(row.task)?[Number(planDueTime(row.task)!.slice(0,2))]:[],heights:Object.fromEntries(days.map(date=>[date,contentHeight(date)])),allDay:allDay||!rowSpan(row)&&!planDueTime(row.task)});
  /** 拖动时切换为完整时间线，横向滚动补偿让卡片仍停在手指下方 */
  const anchorShift=useRef<number|null>(null);
  useEffect(()=>{if(anchorShift.current===null)return;const box=scroll.current;if(box)box.scrollLeft+=anchorShift.current;anchorShift.current=null;},[frozen]);
  useEffect(()=>{const box=scroll.current;if(!box)return;const observer=new ResizeObserver(()=>setViewportWidth(box.clientWidth));observer.observe(box);return()=>observer.disconnect();},[]);
  const refreshOffscreen=()=>{const box=scroll.current;if(!box||!active||view==='month')return;const next:Record<string,{left:number;right:number}>={},left=box.scrollLeft,right=left+box.clientWidth-measuredViewport.current.dateWidth-(allDay?164:0);
   for(const date of days){const leftKeys=new Set<string>(),rightKeys=new Set<string>();for(const marker of markersByDate.get(date)?.values()||[]){const direction=offscreenDirection(marker.anchor,marker.anchor+Math.max(DEADLINE_WIDTH,marker.width),left,right);if(direction)(direction==='left'?leftKeys:rightKeys).add(calendarRowKey(marker.row));}const counts={left:leftKeys.size,right:rightKeys.size};if(counts.left||counts.right)next[date]=counts;}
   setOffscreen(old=>JSON.stringify(old)===JSON.stringify(next)?old:next);
  };
  useEffect(()=>{refreshOffscreen();},[active,view,viewportWidth,markersByDate,allDay]);
  useEffect(()=>{viewportFrame.schedule();},[active,viewportWidth,view]);
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
    if(!current.moved){if(Math.hypot(dx,dy)<=6)return;current.moved=true;clearHover();setFocused(undefined);setPanning(true);}
    e.preventDefault();
    current.nextX=e.clientX;current.nextY=e.clientY;panFrame.schedule();
  };
  const releasePan=(e:PointerEvent<HTMLDivElement>)=>{if(pan.current?.pointer===e.pointerId){if(!pan.current.moved&&e.type!=='pointercancel'&&!pinned.current){setSelectedKey(undefined);}if(e.type!=='pointercancel')panFrame.flush();endPan();}};
  useEffect(()=>{endPan();},[view,anchor,active]);
  useEffect(()=>()=>{const current=pan.current;pan.current=undefined;if(current?.el.hasPointerCapture(current.pointer))current.el.releasePointerCapture(current.pointer);},[]);
  const hoursRef=useRef<number[]>([]);hoursRef.current=hours;
  const initialScroll=useRef('');
  const end=(retainHours=false)=>{pointerFrame.cancel();const g=gesture.current;if(g){if(g.mode!=='decide')suppressGestureClick.current=true;window.clearTimeout(g.timer);if(g.el.hasPointerCapture(g.pointer))g.el.releasePointerCapture(g.pointer);}gesture.current=undefined;setDrag(undefined);if(!retainHours)setFrozen(undefined);};
  useEffect(()=>{
    if(selectedKey&&!rows.some(row=>calendarRowKey(row)===selectedKey))setSelectedKey(undefined);
    if(hovered&&!rows.some(row=>calendarRowKey(row)===hovered.key))clearHover();if(focused&&!rows.some(row=>calendarRowKey(row)===focused.key))setFocused(undefined);
    const allowed=new Set(rows.filter(row=>!row.readOnly).map(calendarRowKey));
    const kept=pending.filter(p=>!p.row.windowId||allowed.has(calendarRowKey(p.row)));
    if(kept.length!==pending.length){setPending(kept);setBatchMessage('共享窗口或权限已变化，对应未确认改期已撤销。');if(!kept.length)setFrozen(undefined);}
    if(gesture.current?.row.windowId&&!allowed.has(calendarRowKey(gesture.current.row)))end(false);
  },[rows]);
  /** 指针贴着屏幕边缘时继续推进截止时间 */
  const applyScrub=(g:Gesture)=>{
    g.target={date:g.date,time:formatMinutes(g.minutes),edge:g.edge};
    publishDrag(g);
  };
  /** 拖动时展开为完整 24 小时刻度，并补偿横向滚动让卡片停在手指下方 */
  const freezeFull=(row:ActionRow,edge:'start'|'end'='end')=>{
    const time=edge==='start'?rowSpan(row)?.start.slice(11):planDueTime(row.task)||rowSpan(row)?.end.slice(11);
    if(time)anchorShift.current=minutesOf(time)/60*HOUR_WIDTH-timelineOffset(time,hoursRef.current);
    freeze(row,true);
  };
  const publishDrag=(g:Gesture)=>setDrag(old=>old?.row===g.row&&old.target?.date===g.target?.date&&old.target?.time===g.target?.time?old:{row:g.row,target:g.target});
  const cancel=()=>{if(saving.current)return;pinned.current=false;clearOperation();setPending([]);setBatchMessage('');end();};
  useEffect(()=>{pinned.current=false;clearOperation();setExpanded(undefined);setPending([]);setBatchMessage('');setMonthFocus('');setWeeks({before:0,after:0});edgeLock.current=performance.now()+700;end();},[view,anchor,navigationRevision]);
  useEffect(()=>{if(!active){pinned.current=false;clearOperation();setPending([]);setBatchMessage('');end();}},[active]);
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
    // 等日程数据到位再定位，避免空列表时把初始位置记成“已处理”
    if(search?.query||!active||!rows.length)return;
    const key=range.from+showAllHours+navigationRevision;
    if(initialScroll.current===key)return;
    initialScroll.current=key;
    const frame=requestAnimationFrame(()=>{
      const box=scroll.current;if(!box)return;
      box.scrollLeft=showAllHours?Math.max(0,(times.filter(Boolean).length?Math.min(...times.filter(Boolean).map(t=>Number(t.slice(0,2)))):9)-1)*HOUR_WIDTH:0;
      // 双周/周视图打开时把今天居中显示
      const row=view==='fortnight'||view==='week'?box.querySelector<HTMLElement>(`.calendar-timeline-row[data-date="${planClock().date}"]`):null;
      if(!row){const layout=rowLayouts.get(planClock().date);box.scrollTop=layout?Math.max(0,layout.top-(box.clientHeight-layout.height)/2):0;viewportFrame.schedule();return;}
      const rowBox=row.getBoundingClientRect(),viewport=box.getBoundingClientRect();
      box.scrollTop+=(rowBox.top-viewport.top)-(box.clientHeight-rowBox.height)/2;
    });
    return()=>cancelAnimationFrame(frame);
  },[view,anchor,showAllHours,navigationRevision,rows.length,active]);
  /** 滑动到两周列表两端时继续向前/向后追加一周，并保持当前内容位置不跳 */
  const extendWeeks=()=>{
    const box=scroll.current;if(!box||!active||expanded||view!=='fortnight'||performance.now()<edgeLock.current||edgePending.current)return;
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
        if(g.x<r.left+28){box.scrollLeft-=24;if(g.edgeTick%2===0&&g.minutes>0){g.minutes=snapTimelineMinutes(g.minutes-15);applyScrub(g);}}
        else if(g.x>r.right-28){box.scrollLeft+=24;if(g.edgeTick%2===0&&g.minutes<1425){g.minutes=snapTimelineMinutes(g.minutes+15);applyScrub(g);}}
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
  /** immediate：端点抓手按下即进入拖动，避免和点击编辑抢手势 */
  const begin=(e:PointerEvent<HTMLElement>,row:ActionRow,edge:'start'|'end'='end',immediate=false)=>{
    if((view==='month'||expanded)&&!(e.target as HTMLElement).closest('.calendar-chip-drag'))return;
    if(gesture.current)end(!!pending.length);
    if(blocked||saving.current||!active||row.readOnly)return;
    if(row.task.done||row.task.status==='done'||row.task.status==='cancelled'||row.task.deletedAt)return;
    if(e.pointerType==='mouse'&&e.button!==0)return;
    clearHover();setFocused(undefined);setBatchMessage('');
    const el=e.currentTarget.closest<HTMLElement>('.calendar-chip')!,rect=el.getBoundingClientRect(),minutes=minutesOf((edge==='start'?rowSpan(row)?.start.slice(11):planDueTime(row.task)||rowSpan(row)?.end.slice(11))||'12:00');
    const date=(edge==='start'?rowSpan(row)?.start.slice(0,10):row.task.dueDate||row.task.plannedDate)||'';
    const startTop=(markersFor(date).get(calendarRowKey(row)+':'+(selectedKey===calendarRowKey(row)?'span':edge))?.lane||0)*LANE_HEIGHT+4;
    const g:Gesture={row,edge,timeOffset:(e.target as HTMLElement).closest('.lifecycle-start')?e.clientX-rect.left:0,x:e.clientX,y:e.clientY,startX:e.clientX,startY:e.clientY,lastX:e.clientX,lastY:e.clientY,offsetX:Math.min(e.clientX-rect.left,240),offsetY:e.clientY-rect.top,width:Math.max(160,Math.min(rect.width,280)),startTop,mode:immediate?'drag':'decide',armed:immediate?false:undefined,pointer:e.pointerId,el,date,startMinutes:minutes,minutes,edgeTick:0};
    gesture.current=g;
    el.setPointerCapture(e.pointerId);
    if(immediate)return;
    if(e.pointerType!=='mouse')g.timer=window.setTimeout(()=>{if(gesture.current!==g||g.mode!=='decide')return;g.mode='drag';g.armed=true;if(selectedKey===calendarRowKey(g.row))pinned.current=true;freezeFull(row,edge);setDrag({row});},350);
  };
  const move=(e:PointerEvent<HTMLDivElement>)=>{
    const g=gesture.current;if(!g||e.pointerId!==g.pointer)return;
    if(g.mode==='decide'){
      const dx=e.clientX-g.startX,dy=e.clientY-g.startY;
      if(e.pointerType==='mouse'){
        if(Math.hypot(dx,dy)<=6)return;
        if(selectedKey===calendarRowKey(g.row))pinned.current=true;
        g.mode='drag';g.armed=true;freezeFull(g.row,g.edge);setDrag({row:g.row});
      }else if(Math.abs(dy)>10&&Math.abs(dy)>Math.abs(dx)){
        // Vertical intent: hand the gesture to manual container scrolling.
        g.mode='scroll';window.clearTimeout(g.timer);g.lastX=e.clientX;g.lastY=e.clientY;return;
      }else if(Math.abs(dx)>12&&Math.abs(dx)>Math.abs(dy)){
        window.clearTimeout(g.timer);
        if(view!=='month'&&(planDueTime(g.row.task)||rowSpan(g.row))){
          // 拖动期间切换完整时间线，时间连续可落点
          if(selectedKey===calendarRowKey(g.row))pinned.current=true;
          g.mode='scrub';g.armed=true;freezeFull(g.row,g.edge);
        }else{g.mode='scroll';g.lastX=e.clientX;g.lastY=e.clientY;return;}
      }else return;
    }
    // 端点抓手：先等一小段位移再出现拖动预览，轻点不会闪出幽灵卡片
    if(g.mode==='drag'&&g.armed===false){
      if(Math.hypot(e.clientX-g.startX,e.clientY-g.startY)<=4)return;
      g.armed=true;
      if(selectedKey===calendarRowKey(g.row))pinned.current=true;
      freezeFull(g.row,g.edge);setDrag({row:g.row});
    }
    if(g.mode==='scroll'){
      g.x=e.clientX;g.y=e.clientY;pointerFrame.schedule();return;
    }
    e.preventDefault();g.x=e.clientX;g.y=e.clientY;
    if(g.mode==='scrub')g.minutes=snapTimelineMinutes(g.startMinutes+(g.x-g.startX)/HOUR_WIDTH*60);
    pointerFrame.schedule();
  };
  const updateTarget=()=>{
    const g=gesture.current;if(!g||g.mode!=='drag')return;
    if(ghost.current)ghost.current.style.transform=`translate3d(${g.x-g.offsetX}px,${g.y-g.offsetY}px,0)`;
    const el=document.elementFromPoint(g.x,g.y)?.closest<HTMLElement>('[data-calendar-date]');
    if(!el||!scroll.current?.contains(el)){g.target=undefined;publishDrag(g);return;}
    let time=(g.edge==='start'?rowSpan(g.row)?.start.slice(11):planDueTime(g.row.task))||'';
    if(view!=='month'&&el.dataset.timed==='true'){const rect=el.getBoundingClientRect();time=timelineTime(g.x-rect.left-g.timeOffset,hoursRef.current);}
    else if(view!=='month')time='';
    g.target={date:el.dataset.calendarDate!,time,edge:g.edge};publishDrag(g);
  };
  const release=(e:PointerEvent<HTMLDivElement>)=>{
    const g=gesture.current;if(!g||e.pointerId!==g.pointer)return;
    if(g.mode==='decide'||(g.mode==='drag'&&g.armed===false)){end(!!pending.length);return;}
    // A released drag can otherwise click a checkbox now under the moved card.
    suppressGestureClick.current=true;
    pointerFrame.flush();
    if(g.mode==='drag'){g.x=e.clientX;g.y=e.clientY;updateTarget();}
    if(g.mode==='scroll'){end(!!pending.length);return;}
    if(!g.target){end(!!pending.length);return;}
    const start=g.edge==='start'?g.target.date+'T'+(g.target.time||'00:00'):rowSpan(g.row)?.start;
    const finish=g.edge==='end'?g.target.date+'T'+(g.target.time||'23:59'):rowSpan(g.row)?.end;
    if(start&&finish&&start>=finish){setBatchMessage('开始必须早于截止；本次拖动未应用。');end(!!pending.length);return;}
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
    }finally{saving.current=false;setSubmitting(false);clearOperation();if(saved===batch.length||saved===batch.length-1)setFrozen(undefined);}
  };
  const selectTask=(row:ActionRow,edge:'start'|'end'='start')=>{if(expanded)closeDay();pinned.current=true;clearHover();setFocused(undefined);const key=calendarRowKey(row);const span=rowSpan(row),point=span?(edge==='start'?span.start:span.end):`${row.task.dueDate||row.task.plannedDate}T${planDueTime(row.task)||'00:00'}`;if(point)selectedFocus.current={key,date:point.slice(0,10),time:point.slice(11)};setSelectedKey(key);setSelectionRevision(value=>value+1);};
  useEffect(()=>{if(inspectRequest&&active)selectTask(inspectRequest.row);},[inspectRequest]);
  const chip=(row:ActionRow,timed=false,edge:'start'|'end'='end')=>{
    const key=calendarRowKey(row);
    const span=rowSpan(row),pointDate=(edge==='start'?span?.start.slice(0,10):row.task.dueDate||row.task.plannedDate)||'';
    const marker=timed?markersFor(pointDate).get(key+':'+edge):undefined;
    const c=row.windowName?{name:`共享 · ${row.windowName}`} :categories.find(c=>c.id===row.task.category),t=edge==='start'?(span?.startKind==='planned'&&!row.task.startTime?'':span?.start.slice(11)):planDueTime(row.task),isPending=pendingKeys.has(key);
    const previewing=!!drag&&calendarRowKey(drag.row)===key;
    const scrubbing=previewing&&gesture.current?.mode==='scrub';
    const shownTime=previewing&&drag!.target&&gesture.current?.edge===edge?drag!.target.time:t;
    const done=row.task.done||row.task.status==='done';
    const scheduled=pointDate;const pointLabel=edge==='start'?(span?.startKind==='planned'?'开始':span?.startKind==='created'?'创建':'期次起点'):'截止';
    const description=`${row.task.title} · ${scheduled?`${pointLabel} ${scheduled} ${shownTime||'全天'}`:'未安排'} · ${c?.name||'待分类'} · ${urgency(row.task)?.label||'象限待分类'}${span?' · 持续任务 '+span.start.replace('T',' ')+' → '+span.end.replace('T',' '):''}`;
    return <div key={key+edge} data-endpoint={timed?edge:undefined} data-range-key={timed&&span?key:undefined} data-range-edge={timed?edge:undefined} data-range-open={operationKey===key||selectedKey===key||undefined} data-record-id={row.task.id} data-shared={!!row.windowId||undefined} data-preview-key={key} data-pending={isPending||undefined} data-dragging={previewing||undefined} data-scrubbing={scrubbing||undefined} data-urgency={urgency(row.task)?.id||'unclassified'} className={`calendar-chip ${timed?'calendar-endpoint':''} state-${planState(row.task)}`} style={{...urgencyStyle(row.task),...(timed?{left:scrubbing&&drag!.target?.time?timelineOffset(drag!.target.time,hours):marker?.anchor??timelineOffset(t||'00:00',hours),top:scrubbing?gesture.current?.startTop??(marker?.lane||0)*LANE_HEIGHT+4:(marker?.lane||0)*LANE_HEIGHT+4,width:DEADLINE_WIDTH}: {})}} onClick={view!=='month'?()=>editRow(rows.find(r=>calendarRowKey(r)===key)||row):undefined} onPointerDown={e=>begin(e,row,edge)} onPointerMove={move} onPointerUp={release} onPointerCancel={()=>end(!!pending.length)}>
      {edge==='end'&&<label className="calendar-chip-check" data-done={done||undefined} onPointerDown={e=>e.stopPropagation()} onClick={e=>e.stopPropagation()}>
        <input type="checkbox" checked={done} disabled={blocked||row.readOnly||row.task.status==='cancelled'||!!row.task.deletedAt} aria-label={`完成：${row.task.title}`} onChange={()=>onToggle(row)}/>
      </label>}
      {timed&&<button type="button" className="endpoint-grip" aria-label={`拖动调整${edge==='start'?'开始':'截止'}时间：${row.task.title}`} title={edge==='start'?'拖动调整开始时间':'拖动调整截止时间'} disabled={blocked||row.readOnly||done||row.task.status==='cancelled'||!!row.task.deletedAt} onPointerDown={e=>{e.stopPropagation();begin(e,row,edge,true);}} onClick={e=>e.stopPropagation()}><span/></button>}
      <button type="button" className="calendar-chip-copy" aria-label={description} disabled={blocked} onClick={e=>{e.stopPropagation();if(view==='month'){cancel();editRow(rows.find(r=>calendarRowKey(r)===key)||row);}else editRow(rows.find(r=>calendarRowKey(r)===key)||row);}}>{row.windowId?<small className="calendar-shared-meta"><SharedPlanBadge name={row.windowName} compact={view!=='month'}/><span className="calendar-deadline-text">{scheduled?pointLabel+' '+((view==='month'||expanded)&&scheduled!==(expanded||agendaDate)?scheduled?.slice(5)+' ':'')+(shownTime||'全天'):'未安排'}</span><span className="calendar-meta-overflow">{view!=='month'?row.windowName:''}{row.task.seriesId||row.task.recurrenceAnchor?' · 重复':''}{isPending?' · 待确认':''}</span></small>:<small>{scheduled?pointLabel+' '+((view==='month'||expanded)&&scheduled!==(expanded||agendaDate)?scheduled?.slice(5)+' ':'')+(shownTime||'全天'):'未安排'} · {c?.name||'待分类'}{row.task.seriesId||row.task.recurrenceAnchor?' · 重复':''}{row.task.checkinEnabled!==false&&(row.task.checkinEnabled===true||row.task.checkins)?` · 打卡${row.task.checkins||0}次`:''}{isPending?' · 待确认':''}</small>}<strong>{span&&<span className="plan-duration-badge">持续</span>}{row.task.title}</strong>{(edge==='end'||!timed)&&planState(row.task)!=='neutral'&&<span className={'calendar-state-badge badge-'+planState(row.task)}>{({done:'已完成',overdue:'已超期',soon:'即将到期',neutral:''})[planState(row.task)]}</span>}{row.task.status==='cancelled'&&<span className="calendar-state-badge">已取消</span>}</button>
      {(view==='month'||!!expanded)&&<button type="button" className="calendar-chip-drag" disabled={blocked||row.readOnly||done||row.task.status==='cancelled'||!!row.task.deletedAt} aria-label={`拖动改期：${row.task.title}`} title="拖动到日期改期；键盘可按 Enter 打开编辑" onClick={e=>{if(e.detail===0)editRow(rows.find(r=>calendarRowKey(r)===key)||row);}}><GripVertical size={18}/></button>}
    </div>;
  };
  const continuous=(row:ActionRow,date:string)=>{
   const span=rowSpan(row)!,marker=markersByDate.get(date)?.get(calendarRowKey(row)+':span');if(!marker)return null;
   const key=calendarRowKey(row),starts=span.start.slice(0,10)===date,ends=span.end.slice(0,10)===date,done=row.task.done||row.task.status==='done';
   const execution=span.startKind!=='planned'&&row.task.startDate===date&&row.task.startTime?timelineOffset(row.task.startTime,hours)-marker.anchor:undefined;
   const actual=localMinute(row.task.completedAt||''),completion=actual.slice(0,10)===date?timelineOffset(actual.slice(11),hours)-marker.anchor:undefined;
   const label=`${row.task.title} · ${span.startKind==='planned'?'原定开始':span.startKind==='created'?'创建':'期次开始'} ${span.start.replace('T',' ')} → 截止 ${span.end.replace('T',' ')}${row.task.startDate?' · 执行开始 '+row.task.startDate+' '+(row.task.startTime||''):''}`;
   return <div key={key} className={`calendar-chip calendar-continuous state-${planState(row.task)}`} data-range-key={key} data-range-edge={starts?'start':'end'} data-record-id={row.task.id} data-shared={!!row.windowId||undefined} data-preview-key={key} data-pending={pendingKeys.has(key)||undefined} data-dragging={drag?.row.task.id===row.task.id||undefined} data-continues-before={!starts||undefined} data-continues-after={!ends||undefined} style={{...urgencyStyle(row.task),left:marker.anchor,top:marker.lane*LANE_HEIGHT+4,width:Math.max(DEADLINE_WIDTH,marker.width),'--span-width':`${marker.width}px`} as CSSProperties} onPointerDown={e=>{const target=e.target as HTMLElement;if(target.closest('.lifecycle-start,.lifecycle-deadline,.endpoint-grip,.calendar-chip-check'))return;begin(e,row,'end');}} onPointerMove={move} onPointerUp={release} onPointerCancel={()=>end(!!pending.length)}>
    <span className="lifecycle-track" aria-hidden="true"/>{!starts&&<span className="lifecycle-before" aria-hidden="true">‹</span>}{!ends&&<span className="lifecycle-after" style={{left:marker.width-14}} aria-hidden="true">›</span>}
    {hiddenHourRanges(hours).filter(gap=>gap.index*HOUR_WIDTH>marker.anchor&&gap.index*HOUR_WIDTH<marker.anchor+marker.width).map(gap=><i className="lifecycle-break" key={gap.index} style={{left:gap.index*HOUR_WIDTH-marker.anchor}} title="中间时段已压缩"/>)}
    <label className="calendar-chip-check" style={starts?{marginLeft:44}:undefined} onPointerDown={e=>e.stopPropagation()}><input type="checkbox" checked={done} disabled={blocked||row.readOnly||row.task.status==='cancelled'||!!row.task.deletedAt} aria-label={`完成：${row.task.title}`} onChange={()=>onToggle(row)}/></label>
    <button type="button" className="calendar-chip-copy" aria-label={label} onClick={()=>editRow(rows.find(r=>calendarRowKey(r)===key)||row)}><small>{row.windowId&&<SharedPlanBadge name={row.windowName} compact/>}{starts?(span.startKind==='planned'?'开始 ':span.startKind==='created'?'创建 ':'期次 ')+span.start.slice(11):'持续中'}{ends?' → 截止 '+(planDueTime(row.task)||'全天'):''}</small><strong>{row.task.title}</strong>{planState(row.task)!=='neutral'&&<span className={'calendar-state-badge badge-'+planState(row.task)}>{({done:'已完成',overdue:'已超期',soon:'即将到期',neutral:''})[planState(row.task)]}</span>}</button>
    {execution!==undefined&&execution>=0&&execution<=marker.width&&<i className="lifecycle-execution" style={{left:execution}} title={`执行开始 ${row.task.startTime}`} aria-label={`执行开始 ${row.task.startTime}`}/>}
    {completion!==undefined&&completion>=0&&completion<=marker.width&&<i className="lifecycle-completed" style={{left:completion}} title={`实际完成 ${actual}`} aria-label={`实际完成 ${actual}`}>✓</i>}
    {starts&&<button type="button" className="lifecycle-start" style={{left:0}} disabled={blocked||row.readOnly||done||row.task.status==='cancelled'||!!row.task.deletedAt} aria-label={`调整开始：${row.task.title}`} title="拖动修改原定开始；创建时间不变" onPointerDown={e=>begin(e,row,'start',true)} onClick={e=>e.stopPropagation()}><span/></button>}
    {ends&&<button type="button" className="lifecycle-deadline" style={{left:marker.width-22}} disabled={blocked||row.readOnly||done||row.task.status==='cancelled'||!!row.task.deletedAt} aria-label={`调整截止：${row.task.title}`} title="拖动末端调整截止，15分钟吸附" onPointerDown={e=>begin(e,row,'end',true)} onClick={e=>e.stopPropagation()}><span/></button>}
   </div>;
  };
  const operationPreview=(date:string)=>{
    if(!operationRow||selectedKey||expanded||view==='month')return null;
    const marker=intervalPreviewMarker(operationRow,date,hours,markersByDate.get(date)!,operationEdge);if(!marker)return null;
    return <div className="calendar-interval-preview" aria-hidden="true" data-range-key={operationKey} data-range-edge={operationEdge} data-continues-before={marker.before||undefined} data-continues-after={marker.after||undefined} style={{...urgencyStyle(operationRow.task),left:marker.anchor,top:marker.lane*LANE_HEIGHT+4,width:Math.max(1,marker.width)}}>
      {marker.before&&<span className="lifecycle-before">‹</span>}{marker.after&&<span className="lifecycle-after">›</span>}
      {hiddenHourRanges(hours).filter(gap=>gap.index*HOUR_WIDTH>marker.anchor&&gap.index*HOUR_WIDTH<marker.anchor+marker.width).map(gap=><i className="lifecycle-break" key={gap.index} style={{left:gap.index*HOUR_WIDTH-marker.anchor}}/>)}
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
          const label=`查看 ${date} 的日程，周${['一','二','三','四','五','六','日'][index]}，${summary.count} 项日程，${diaryRows(date).length} 条日记${summary.shared?`，共享 ${summary.shared} 项`:''}${pendingCount?`，待确认 ${pendingCount} 项`:''}${summary.tones.map(t=>`，${t.label} ${t.count} 项`).join('')}`;
          return <div key={date} role="gridcell" aria-selected={agendaDate===date} data-calendar-date={date} data-pending={!!pendingCount||undefined} data-drop-active={drag?.target?.date===date||undefined} data-other-month={date.slice(0,7)!==anchor.slice(0,7)} data-weekend={index>4||undefined} data-today={date===planClock().date||undefined} data-selected={agendaDate===date||undefined} className="calendar-day">
            <button type="button" className="calendar-date" data-shared={!!summary.shared||undefined} disabled={submitting} tabIndex={(monthDays.includes(monthFocus)?monthFocus:agendaDate)===date?0:-1} aria-label={label} aria-controls="calendar-month-agenda" aria-current={date===planClock().date?'date':undefined} onFocus={()=>setMonthFocus(date)} onClick={()=>onMonthDate(date)} onKeyDown={e=>{
              const at=monthDays.indexOf(date),offset=({ArrowLeft:-1,ArrowRight:1,ArrowUp:-7,ArrowDown:7} as Record<string,number>)[e.key];
              const next=e.key==='Home'?at-index:e.key==='End'?at+6-index:offset===undefined?undefined:Math.max(0,Math.min(monthDays.length-1,at+offset));
              if(next!==undefined){e.preventDefault();scroll.current?.querySelector<HTMLButtonElement>(`.calendar-day[data-calendar-date="${monthDays[next]}"] .calendar-date`)?.focus();}
            }}><span className="month-date-top"><span className="calendar-day-number">{Number(date.slice(-2))}</span><small aria-hidden="true">{summary.count+diaryRows(date).length>99?'99+':summary.count+diaryRows(date).length||''}</small></span><span className="month-day-marks" aria-hidden="true">{summary.tones.map(t=><i key={t.id} style={{background:t.color}}/>)}{!!summary.shared&&<Users size={11}/>}{!!diaryRows(date).length&&<Feather size={11}/>}</span></button>
          </div>;
        })}</div>)}</div>
      </div>
    </section>
    <div className="calendar-month-day-pane" data-month-scroll>
      <section id="calendar-month-agenda" className="calendar-day-agenda" aria-label={`${agendaDate} 的日程表`}>
        <header><h3>{agendaDate} · 周{['日','一','二','三','四','五','六'][new Date(agendaDate+'T00:00:00Z').getUTCDay()]}</h3><small role="status" aria-live="polite">{dayRows(agendaDate).length} 项日程{diaryRows(agendaDate).length?` · ${diaryRows(agendaDate).length} 条日记`:""}</small></header>
        {agendaGroups.length?agendaGroups.map(group=><section className="month-agenda-group" key={group.time} aria-label={group.time==='持续中'?'持续中的日程':group.time?`截止 ${group.time}`:'全天截止'}><h4>{group.time||'全天'}{group.time&&group.time!=='持续中'&&<small>截止</small>}</h4><div>{group.rows.map(row=>chip(row))}</div></section>):<p className="calendar-day-agenda-empty">这天暂无日程，可通过底部＋新增。</p>}
        {!!diaryRows(agendaDate).length&&<section className="calendar-diary-group" aria-label="当天匹配的日记">{diaryCards(agendaDate)}</section>}
      </section>
      {!!unarranged.length&&<details className="calendar-unarranged calendar-month-unarranged"><summary>未安排 · {unarranged.length}项</summary><div>{unarranged.map(row=>chip(row))}</div></details>}
    </div>
  </div>;
  const renderTimeline=()=> <div className="calendar-timeline-canvas" style={{'--timeline-hours-width':`${axisWidth}px`,'--timeline-all-width':allDay?'var(--timeline-all-column-width,164px)':'0px'} as CSSProperties}>
    <div className="calendar-timeline-heading">
      <div className="timeline-corner">日期</div>
      {allDay&&<div className="timeline-all-heading">{diarySearch?.items.length?"全天／日记":"全天"}</div>}
      <div className="timeline-hour-axis" aria-label="日程小时刻度">{hours.map(hour=><span key={hour} style={{left:hours.indexOf(hour)*HOUR_WIDTH}}>{String(hour).padStart(2,'0')}:00</span>)}{hiddenHourRanges(hours).map(gap=><button type="button" key={'gap'+gap.index} className="timeline-hour-gap" style={{left:gap.index*HOUR_WIDTH-44}} aria-label={`已压缩时段：${gap.from} 至 ${gap.to}，打开时段设置`} title={`已隐藏 ${gap.from}—${gap.to}，点击设置显示时段`} aria-haspopup="dialog" onClick={onOpenHoursSettings}>⋯</button>)}{!hours.length&&<span className="timeline-no-hours">暂无定时日程</span>}</div>
    </div>
    {days.map((date,index)=>{const layout=rowLayouts.get(date)!;const inView=layout.top+layout.height>=viewport.top-400&&layout.top<=viewport.top+viewport.height+400;const pinned=drag&&(rowSpan(drag.row)?date>=(rowSpan(drag.row)!.start.slice(0,10))&&date<=rowSpan(drag.row)!.end.slice(0,10):date===drag.row.task.dueDate);if(!inView&&!pinned)return <div className="timeline-row-spacer" key={date} style={{height:layout.height}} aria-hidden="true"/>;return <div className="calendar-timeline-row" data-date={date} data-week-start={view==='fortnight'&&index%7===0&&index>0||undefined} key={date} style={{height:rowHeight(date)}}>
      <button type="button" className="timeline-date" data-today={date===planClock().date||undefined} data-calendar-date={date} data-drop-active={drag?.target?.date===date&&!drag.target.time||undefined} title={`${date} · 可拖入全天日程`} onClick={()=>showDay(date)} aria-label={`查看 ${date} 的日程`} aria-expanded={expanded===date} aria-describedby={offscreen[date]?`timeline-offscreen-${date}`:undefined}><strong>{date.slice(5)}</strong><small>{date.slice(0,4)} · 周{['日','一','二','三','四','五','六'][new Date(date+'T00:00:00Z').getUTCDay()]}</small><small>{!!offscreen[date]?.left&&<span className="timeline-outside" aria-hidden="true">← </span>}{dayRows(date).length+diaryRows(date).length} 项{dayRows(date).some(row=>{const span=rowSpan(row);return span&&span.start.slice(0,10)<date&&span.end.slice(0,10)>date;})&&<span title="点日期查看持续任务">·持续</span>}{!!offscreen[date]?.right&&<span className="timeline-outside" aria-hidden="true"> →</span>}</small>{offscreen[date]&&<span className="sr-only" id={`timeline-offscreen-${date}`}>{offscreen[date].left?`左侧还有 ${offscreen[date].left} 个时间标记。`:''}{offscreen[date].right?`右侧还有 ${offscreen[date].right} 个时间标记。`:''}点击日期查看当天全部日程。</span>}</button>
      {allDay&&<div className="timeline-all-day" data-calendar-date={date} data-drop-active={drag?.target?.date===date&&!drag.target.time||undefined}>{dayRows(date).filter(row=>!rowSpan(row)&&!planDueTime(row.task)).map(row=>chip(row))}{diaryCards(date)}</div>}
      <div className="timeline-timed-cell" data-calendar-date={date} data-timed="true" data-drop-active={drag?.target?.date===date&&!!drag.target.time||undefined} style={{backgroundSize:`${HOUR_WIDTH}px 100%`}}><div className="timeline-markers" style={{height:contentHeight(date)}}>{operationPreview(date)}{[...(markersByDate.get(date)?.values()||[])].map(marker=>{
        if(drag?.row.task.id!==marker.row.task.id&&(marker.anchor+Math.max(DEADLINE_WIDTH,marker.width)<viewport.left-180||marker.anchor>viewport.left+viewportWidth+180))return null;
        return marker.edge==='span'?continuous(marker.row,date):chip(marker.row,true,marker.edge);
      })}</div></div>
    </div>;})}
    {!!unarranged.length&&<div className="timeline-unarranged-wrap"><details className="calendar-unarranged" style={{width:viewportWidth||'100%'}}><summary>未安排 · {unarranged.length}项</summary><div>{unarranged.map(row=>chip(row))}</div></details></div>}
  </div>;
  return <div className="plan-calendar" data-dragging={!!drag||undefined}>
    {selected&&view!=='month'&&!expanded&&<div className="calendar-selection-bar" role="region" aria-label="所选日程时间段"><div><strong>{selected.task.title}</strong><small>{rowSpan(selected)?`${rowSpan(selected)!.startKind==='planned'?'开始':rowSpan(selected)!.startKind==='created'?'创建（未设开始）':'期次起点（未设开始）'} ${rowSpan(selected)!.start.replace('T',' ')} → 截止 ${rowSpan(selected)!.end.replace('T',' ')}`:'尚未设置完整开始和截止'}{selected.readOnly?' · 仅查看':''}</small></div><button type="button" className="quiet-button" onClick={()=>editRow(rows.find(row=>calendarRowKey(row)===selectedKey)||selected)}>编辑详情</button><button type="button" className="quiet-button" aria-label="收起时间段" onClick={()=>{pinned.current=false;setSelectedKey(undefined);}}>收起</button></div>}

    {drag&&gesture.current?.mode==='drag'&&createPortal(<div ref={ghost} className="calendar-drag-ghost" aria-hidden="true" style={{...urgencyStyle(drag.row.task),width:gesture.current.width,transform:`translate3d(${gesture.current.x-gesture.current.offsetX}px,${gesture.current.y-gesture.current.offsetY}px,0)`}}><strong>{drag.row.task.title}</strong><div className="calendar-ghost-meta">{drag.row.windowId&&<SharedPlanBadge name={drag.row.windowName} compact/>}<small>{gesture.current?.edge==='start'?'开始':'截止'} {drag.target?`${drag.target.date} ${drag.target.time||'全天'}`:'拖动到目标日期'}</small></div></div>,document.body)}
    {drag&&<p className="calendar-feedback" role="status">{gesture.current?.mode==='scrub'?'左右滑动调整':'拖动'}「{drag.row.task.title}」{drag.target?` → ${drag.target.date} ${drag.target.time||'全天'}`:'到目标日期'} · Escape 取消</p>}

    {batchMessage&&<p className="calendar-batch-message" role="status">{batchMessage}</p>}
    <div ref={scroll} className="calendar-scroll" data-view={view} data-panning={panning||undefined} onScroll={()=>{if(!gesture.current&&!pending.length)clearHover();viewportFrame.schedule();extendWeeks();}} onPointerOver={enterRange} onPointerOut={leaveRange} onPointerLeave={()=>{if(!gesture.current){clearHover();if(!pending.length&&!focused&&!pinned.current)setSelectedKey(undefined);}}} onFocusCapture={e=>{const target=rangeTarget(e.target);if(target&&(e.target as HTMLElement).matches(':focus-visible'))setFocused({key:target.dataset.rangeKey!,edge:target.dataset.rangeEdge==='end'?'end':'start'});}} onBlurCapture={e=>{if(rangeTarget(e.target)?.dataset.rangeKey!==rangeTarget(e.relatedTarget)?.dataset.rangeKey)setFocused(undefined);}} onPointerDownCapture={()=>{suppressGestureClick.current=false;}} onClickCapture={e=>{if(suppressGestureClick.current&&e.detail>0){suppressGestureClick.current=false;e.preventDefault();e.stopPropagation();}}} onPointerDown={beginPan} onPointerMove={movePan} onPointerUp={releasePan} onPointerCancel={releasePan} onLostPointerCapture={releasePan}>
      {expanded&&view!=='month'&&<section className="calendar-focused-day calendar-day-agenda" hidden={!!drag} aria-label={`${expanded} 当天日程`}><header><h3 ref={dayHeading} tabIndex={-1}>{expanded} · 周{['日','一','二','三','四','五','六'][new Date(expanded+'T00:00:00Z').getUTCDay()]}</h3><small>{dayRows(expanded).length} 项日程{diaryRows(expanded).length?` · ${diaryRows(expanded).length} 条日记`:""}</small><button type="button" onClick={closeDay}>返回{view==='fortnight'?'两周':'周视图'}</button></header>{monthAgendaGroups(dayRows(expanded),expanded).map(group=><section className="month-agenda-group" key={group.time}><h4>{group.time||'全天'}{group.time&&group.time!=='持续中'&&<small>截止</small>}</h4><div>{group.rows.map(row=>chip(row))}</div></section>)}{diaryCards(expanded)}{!dayRows(expanded).length&&!diaryRows(expanded).length&&<p className="calendar-day-agenda-empty">这天暂无日程，可通过底部＋新增。</p>}</section>}
      {view==='month'?renderMonth():<div className="calendar-timeline-shell" hidden={!!expanded&&!drag}>{renderTimeline()}</div>}
    </div>
    <div className="calendar-action-slot" hidden={!pending.length&&!submitting}>
      <PlanActionDock className="calendar-drop-review" busy={blocked} onCancel={cancel} onConfirm={()=>void confirm()} label={pending.length>1?`确认改期（${pending.length}项）`:'确认改期'} status={submitting?`正在保存 ${progress.current}/${progress.total} 项改期`:pending.length===1?`待确认：${pending[0].target.startDate?'开始 '+pending[0].target.startDate+' '+(pending[0].target.startTime||'全天')+'；':''}截止 ${pending[0].target.date} ${pending[0].target.time||'全天'}，仅修改这一期`:`待确认：${pending.length} 项日程 · 仅修改原定开始与截止`}/>
    </div>
  </div>;
}
