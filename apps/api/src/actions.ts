import { z } from 'zod';
import { appendCapture, captureDraftSchema, completionRecordSchema, recordRefSchema, resolveRecord, todoSchema, type RecordRef, type Todo } from '@diary/contracts';
import { listDiaryDates, loadDiary, readJson, saveDiaryUnlocked, withVaultLock, writeJson } from './vault.js';
import { assertDate } from './date.js';
import { deriveOccurrence, firstOccurrence } from './recurrence.js';
import { vaultPaths } from './config.js';
import { autoJournalPath, completeAutomatically } from './autoCompletion.js';
import { readRestoreJournal, restoreCompletion } from './restoreCompletion.js';

const id = z.string().uuid();
export const actionRequestSchema = z.object({
  mode: z.enum(['create', 'update', 'delete', 'complete', 'restore', 'purge', 'status']), date: z.string(), version: z.string(),
  task: todoSchema, operationId: id, sourceVersion: z.string().optional(), completionRecord: completionRecordSchema.optional(),
  fact: z.object({ date: z.string(), version: z.string(), time: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$|^$/), note: z.string().trim().min(1).max(10000), remark: z.string().max(10000) }).optional(),
  nextStatus: z.enum(['todo', 'doing', 'done', 'cancelled']).optional(),
  automaticRecord: z.boolean().optional(),
});
type ActionInput = z.infer<typeof actionRequestSchema>;
const conflict = (message: string) => Object.assign(new Error(message), { statusCode: 409 });

/** 可被 update 模式覆盖的字段白名单 */
const updatableFields: (keyof Todo)[] = [
  'title', 'time', 'plannedDate', 'description', 'subtasks', 'priority',
  'dueDate', 'dueTime', 'list', 'tags', 'repeat', 'attachments', 'entities',
  'category', 'important', 'urgent', 'startDate', 'startTime',
];

export async function listActions(userId: number) {
  const diaries = await Promise.all((await listDiaryDates(userId)).map(d => loadDiary(d, userId)));
  const documents = new Map(diaries.map(d => [d.document.date, d.document]));
  const exists = (ref: RecordRef | undefined) => ref ? !!documents.get(ref.date) && resolveRecord(documents.get(ref.date)!, ref) !== undefined : false;
  const completionEntries = diaries.flatMap(d => [
    ...d.document.facts.events.map(e => ({ date: d.document.date, kind: 'facts' as const, id: e.id, time: e.time, content: e.note, description: e.remark, entities: { people: e.people, places: e.places, activities: e.activities, foods: e.foods }, task: e.task })),
    ...(['learn', 'input', 'idea'] as const).flatMap(kind => (d.document.entries?.[kind] || []).map(e => ({ date: d.document.date, kind, id: e.id, time: e.time, content: e.content, task: e.task, tags: e.tags }))),
  ]);
  const tasks = await Promise.all(diaries.flatMap(d => d.document.todos.map(async task => {
    const journal = await readJson<{ phase: string } | null>(autoJournalPath(d.document.date, task.id), null, userId);
    const restorePending = (await readRestoreJournal(d.document.date,task.id,userId))?.phase === 'prepared';
    const owner = diaries.find(other => other.document.facts.events.some(e => e.task?.date === d.document.date && e.task.id === task.id));
    const event = owner?.document.facts.events.find(e => e.task?.date === d.document.date && e.task.id === task.id);
    const unfinished = completionEntries.find(e => e.task?.date === d.document.date && e.task.id === task.id);
    const pending = unfinished && 'description' in unfinished ? { ...unfinished, description: unfinished.description.slice(0, 10000) } : unfinished;
    return { restorePending, completionPending: journal?.phase === 'prepared' && !task.completion, pendingRecord: !task.completion && pending ? captureDraftSchema.parse(pending) : undefined, date: d.document.date, version: d.version, task, sourceExists: exists(task.source), completionExists: exists(task.completion), pendingFact: !task.completion && event && owner ? { date: owner.document.date, id: event.id, time: event.time, note: event.note, remark: event.remark } : undefined };
  })));
  const records = diaries.flatMap(d => [
    ...d.document.facts.events.map(e => ({ date: d.document.date, kind: 'facts' as const, id: e.id, summary: e.note.slice(0, 2000) })),
    ...(['learn', 'input', 'idea'] as const).flatMap(kind => (d.document.entries?.[kind] || []).map(e => ({ date: d.document.date, kind, id: e.id, summary: e.content.slice(0, 2000) }))),
  ]);
  return { tasks, records };
}

export async function changeAction(input: ActionInput, userId: number) {
  return withVaultLock(userId, async () => {
    assertDate(input.date);
    const completion = input.completionRecord || (input.fact ? completionRecordSchema.parse({ id: input.operationId, kind: 'facts', date: input.fact.date, version: input.fact.version, time: input.fact.time, content: input.fact.note, description: input.fact.remark }) : undefined);
    if (input.task.plannedDate) assertDate(input.task.plannedDate);
    if (input.task.dueDate) assertDate(input.task.dueDate);
    if (input.task.startDate) assertDate(input.task.startDate);
    const current = await loadDiary(input.date, userId);
    const tasks = current.document.todos;
    let existing = tasks.find(t => t.id === input.task.id);
    if (!existing && input.mode !== 'create' && input.task.seriesId && input.task.occurrenceDate) {
      if(input.version !== current.version) throw conflict('日程已变化，请刷新后重试。');
      const root=tasks.find(t=>t.id===input.task.seriesId);
      const occurrence=root && deriveOccurrence(root,input.task.occurrenceDate);
      if(!occurrence || occurrence.id!==input.task.id) throw conflict('这期日程已变更或停止，请刷新。');
      existing=occurrence; tasks.push(existing);
    }
    const restoring = input.mode === 'restore' || (input.mode === 'status' && (input.nextStatus === 'todo' || input.nextStatus === 'doing'));
    const restoreJournal = existing ? await readRestoreJournal(input.date,existing.id,userId) : null;
    if (restoring && restoreJournal?.phase === 'complete' && restoreJournal.operationId === input.operationId) return { diary: current };
    if (restoreJournal?.phase === 'prepared' && !restoring) throw conflict('恢复计划尚未完成，请先刷新并重试恢复。');
    if (input.mode === 'create' && existing) return { diary: current };
    if (input.mode === 'complete' && existing?.done && existing.operationId === input.operationId) return { diary: current };
    if (existing?.done && existing.completion && (input.automaticRecord || (input.mode === 'status' && input.nextStatus === 'done'))) return { diary: current };
    if (input.version !== current.version) throw conflict('待办所在日记已修改，请重新加载后重试；输入仍保留。');
    if (input.mode !== 'create' && !existing) throw conflict('待办已被删除，不能继续修改。');
    if (existing && restoring && (existing.completion?.kind === 'facts' || restoreJournal?.phase === 'prepared')) {
      return restoreCompletion(current,existing,input.operationId,userId,input.mode === 'status' && input.nextStatus === 'doing' ? 'doing' : 'todo');
    }
    if (existing && ((input.mode === 'complete' && input.automaticRecord) || (input.mode === 'status' && input.nextStatus === 'done'))) {
      if (existing.deletedAt || existing.status === 'cancelled') throw conflict('请先恢复此计划，再完成。');
      return completeAutomatically(current, existing, userId);
    }
    if (input.mode === 'create') {
      if (input.task.repeat && ['daily','weekly','monthly'].includes(input.task.repeat.type)) {
        if(!input.task.dueDate) throw Object.assign(new Error('重复计划需要截止日期'),{statusCode:400});
        input.task.recurrenceAnchor=input.task.dueDate;
        if(input.task.repeat.until)assertDate(input.task.repeat.until);
        const first=firstOccurrence(input.task.dueDate,input.task.repeat);
        input.task.dueDate=first;input.task.recurrenceAnchor=first;
        input.task.seriesTemplate=todoSchema.parse(input.task);
      }
      if (input.task.source) {
        assertDate(input.task.source.date);
        const source = input.task.source.date === input.date ? current : await loadDiary(input.task.source.date, userId);
        if (source.version !== input.sourceVersion || resolveRecord(source.document, input.task.source) === undefined) throw conflict('来源记录已变化，请先保存并重新选择来源。');
      }
      tasks.push({
        ...input.task,
        done: false,
        status: input.task.status || 'todo',
        completion: undefined,
        completedAt: undefined,
        operationId: undefined,
        createdAt: input.task.createdAt || new Date().toISOString(),
        deletedAt: undefined,
      });
    } else if (input.mode === 'delete') {
      existing!.deletedAt = new Date().toISOString();
    } else if (input.mode === 'purge') {
      // Keep an occurrence tombstone so purging it cannot regenerate the same scheduled item.
      if(existing!.seriesId){existing!.status='cancelled';existing!.deletedAt=new Date().toISOString();existing!.occurrenceSuppressed=true;}
      else current.document.todos = tasks.filter(t => t.id !== existing!.id && t.seriesId!==existing!.id);
    } else if (input.mode === 'update') {
      const patch: Partial<Todo> = {};
      for (const field of updatableFields) {
        if (input.task[field] !== undefined) patch[field] = input.task[field] as never;
      }
      Object.assign(existing!, patch);
      if(!existing!.seriesId && !existing!.recurrenceAnchor && ['daily','weekly','monthly'].includes(existing!.repeat?.type||'')) {
        if(!existing!.dueDate)throw Object.assign(new Error('重复计划需要截止日期'),{statusCode:400});
        if(existing!.repeat?.until)assertDate(existing!.repeat.until);
        existing!.dueDate=firstOccurrence(existing!.dueDate,existing!.repeat!);
        existing!.recurrenceAnchor=existing!.dueDate;
        existing!.seriesTemplate=todoSchema.parse(existing!);
      }
    } else if (input.mode === 'status') {
      const next = input.nextStatus || 'todo';
      existing!.status = next;
      existing!.done = next === 'done';
      if (next === 'done' && !existing!.completedAt) existing!.completedAt = new Date().toISOString();
      if (next !== 'done') { existing!.completedAt = undefined; }
    } else if (input.mode === 'restore') {
      existing!.deletedAt = undefined;
      existing!.done = false;
      existing!.status = 'todo';
      existing!.completedAt = undefined;
    } else {
      const pending = (await listActions(userId)).tasks.find(r => r.date === input.date && r.task.id === existing!.id)?.pendingRecord;
      if (pending && (!completion || pending.id !== input.operationId || pending.date !== completion.date || pending.kind !== completion.kind)) throw conflict('已有写入中的完成记录，请恢复上次保存。');
      if (completion && existing!.completion) throw conflict('已有完成记录，请查看原日记；可选择仅完成。');
      if (completion) {
        assertDate(completion.date);
        const target = completion.date === input.date ? current : await loadDiary(completion.date, userId);
        const entries = [...target.document.facts.events, ...(target.document.entries?.learn || []), ...(target.document.entries?.input || []), ...(target.document.entries?.idea || [])];
        const prior = entries.find(e => e.id === input.operationId);
        const reference = { date: input.date, kind: 'todo' as const, id: existing!.id, summary: existing!.title };
        const journal = `${vaultPaths.system}/actions/${input.operationId}.json`;
        const recorded = await readJson<{ date: string; taskId: string; target: string; kind?: string } | null>(journal, null, userId);
        if (recorded && (recorded.date !== input.date || recorded.taskId !== existing!.id || recorded.target !== completion.date || (recorded.kind || 'facts') !== completion.kind)) throw conflict('请保持上次提交的日期及栏目，恢复未完成保存。');
        if (!prior) {
          if (target.version !== completion.version) throw conflict('目标日期日记已变化，请刷新版本后重试。');
          await writeJson(journal, { date: input.date, taskId: existing!.id, target: completion.date, kind: completion.kind, phase: 'prepared' }, userId);
          target.document = appendCapture(target.document, { ...completion, id: input.operationId }, reference);
          if (completion.date !== input.date) await saveDiaryUnlocked(completion.date, target.document, target.version, userId);
        } else if (prior.task?.id !== existing!.id || prior.task.date !== input.date || resolveRecord(target.document, { date: completion.date, kind: completion.kind, id: input.operationId, summary: '' }) === undefined) throw conflict('操作编号已被其他记录使用。');
        existing!.completion = { date: completion.date, kind: completion.kind, id: input.operationId, summary: completion.content.slice(0, 2000) };
      }
      Object.assign(existing!, { done: true, status: 'done', completedAt: new Date().toISOString(), operationId: input.operationId });
    }
    try {
      const diary = await saveDiaryUnlocked(input.date, current.document, current.version, userId);
      if (input.mode === 'complete' && completion) await writeJson(`${vaultPaths.system}/actions/${input.operationId}.json`, { date: input.date, taskId: input.task.id, target: completion!.date, kind: completion!.kind, phase: 'complete' }, userId);
      return { diary };
    } catch (error) {
      if (input.mode === 'complete' && completion && completion!.date !== input.date) throw conflict('事实可能已写入，但待办尚未更新。请刷新版本并重试本次提交，不要重新创建；系统会检查编号避免重复。');
      throw error;
    }
  });
}
