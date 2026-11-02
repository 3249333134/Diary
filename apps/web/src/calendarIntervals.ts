import {resolveScheduleSpan,displayScheduleSpan,spanOnDate,type ScheduleSpan} from '@diary/contracts';
import type {ActionRow} from './api';
import {calendarRowKey} from './calendarPreview';
import {DEADLINE_WIDTH,HOUR_WIDTH,timelineOffset} from './calendarTimeline';
import {planDueTime} from './planFilters';
export const rowSpan=(row:ActionRow):ScheduleSpan|undefined=>displayScheduleSpan(row.task,row.span||resolveScheduleSpan(row.task));
export function groupCalendarDays(rows:readonly ActionRow[],dates:readonly string[]){
 const groups=new Map(dates.map(date=>[date,[] as ActionRow[]]));
 for(const row of rows){const span=rowSpan(row),due=row.task.dueDate||row.task.plannedDate;for(const date of dates)if(span?spanOnDate(span,date):due===date)groups.get(date)!.push(row);}
 return groups;
}
export function intervalHours(rows:readonly ActionRow[],selected?:string){
 return rows.flatMap(row=>{const span=rowSpan(row);return span?[span.start.slice(11),span.end.slice(11),...(selected===calendarRowKey(row)&&span.start.slice(0,10)!==span.end.slice(0,10)?['00:00','23:00']:[]),...(row.task.startTime?[row.task.startTime]:[])]:[planDueTime(row.task)||''];});
}
export function intervalMarkers(rows:readonly ActionRow[],date:string,hours:number[]){
 const ends:number[]=[];
 return new Map(rows.map(row=>{
  const span=rowSpan(row),start=span?(span.start.slice(0,10)<date?'00:00':span.start.slice(11)):planDueTime(row.task)||'00:00';
  const end=span?(span.end.slice(0,10)>date?'23:59':span.end.slice(11)):start;
  const anchor=timelineOffset(start,hours),finish=timelineOffset(end,hours),width=Math.max(1,finish-anchor);
  return {key:calendarRowKey(row),span,anchor,width,start,end};
 }).sort((a,b)=>a.anchor-b.anchor||a.key.localeCompare(b.key)).map(item=>{
  let lane=ends.findIndex(end=>end+8<=item.anchor);if(lane<0)lane=ends.length;
  ends[lane]=item.anchor+Math.max(DEADLINE_WIDTH,item.width);
  return [item.key,{...item,lane}];
 }));
}

export function endpointMarkers(rows:readonly ActionRow[],date:string,hours:number[],selected?:string){
 const items=rows.flatMap(row=>{
  const key=calendarRowKey(row),span=rowSpan(row),due=row.task.dueDate||row.task.plannedDate;
  if(span&&selected===key){const marker=intervalMarkers([row],date,hours).get(key)!;return [{...marker,key:key+':span',row,edge:'span' as const}];}
  const endpoints=[] as {key:string;row:ActionRow;edge:'start'|'end'|'span';anchor:number;width:number;lane:number}[];
  if(span?.start.slice(0,10)===date)endpoints.push({key:key+':start',row,edge:'start',anchor:timelineOffset(span.start.slice(11),hours),width:0,lane:0});
  if(due===date&&(span||planDueTime(row.task)))endpoints.push({key:key+':end',row,edge:'end',anchor:timelineOffset(span?.end.slice(11)||planDueTime(row.task)||'00:00',hours),width:0,lane:0});
  return endpoints;
 }).sort((a,b)=>a.anchor-b.anchor||a.key.localeCompare(b.key));
 const ends:number[]=[];
 return new Map(items.map(item=>{let lane=ends.findIndex(end=>end+8<=item.anchor);if(lane<0)lane=ends.length;ends[lane]=item.anchor+Math.max(DEADLINE_WIDTH,item.width);return[item.key,{...item,lane}];}));
}

/** Temporary range highlighting must not move or replace the draggable endpoint cards. */
export function intervalPreviewMarker(row:ActionRow,date:string,hours:number[],markers:ReturnType<typeof endpointMarkers>,edge:'start'|'end'='start'){
 const span=rowSpan(row);if(!span||!spanOnDate(span,date))return;
 const key=calendarRowKey(row),before=span.start.slice(0,10)<date,after=span.end.slice(0,10)>date,start=before?'00:00':span.start.slice(11),end=after?'23:59':span.end.slice(11);
 // Hidden boundary hours have no column: clip at the shown axis edges rather than mapping them to its first hour.
 const anchor=before?0:timelineOffset(start,hours),finish=after?hours.length*HOUR_WIDTH:timelineOffset(end,hours);
 const own=[...markers.values()].filter(m=>calendarRowKey(m.row)===key);
 return {key,span,anchor,width:Math.max(1,finish-anchor),start,end,lane:(own.find(m=>m.edge===edge)||own[0])?.lane||0,before,after};
}
