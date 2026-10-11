import { randomUUID } from 'node:crypto';
import { diaryEventSchema, type DiaryResponse, type Todo } from '@diary/contracts';
import { config, vaultPaths } from './config.js';
import { readJson, writeJson, loadDiary, saveDiaryUnlocked } from './vault.js';
import { todayInTimezone } from './date.js';

type Journal = { phase: 'prepared' | 'complete'; completedAt: string; event: ReturnType<typeof diaryEventSchema.parse>; target: string };
export const autoJournalPath = (date: string, id: string) => `${vaultPaths.system}/actions/auto-${date}-${id}.json`;

/** Called under the vault writer lock. The prepared snapshot survives response loss and midnight. */
export async function completeAutomatically(current: DiaryResponse, task: Todo, now = new Date()) {
  if (task.done && task.completion) return { diary: current };
  const journalPath = autoJournalPath(current.document.date, task.id);
  let journal = await readJson<Journal | null>(journalPath, null);
  if (task.completion) {
    Object.assign(task, { done: true, status: 'done', completedAt: journal?.completedAt || task.completedAt || now.toISOString() });
    return { diary: await saveDiaryUnlocked(current.document.date, current.document, current.version) };
  }
  if (!journal) {
    const target = todayInTimezone(config.timezone, now);
    const time = new Intl.DateTimeFormat('en-GB', { timeZone: config.timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(now);
    const entities = (type: string) => (task.entities || []).filter(entity => entity.type === type);
    // Legacy plan times were also used as due times: do not infer a missing start.
    const plannedStart = { date: task.startDate || '', time: task.startTime || '' };
    journal = { phase: 'prepared', target, completedAt: now.toISOString(), event: diaryEventSchema.parse({
      id: randomUUID(), time, note: `完成计划：${task.title}`,
      remark: [task.description && `原计划说明：${task.description}`, `原定开始：${plannedStart.date ? `${plannedStart.date} ${plannedStart.time || '未设置时间'}` : '未设置'}`].filter(Boolean).join('\n'),
      plannedStart, planEntities: task.entities, tags: task.tags, people: entities('person'), places: entities('place'), activities: entities('activity'), foods: entities('food'),
      task: { date: current.document.date, kind: 'todo', id: task.id, summary: task.title },
    }) };
    await writeJson(journalPath, journal);
  }
  try {
  const target = journal.target === current.document.date ? current : await loadDiary(journal.target);
  const existing = target.document.facts.events.find(event => event.id === journal!.event.id);
  if (existing && existing.task?.id !== task.id) throw new Error('完成记录编号冲突');
  if (!existing) {
    target.document.facts.events.push(journal.event);
    if (journal.target !== current.document.date) await saveDiaryUnlocked(journal.target, target.document, target.version);
  }
  Object.assign(task, { done: true, status: 'done', completedAt: journal.completedAt,
    completion: { date: journal.target, kind: 'facts', id: journal.event.id, summary: journal.event.note }, operationId: journal.event.id });
    const diary = await saveDiaryUnlocked(current.document.date, current.document, current.version);
    await writeJson(journalPath, { ...journal, phase: 'complete' });
    return { diary };
  } catch {
    throw Object.assign(new Error('完成记录待恢复，请刷新后重试；将保留首次完成时间，不重复生成日记。'), { statusCode: 409 });
  }
}
