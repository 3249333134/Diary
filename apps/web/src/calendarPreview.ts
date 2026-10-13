import type {ActionRow} from './api';
import {planDueTime} from './planFilters';
export type CalendarTarget={date:string;time:string};
export type CalendarPreview={row:ActionRow;target:CalendarTarget};
export const calendarRowKey=(row:ActionRow)=>`${row.date}:${row.task.id}`;
export const sameCalendarTarget=(row:ActionRow,target:CalendarTarget)=>(row.task.dueDate||row.task.plannedDate||'')===target.date&&(planDueTime(row.task)||'')===target.time;
/** A display-only projection: the saved row and its occurrence identity stay intact. */
export function previewCalendarRows(rows:ActionRow[],previews:readonly CalendarPreview[]=[]):ActionRow[]{
  if(!previews.length)return rows;
  const targets=new Map(previews.map(preview=>[calendarRowKey(preview.row),preview.target]));
  return rows.map(row=>{const target=targets.get(calendarRowKey(row));return target?{...row,task:{...row.task,dueDate:target.date,dueTime:target.time}}:row;});
}
/** Re-dragging changes the target, while keeping the first saved row for cancellation. */
export function updateCalendarPreviews(previews:readonly CalendarPreview[],row:ActionRow,target?:CalendarTarget):CalendarPreview[]{
  const key=calendarRowKey(row),index=previews.findIndex(preview=>calendarRowKey(preview.row)===key);
  const original=index<0?row:previews[index].row;
  if(!target||sameCalendarTarget(original,target))return previews.filter(preview=>calendarRowKey(preview.row)!==key);
  const preview={row:original,target};
  return index<0?[...previews,preview]:previews.map((item,i)=>i===index?preview:item);
}
