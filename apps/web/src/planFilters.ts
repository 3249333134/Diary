import type { Todo } from '@diary/contracts';
export type PlanFilter = 'today' | 'upcoming' | 'all' | 'done' | 'overdue' | 'trash';
export const planDueTime=(task:Todo)=>task.dueDate?task.dueTime:task.time;
export function planState(task: Todo, now = planClock()) {
  if (task.deletedAt || task.status === 'cancelled') return 'neutral';
  if (task.done || task.status === 'done') return 'done';
  if (matchesPlan(task, 'overdue', now)) return 'overdue';
  const due = task.dueDate || task.plannedDate || '';
  const tomorrow = new Date(`${now.date}T00:00:00Z`); tomorrow.setUTCDate(tomorrow.getUTCDate()+1);
  return due && (due === now.date || due === tomorrow.toISOString().slice(0,10)) ? 'soon' : 'neutral';
}
const clockFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
let cachedMinute:number|undefined,cachedClock:{date:string;time:string}|undefined;
export function planClock(now = new Date()) {
  const minute=Math.floor(now.getTime()/60000);
  if(cachedClock&&minute===cachedMinute)return cachedClock;
  const parts = clockFormatter.formatToParts(now);
  const get = (key: string) => parts.find(p => p.type === key)!.value;
  cachedMinute=minute;
  return cachedClock={ date: `${get('year')}-${get('month')}-${get('day')}`, time: `${get('hour')}:${get('minute')}` };
}
export function matchesPlan(task: Todo, filter: PlanFilter, now = planClock()) {
  if(task.occurrenceSuppressed)return false;
  if (filter === 'trash') return !!task.deletedAt;
  if (task.deletedAt) return false;
  if (filter === 'all') return true;
  if (filter === 'done') return task.done || task.status === 'done';
  if (task.done || task.status === 'done' || task.status === 'cancelled') return false;
  const date = task.dueDate || task.plannedDate || '';
  const time = task.dueDate ? task.dueTime : task.time;
  if (filter === 'today') return date === now.date;
  if (filter === 'upcoming') return date > now.date;
  return !!date && (date < now.date || (date === now.date && !!time && time < now.time));
}
