import { it, expect } from 'vitest';
import { todoSchema } from '@diary/contracts';
import { deriveOccurrence, occursOn, occurrenceId, firstOccurrence } from './recurrence.js';
import { serializeDiaryMarkdown, parseDiaryMarkdown } from './markdown.js';
import { emptyDiary } from '@diary/contracts';
const root=(rule:NonNullable<ReturnType<typeof todoSchema.parse>['repeat']>,date='2026-01-31')=>todoSchema.parse({id:'monthly-example',title:'账单',dueDate:date,dueTime:'18:00',startDate:date,startTime:'17:00',recurrenceAnchor:date,repeat:rule});
it('aligns the first date to the rule and rejects an ending before it',()=>{
 expect(firstOccurrence('2026-10-12',{type:'weekly',weekdays:[3],interval:2})).toBe('2026-10-14');
 expect(firstOccurrence('2026-02-01',{type:'monthly',monthDay:31})).toBe('2026-02-28');
 expect(()=>firstOccurrence('2026-10-12',{type:'weekly',weekdays:[3],until:'2026-10-13'})).toThrow();
});
it('clamps monthly dates without drifting, including leap years and ending dates',()=>{
 const task=root({type:'monthly',monthDay:31,until:'2026-03-31'});
 expect(occursOn(task,'2026-02-28')).toBe(true);expect(occursOn(task,'2026-03-31')).toBe(true);expect(occursOn(task,'2026-03-28')).toBe(false);expect(occursOn(task,'2026-04-30')).toBe(false);
 expect(occursOn(root({type:'monthly',monthDay:31},'2028-01-31'),'2028-02-29')).toBe(true);
});
it('uses weekly intervals, selected weekdays and daily intervals',()=>{
 const weekly=root({type:'weekly',interval:2,weekdays:[1,3]},'2026-10-12');
 expect(occursOn(weekly,'2026-10-14')).toBe(true);expect(occursOn(weekly,'2026-10-19')).toBe(false);expect(occursOn(weekly,'2026-10-26')).toBe(true);
 expect(occursOn(root({type:'daily',interval:2},'2026-10-12'),'2026-10-14')).toBe(true);
 expect(deriveOccurrence(root({type:'yearly'}),'2027-01-31')).toBeNull();
});
it('keeps stable identity and scheduled start while series snapshots survive Markdown',()=>{
 const task=root({type:'daily'},'2026-10-12');task.seriesTemplate=todoSchema.parse(task);task.dueDate='2026-10-20';task.dueTime='12:00';task.title='只改第一次';
 const occurrence=deriveOccurrence(task,'2026-10-13')!;
 expect(occurrence).toMatchObject({title:'账单',dueDate:'2026-10-13',dueTime:'18:00',startDate:'2026-10-13',startTime:'17:00',seriesId:task.id});
 expect(occurrence.id).toBe(occurrenceId(task.id,'2026-10-13'));expect(occurrence.id).not.toBe(occurrenceId(task.id,'2026-10-14'));
 const doc=emptyDiary('2026-10-12');doc.todos=[task,occurrence];const reloaded=parseDiaryMarkdown(serializeDiaryMarkdown(doc),doc.date);expect(reloaded.todos).toEqual(doc.todos.map(t=>todoSchema.parse(t)));
});
it('future rule changes preserve prior periods and a stop removes only future projections',()=>{
 const task=root({type:'daily'},'2026-10-12');task.seriesChanges=[{from:'2026-10-15',stop:false,template:{...task,title:'新标题',dueDate:'2026-10-15',startDate:'2026-10-14',repeat:{type:'weekly',weekdays:[4]}}}];
 expect(deriveOccurrence(task,'2026-10-14')?.title).toBe('账单');expect(deriveOccurrence(task,'2026-10-15')).toMatchObject({title:'新标题',startDate:'2026-10-14'});expect(deriveOccurrence(task,'2026-10-16')).toBeNull();
 task.seriesChanges.push({from:'2026-10-22',stop:true,template:task});expect(deriveOccurrence(task,'2026-10-22')).toBeNull();
});
