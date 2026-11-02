import { resolveScheduleSpan, displayScheduleSpan, spanIntersects, type Todo, type ScheduleSpan } from '@diary/contracts';
import { addDays } from './date.js';
import { deriveOccurrence, isSeries } from './recurrence.js';
import { config } from './config.js';

/** Period starts come from the rule, never from a rescheduled materialized occurrence. */
export function taskSpan(task: Todo, root?: Todo): ScheduleSpan | undefined {
  if(task.seriesId&&(!root||!isSeries(root)))return undefined;
  const occurrence = task.occurrenceDate;
  if (root && occurrence && occurrence > root.recurrenceAnchor!) {
    for (let date = addDays(occurrence, -1), n = 0; date >= root.recurrenceAnchor! && n < 36600; date = addDays(date, -1), n++) {
      const previous = deriveOccurrence(root, date);
      if (previous) return resolveScheduleSpan(task, config.timezone, `${date}T${previous.dueTime || previous.time || '23:59'}`);
    }
    return undefined;
  }
  return resolveScheduleSpan({ ...task, seriesId: undefined }, config.timezone);
}

/** Include the first future rule deadline when its preceding interval overlaps the range. */
export function projectSchedule<T extends { task: Todo }>(rows: T[], from: string, to: string): (T & { span?: ScheduleSpan })[] {
  const stored = new Map(rows.map(row => [row.task.id, row]));
  const roots = new Map(rows.filter(row => isSeries(row.task)).map(row => [row.task.id, row.task]));
  const result = new Map<string, T & { span?: ScheduleSpan }>();
  const include = (row: T, root?: Todo) => {
    const task = row.task, span = taskSpan(task, root);
    if (!task.occurrenceSuppressed && spanIntersects(task, displayScheduleSpan(task,span), from, to)) result.set(task.id, { ...row, span });
  };
  for (const row of rows) include(row, roots.get(row.task.seriesId || ''));
  for (const row of rows.filter(row => isSeries(row.task))) {
    const root = row.task;
    for (let date = from, n = 0; n < 73200; date = addDays(date, 1), n++) {
      const generated = deriveOccurrence(root, date);
      if (generated && date !== root.recurrenceAnchor && !stored.has(generated.id)) include({ ...row, task: generated }, root);
      if (date >= to && (generated || date < root.recurrenceAnchor!)) break;
      // Stopped/expired series need no speculative search beyond their known rule end.
      if (date > to && (root.repeat?.until && date > root.repeat.until && !root.seriesChanges?.length || root.seriesChanges?.at(-1)?.stop && date >= root.seriesChanges.at(-1)!.from)) break;
      if (date > addDays(to, 36600)) break;
    }
  }
  return [...result.values()];
}
