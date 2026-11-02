export type SpanTask={createdAt?:string;dueDate?:string;plannedDate?:string;dueTime?:string;time?:string;seriesId?:string;occurrenceDate?:string;startDate?:string;startTime?:string};
export type ScheduleSpan={start:string;end:string;startKind:'created'|'period'|'planned'};
const clocks=new Map<string,Intl.DateTimeFormat>();
export function localMinute(instant:string,timezone='Asia/Shanghai'){
 if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/.test(instant)||!Number.isFinite(Date.parse(instant)))return '';
 let clock=clocks.get(timezone);if(!clock){clock=new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});clocks.set(timezone,clock);}
 const parts=clock.formatToParts(new Date(instant)),get=(key:string)=>parts.find(p=>p.type===key)?.value||'';
 return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`;
}
export function deadlineMinute(task:SpanTask){const date=task.dueDate||task.plannedDate;return date?`${date}T${(task.dueDate?task.dueTime:task.time)||'23:59'}`:'';}
export function resolveScheduleSpan(task:SpanTask,timezone='Asia/Shanghai',periodStart?:string):ScheduleSpan|undefined{
 const start=periodStart||(task.seriesId?'':localMinute(task.createdAt||'',timezone)),end=deadlineMinute(task);
 return start&&end&&start<end?{start,end,startKind:periodStart?'period':'created'}:undefined;
}
/** Editable execution dates take visual precedence; immutable creation remains a separate fact. */
export function displayScheduleSpan(task:SpanTask,lifecycle?:ScheduleSpan):ScheduleSpan|undefined{
 const start=task.startDate?`${task.startDate}T${task.startTime||'00:00'}`:'',end=deadlineMinute(task);
 return start&&end&&start<end?{start,end,startKind:'planned'}:lifecycle;
}
export function spanIntersects(task:SpanTask,span:ScheduleSpan|undefined,from:string,to:string){
 if(span)return span.start<=to+'T23:59'&&span.end>=from+'T00:00';
 const date=task.dueDate||task.plannedDate||'';return !!date&&date>=from&&date<=to;
}
export function spanOnDate(span:ScheduleSpan|undefined,date:string){return !!span&&span.start<=date+'T23:59'&&span.end>=date+'T00:00';}
/** A preview changes its end only; the original period boundary is immutable. */
export function previewScheduleSpan(task:SpanTask,span?:ScheduleSpan,timezone='Asia/Shanghai'){
 return resolveScheduleSpan(task,timezone,span?.startKind==='period'?span.start:undefined);
}
