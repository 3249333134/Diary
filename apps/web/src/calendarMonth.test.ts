import { describe,expect,it } from 'vitest';
import type { ActionRow } from './api';
import { monthAgendaGroups,monthDaySummary,monthGridDates,selectedMonthDate } from './calendarMonth';
import { previewCalendarRows } from './calendarPreview';

const row=(id:string,time='',extra:Partial<ActionRow>={}):ActionRow=>({date:'2026-10-25',version:'v1',task:{id,title:id,dueDate:'2026-10-25',dueTime:time,important:true,urgent:false},...extra} as ActionRow);
describe('month overview',()=>{
  it('renders four, five or six full Monday-first weeks, including leap days and years',()=>{
    for(const [anchor,length,first,last] of [['2021-02-15',28,'2021-02-01','2021-02-28'],['2026-10-25',35,'2026-09-28','2026-11-01'],['2026-03-15',42,'2026-02-23','2026-04-05'],['2028-02-29',35,'2028-01-31','2028-03-05'],['2027-01-01',35,'2026-12-28','2027-01-31']] as const){
      const dates=monthGridDates(anchor);expect(dates).toHaveLength(length);expect(dates[0]).toBe(first);expect(dates.at(-1)).toBe(last);
    }
  });
  it('selects today or day one, remembers adjacent visible dates and rejects stale memory',()=>{
    expect(selectedMonthDate('2026-10-01','2026-10-25')).toBe('2026-10-25');
    expect(selectedMonthDate('2026-11-01','2026-10-25')).toBe('2026-11-01');
    expect(selectedMonthDate('2026-10-01','2026-10-25','2026-11-01')).toBe('2026-11-01');
    expect(selectedMonthDate('2026-10-01','2026-10-25','2026-11-08')).toBe('2026-10-25');
  });
  it('puts all-day first and groups exact deadlines without reordering ties or mutating input',()=>{
    const input=[row('late','20:00'),row('first-tie','09:15'),row('all'),row('second-tie','09:15')];
    expect(monthAgendaGroups(input).map(g=>[g.time,g.rows.map(r=>r.task.id)])).toEqual([['',['all']],['09:15',['first-tie','second-tie']],['20:00',['late']]]);
    expect(input[0].task.id).toBe('late');
  });
  it('counts the filtered preview projection and shared identity without changing source rows',()=>{
    const shared=row('shared','09:15',{windowId:'window'}),privateRow=row('private');
    const projected=previewCalendarRows([shared,privateRow],[{row:shared,target:{date:'2026-10-26',time:'09:15'}}]);
    const summary=monthDaySummary(projected.filter(r=>r.task.dueDate==='2026-10-26'));
    expect(summary.count).toBe(1);expect(summary.shared).toBe(1);expect(summary.tones.map(t=>t.id)).toEqual(['q2']);
    expect(shared.task.dueDate).toBe('2026-10-25');expect(monthDaySummary([])).toEqual({count:0,shared:0,tones:[]});
  });
});
