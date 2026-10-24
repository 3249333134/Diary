import { describe, it, expect } from 'vitest';
import { todoSchema } from '@diary/contracts';
import { matchesPlan, planClock, planState } from './planFilters';
describe('计划日期与统计', () => {
  const now = { date: '2026-10-01', time: '10:30' };
  const task = (fields: object) => todoSchema.parse({ id: 'test', title: '计划', ...fields });
  it('uses Shanghai date across a month boundary', () => {
    expect(planClock(new Date('2026-09-30T16:05:00Z'))).toEqual({ date: '2026-10-01', time: '00:05' });
  });
  it('refreshes the cached clock at minute and day boundaries, including backwards time',()=>{
    expect(planClock(new Date('2026-10-01T15:59:59Z'))).toEqual({date:'2026-10-01',time:'23:59'});
    expect(planClock(new Date('2026-10-01T16:00:00Z'))).toEqual({date:'2026-10-02',time:'00:00'});
    expect(planClock(new Date('2026-10-01T15:59:00Z'))).toEqual({date:'2026-10-01',time:'23:59'});
  });
  it('counts timed today in both today and overdue, prefers dueDate', () => {
    const t = task({ dueDate: now.date, dueTime: '09:00', plannedDate: '2026-10-03' });
    expect(matchesPlan(t, 'today', now)).toBe(true);
    expect(matchesPlan(t, 'overdue', now)).toBe(true);
    expect(matchesPlan(task({ plannedDate: now.date }), 'overdue', now)).toBe(false);
  });
  it('excludes cancelled and trash, retains undated in all', () => {
    expect(matchesPlan(task({ dueDate: now.date, status: 'cancelled' }), 'today', now)).toBe(false);
    expect(matchesPlan(task({ deletedAt: 'x', done: true }), 'done', now)).toBe(false);
    expect(matchesPlan(task({}), 'all', now)).toBe(true);
    expect(matchesPlan(task({}), 'today', now)).toBe(false);
    expect(matchesPlan(task({ plannedDate: '2026-10-02' }), 'upcoming', now)).toBe(true);
  });
  it('keeps undated deadlines through the end of day and marks today/tomorrow yellow', () => {
    expect(planState(task({dueDate:now.date,time:'08:00'}),now)).toBe('soon');
    expect(planState(task({dueDate:'2026-10-02'}),now)).toBe('soon');
    expect(planState(task({dueDate:'2026-09-30'}),now)).toBe('overdue');
    expect(planState(task({dueDate:'2026-09-30',done:true}),now)).toBe('done');
    expect(planState(task({dueDate:'2026-09-30',status:'cancelled'}),now)).toBe('neutral');
  });
});
