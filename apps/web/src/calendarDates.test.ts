import { describe, expect, it } from 'vitest';
import { calendarRange, calendarWeeks, shiftDate } from './calendarDates';

describe('two-week calendar ranges', () => {
  it('starts on Monday and includes both complete weeks, including a Sunday anchor', () => {
    for (const date of ['2026-10-19', '2026-10-21', '2026-10-25']) {
      expect(calendarRange(date, 'fortnight')).toEqual({ from: '2026-10-19', to: '2026-11-01' });
    }
  });
  it('crosses years and leap days without device timezone conversions', () => {
    expect(calendarRange('2026-12-31', 'fortnight')).toEqual({ from: '2026-12-28', to: '2027-01-10' });
    expect(calendarRange('2028-02-29', 'fortnight')).toEqual({ from: '2028-02-28', to: '2028-03-12' });
  });
  it('renders two contiguous weeks and navigates without overlap', () => {
    const weeks = calendarWeeks('2026-10-21', 'fortnight');
    expect(weeks.map(week => week.length)).toEqual([7, 7]);
    expect(weeks[1][0]).toBe(shiftDate(weeks[0][6], 1));
    const range = calendarRange('2026-10-21', 'fortnight');
    expect(calendarRange(shiftDate('2026-10-21', 14), 'fortnight').from).toBe(shiftDate(range.to, 1));
  });
  it('keeps the existing one-week and six-week month ranges', () => {
    expect(calendarRange('2026-10-21', 'week')).toEqual({ from: '2026-10-19', to: '2026-10-25' });
    expect(calendarRange('2026-10-21', 'month')).toEqual({ from: '2026-09-28', to: '2026-11-08' });
  });
});
