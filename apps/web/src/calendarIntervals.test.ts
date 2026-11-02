import {it,expect} from 'vitest';
import {todoSchema,resolveScheduleSpan} from '@diary/contracts';
import type {ActionRow} from './api';
import {groupCalendarDays,intervalMarkers,intervalHours,endpointMarkers,intervalPreviewMarker,rowSpan} from './calendarIntervals';
import {previewCalendarRows,calendarRowKey,updateCalendarPreviews,calendarTimeConflict} from './calendarPreview';
const row=(id:string,patch:object={}):ActionRow=>{const task=todoSchema.parse({id,title:'长标题测试',createdAt:'2026-10-31T15:00:00Z',dueDate:'2026-11-02',dueTime:'20:00',...patch});return{date:'2026-10-31',version:'v1',task,span:resolveScheduleSpan(task),sourceExists:false,completionExists:false};};
it('counts a cross-month task once per day, keeps empty dates and does not count segments globally',()=>{
 const source=[row('a')],days=['2026-10-31','2026-11-01','2026-11-02','2026-11-03'],groups=groupCalendarDays(source,days);
 expect(days.map(d=>groups.get(d)!.length)).toEqual([1,1,1,0]);expect(source).toHaveLength(1);expect(intervalHours(source)).not.toContain('00:00');expect(intervalHours(source,calendarRowKey(source[0]))).toContain('00:00');
});
it('packs overlapping lifecycles without moving their accurate start and end anchors',()=>{
 const rows=[row('a'),row('b')],markers=intervalMarkers(rows,'2026-11-01',[0,18,20,23]);
 expect([...markers.values()].map(m=>m.lane)).toEqual([0,1]);expect([...markers.values()].map(m=>m.anchor)).toEqual([0,0]);expect([...markers.values()][0].end).toBe('23:59');
});
it('previews deadline-only changes immediately and cancellation leaves original counts and timestamps intact',()=>{
 const original=row('a'),preview=previewCalendarRows([original],[{row:original,target:{date:'2026-11-04',time:'18:15'}}])[0];
 expect(preview.span?.start).toBe(original.span?.start);expect(preview.span?.end).toBe('2026-11-04T18:15');expect(groupCalendarDays([preview],['2026-11-03']).get('2026-11-03')).toHaveLength(1);
 expect(groupCalendarDays(previewCalendarRows([original],[]),['2026-11-03']).get('2026-11-03')).toHaveLength(0);expect(original.task.dueDate).toBe('2026-11-02');
});

it('shows only start and deadline by default and expands just the selected task across intermediate dates',()=>{
 const a=row('a'),b=row('b');expect([...endpointMarkers([a,b],'2026-10-31',[0,20,23]).values()].map(m=>m.edge)).toEqual(['start','start']);expect(endpointMarkers([a,b],'2026-11-01',[0,20,23]).size).toBe(0);expect([...endpointMarkers([a,b],'2026-11-02',[0,20,23]).values()].map(m=>m.edge)).toEqual(['end','end']);
 const selected=endpointMarkers([a,b],'2026-11-01',[0,20,23],calendarRowKey(a));expect(selected.size).toBe(1);expect([...selected.values()][0]).toMatchObject({edge:'span',row:a});
});
it('combines both handles in one pending write, preserves creation and restores both on cancel',()=>{
 const original=row('a',{startDate:'2026-11-01',startTime:'09:00'});let previews=updateCalendarPreviews([],original,{date:'2026-11-01',time:'10:15',edge:'start'});const current=previewCalendarRows([original],previews)[0];previews=updateCalendarPreviews(previews,current,{date:'2026-11-03',time:'18:30'});expect(previews).toHaveLength(1);const projected=previewCalendarRows([original],previews)[0];expect(projected.task).toMatchObject({startDate:'2026-11-01',startTime:'10:15',dueDate:'2026-11-03',dueTime:'18:30',createdAt:original.task.createdAt});expect(rowSpan(projected)?.startKind).toBe('planned');expect(previewCalendarRows([original],[])[0]).toEqual(original);
 const invalid=updateCalendarPreviews(previews,projected,{date:'2026-11-04',time:'10:00',edge:'start'});expect(invalid).toEqual(previews);
});

it('does not overwrite a remotely changed endpoint while allowing another task to advance the diary version',()=>{const a=row('a');expect(calendarTimeConflict(a,{...a,version:'v2'})).toBe(false);expect(calendarTimeConflict(a,{...a,task:{...a.task,dueTime:'21:00'}})).toBe(true);expect(calendarTimeConflict(a,{...a,task:{...a.task,startDate:'2026-11-01',startTime:'09:00'}})).toBe(true);});

it('temporarily highlights the interval while preserving the endpoint nodes, lanes and time anchors',()=>{
 const a=row('a'),b=row('b'),hours=[0,18,20,23],start=endpointMarkers([a,b],'2026-10-31',hours),before=[...start.values()];
 const preview=intervalPreviewMarker(a,'2026-10-31',hours,start);expect(preview).toMatchObject({anchor:before[0].anchor,lane:before[0].lane,before:false,after:true});expect([...start.values()]).toEqual(before);
 const middle=intervalPreviewMarker(a,'2026-11-01',hours,endpointMarkers([a,b],'2026-11-01',hours));expect(middle).toMatchObject({start:'00:00',end:'23:59',before:true,after:true,width:hours.length*160});
 const finish=intervalPreviewMarker(a,'2026-11-02',hours,endpointMarkers([a,b],'2026-11-02',hours),'end');expect(finish).toMatchObject({before:true,after:false,end:'20:00'});expect(intervalPreviewMarker(a,'2026-11-03',hours,new Map())).toBeUndefined();
});

it('highlights across hidden midnight boundaries without adding hours or collapsing to a point',()=>{const a=row('a',{startDate:'2026-11-01',startTime:'18:15'}),hours=[15,18,20];const start=intervalPreviewMarker(a,'2026-11-01',hours,endpointMarkers([a],'2026-11-01',hours));expect(start?.anchor).toBe(200);expect(start?.width).toBe(280);expect(hours).toEqual([15,18,20]);});
