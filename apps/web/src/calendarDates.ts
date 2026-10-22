export type CalendarView = 'fortnight' | 'week' | 'month';

export function shiftDate(date: string, days: number) {
  const value = new Date(date + 'T00:00:00Z');
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

export function calendarRange(anchor: string, view: CalendarView) {
  const first = view === 'month' ? `${anchor.slice(0, 7)}-01` : anchor;
  const weekday = (new Date(first + 'T00:00:00Z').getUTCDay() + 6) % 7;
  const from = shiftDate(first, -weekday);
  return { from, to: shiftDate(from, view === 'month' ? 41 : view === 'fortnight' ? 13 : 6) };
}

export function calendarWeeks(anchor: string, view: 'fortnight' | 'week') {
  const { from } = calendarRange(anchor, view);
  return Array.from({ length: view === 'fortnight' ? 2 : 1 }, (_, week) =>
    Array.from({ length: 7 }, (_, day) => shiftDate(from, week * 7 + day)));
}
