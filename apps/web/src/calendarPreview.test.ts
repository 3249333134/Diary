import {expect,it} from 'vitest';
import {todoSchema} from '@diary/contracts';
import type {ActionRow} from './api';
import {calendarRowKey,previewCalendarRows,sameCalendarTarget,updateCalendarPreviews} from './calendarPreview';

const row=(id='one',date='2026-10-13'):ActionRow=>({date,version:'v1',task:todoSchema.parse({id,title:'每周会议',dueDate:'2026-10-13',dueTime:'10:00',startDate:'2026-10-13',startTime:'09:00',seriesId:'series',occurrenceDate:'2026-10-13',category:'work',important:true,urgent:false}),completionExists:false,sourceExists:false});
it('moves only the displayed deadline without mutating the saved occurrence',()=>{
 const original=row(),before=structuredClone(original),other=row('two');
 const result=previewCalendarRows([original,other],[{row:original,target:{date:'2026-10-14',time:'11:15'}}]);
 expect(original).toEqual(before);expect(result[0].task.dueDate).toBe('2026-10-14');expect(result[0].task.dueTime).toBe('11:15');
 expect(result[0].task.startTime).toBe('09:00');expect(result[0].task.occurrenceDate).toBe('2026-10-13');expect(result[0].task.seriesId).toBe('series');expect(result[0].task.category).toBe('work');expect(result[1]).toBe(other);
});
it('cancelling a preview restores the original rows and times',()=>{
 const rows=[row()];expect(previewCalendarRows(rows)).toBe(rows);expect(rows[0].task.dueTime).toBe('10:00');
});
it('keeps identical task IDs in different owner diaries independent',()=>{
 const a=row(),b=row('one','2026-10-14');expect(calendarRowKey(a)).not.toBe(calendarRowKey(b));
 const result=previewCalendarRows([a,b],[{row:a,target:{date:'2026-10-18',time:''}}]);expect(result[0].task.dueTime).toBe('');expect(result[1]).toBe(b);
});
it('projects multiple deadlines together and leaves the saved rows intact',()=>{
 const a=row(),b=row('two'),rows=[a,b],before=structuredClone(rows);
 const previews=updateCalendarPreviews(updateCalendarPreviews([],a,{date:'2026-10-14',time:'11:15'}),b,{date:'2026-10-15',time:''});
 const result=previewCalendarRows(rows,previews);expect(rows).toEqual(before);expect(result.map(r=>[r.task.dueDate,r.task.dueTime])).toEqual([['2026-10-14','11:15'],['2026-10-15','']]);
 expect(previewCalendarRows(rows,[])).toBe(rows);
});
it('re-dragging preserves the saved origin and removes only the returned item',()=>{
 const a=row(),b=row('two');let previews=updateCalendarPreviews([],a,{date:'2026-10-14',time:'11:15'});
 previews=updateCalendarPreviews(previews,b,{date:'2026-10-15',time:'12:00'});
 const displayed=previewCalendarRows([a,b],previews)[0];previews=updateCalendarPreviews(previews,displayed,{date:'2026-10-16',time:'13:00'});
 expect(previews).toHaveLength(2);expect(previews[0].row).toBe(a);expect(previews[0].target.date).toBe('2026-10-16');
 const remaining=updateCalendarPreviews(previews,displayed,{date:'2026-10-13',time:'10:00'});expect(remaining).toHaveLength(1);expect(remaining[0].row).toBe(b);expect(previews).toHaveLength(2);
});
it('invalid drops remove only that preview and retain other pending changes',()=>{
 const a=row(),b=row('two');const previews=updateCalendarPreviews(updateCalendarPreviews([],a,{date:'2026-10-14',time:''}),b,{date:'2026-10-15',time:'12:00'});
 const remaining=updateCalendarPreviews(previews,a);expect(remaining).toHaveLength(1);expect(remaining[0]).toBe(previews[1]);
 expect(updateCalendarPreviews(previews,row('third'))).toEqual(previews);
});
it('recognizes an unchanged deadline including legacy dates and date-only values',()=>{
 expect(sameCalendarTarget(row(),{date:'2026-10-13',time:'10:00'})).toBe(true);
 const legacy=row();legacy.task.dueDate='';legacy.task.plannedDate='2026-10-12';legacy.task.time='';
 expect(sameCalendarTarget(legacy,{date:'2026-10-12',time:''})).toBe(true);expect(sameCalendarTarget(legacy,{date:'2026-10-12',time:'10:00'})).toBe(false);
});
