import type { ActionRow } from './api';
import { calendarRange, shiftDate } from './calendarDates';
import { planDueTime } from './planFilters';
import { QUADRANTS, urgency } from './planUrgency';

/** Display complete weeks covering this month; the server query stays at 42 days. */
export function monthGridDates(anchor:string) {
  const {from}=calendarRange(anchor,'month');
  const end=new Date(`${anchor.slice(0,7)}-01T00:00:00Z`);
  end.setUTCMonth(end.getUTCMonth()+1);end.setUTCDate(0);
  const last=end.toISOString().slice(0,10);
  const weekday=(end.getUTCDay()+6)%7;
  const to=shiftDate(last,6-weekday);
  return Array.from({length:Math.round((Date.parse(to)-Date.parse(from))/86400000)+1},(_,i)=>shiftDate(from,i));
}

export function selectedMonthDate(anchor:string,today:string,remembered?:string) {
  if(remembered&&monthGridDates(anchor).includes(remembered))return remembered;
  return anchor.slice(0,7)===today.slice(0,7)?today:`${anchor.slice(0,7)}-01`;
}

export function monthDaySummary(rows:readonly ActionRow[]) {
  const tones=[...QUADRANTS,{id:'unclassified',label:'待分类',color:'#737785'}];
  return {count:rows.length,shared:rows.filter(row=>row.windowId).length,
    tones:tones.flatMap(tone=>{const count=rows.filter(row=>(urgency(row.task)?.id||'unclassified')===tone.id).length;return count?[{...tone,count}]:[];})};
}

/** Stable grouping preserves server order for tasks with the same deadline. */
export function monthAgendaGroups(rows:readonly ActionRow[]) {
  const grouped=new Map<string,ActionRow[]>();
  for(const row of rows){const time=planDueTime(row.task)||'';const group=grouped.get(time);if(group)group.push(row);else grouped.set(time,[row]);}
  return [...grouped].sort(([a],[b])=>a.localeCompare(b)).map(([time,rows])=>({time,rows}));
}
