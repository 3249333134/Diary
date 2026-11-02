import {previewScheduleSpan,displayScheduleSpan,resolveScheduleSpan,deadlineMinute} from '@diary/contracts';
import type {ActionRow} from './api';
import {planDueTime} from './planFilters';
export type CalendarTarget={date:string;time:string;edge?:'start'|'end';startDate?:string;startTime?:string};
export type CalendarPreview={row:ActionRow;target:CalendarTarget};
export const calendarRowKey=(row:ActionRow)=>`${row.windowId?row.windowId+':':''}${row.date}:${row.task.id}`;
const originalStart=(row:ActionRow)=>displayScheduleSpan(row.task,row.span||resolveScheduleSpan(row.task))?.start||'';
export const sameCalendarTarget=(row:ActionRow,target:CalendarTarget)=>target.edge==='start'?originalStart(row)===`${target.date}T${target.time||'00:00'}`:(row.task.dueDate||row.task.plannedDate||'')===target.date&&(planDueTime(row.task)||'')===target.time;
export function previewCalendarRows(rows:ActionRow[],previews:readonly CalendarPreview[]=[]):ActionRow[]{
 if(!previews.length)return rows;
 const targets=new Map(previews.map(preview=>[calendarRowKey(preview.row),preview.target]));
 return rows.map(row=>{const target=targets.get(calendarRowKey(row));if(!target)return row;const task={...row.task,dueDate:target.date,dueTime:target.time,...target.startDate!==undefined?{startDate:target.startDate,startTime:target.startTime||''}:{}};return {...row,task,span:previewScheduleSpan(task,row.span)};});
}
/** Both endpoints share one preview and one eventual versioned write. */
export function updateCalendarPreviews(previews:readonly CalendarPreview[],row:ActionRow,target?:CalendarTarget):CalendarPreview[]{
 const key=calendarRowKey(row),index=previews.findIndex(preview=>calendarRowKey(preview.row)===key),prior=previews[index];
 const original=prior?.row||row;
 if(!target)return previews.filter(preview=>calendarRowKey(preview.row)!==key);
 let next:CalendarTarget={...(prior?.target||{date:original.task.dueDate||original.task.plannedDate||'',time:planDueTime(original.task)||''})};
 if(target.edge==='start'){
  if(sameCalendarTarget(original,target)){delete next.startDate;delete next.startTime;}
  else {next.startDate=target.date;next.startTime=target.time;}
 }else {next.date=target.date;next.time=target.time;}
 const start=next.startDate?`${next.startDate}T${next.startTime||'00:00'}`:originalStart(original),end=deadlineMinute({dueDate:next.date,dueTime:next.time});
 if(start&&end&&start>=end)return [...previews];
 if(sameCalendarTarget(original,next)&&next.startDate===undefined)return previews.filter(preview=>calendarRowKey(preview.row)!==key);
 const preview={row:original,target:next};
 return index<0?[...previews,preview]:previews.map((item,i)=>i===index?preview:item);
}

export function calendarTimeConflict(before:ActionRow,latest:ActionRow){
 return (['dueDate','dueTime','startDate','startTime','done','status','deletedAt'] as const).some(key=>(before.task[key]||'')!==(latest.task[key]||''));
}
