import { z } from 'zod';
import { recordRefSchema, resolveRecord, todoSchema, type RecordRef, type Todo } from '@diary/contracts';
import { listDiaryDates, loadDiary, readJson, saveDiaryUnlocked, withVaultLock, writeJson } from './vault.js';
import { assertDate } from './date.js';
import { vaultPaths } from './config.js';

const id = z.string().uuid();
export const actionRequestSchema = z.object({
  mode: z.enum(['create', 'update', 'delete', 'complete', 'restore', 'purge', 'status']), date: z.string(), version: z.string(),
  task: todoSchema, operationId: id, sourceVersion: z.string().optional(),
  fact: z.object({ date: z.string(), version: z.string(), time: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$|^$/), note: z.string().trim().min(1).max(10000), remark: z.string().max(10000) }).optional(),
  nextStatus: z.enum(['todo', 'doing', 'done', 'cancelled']).optional(),
});
type ActionInput = z.infer<typeof actionRequestSchema>;
const conflict = (message: string) => Object.assign(new Error(message), { statusCode: 409 });

/** 可被 update 模式覆盖的字段白名单 */
const updatableFields: (keyof Todo)[] = [
  'title', 'time', 'plannedDate', 'description', 'subtasks', 'priority',
  'dueDate', 'dueTime', 'list', 'tags', 'repeat', 'attachments',
];

export async function listActions() {
  const diaries = await Promise.all((await listDiaryDates()).map(loadDiary));
  const documents = new Map(diaries.map(d => [d.document.date, d.document]));
  const exists = (ref: RecordRef | undefined) => ref ? !!documents.get(ref.date) && resolveRecord(documents.get(ref.date)!, ref) !== undefined : false;
  const tasks = diaries.flatMap(d => d.document.todos.map(task => {
    const owner = diaries.find(other => other.document.facts.events.some(e => e.task?.date === d.document.date && e.task.id === task.id));
    const event = owner?.document.facts.events.find(e => e.task?.date === d.document.date && e.task.id === task.id);
    return { date: d.document.date, version: d.version, task, sourceExists: exists(task.source), completionExists: exists(task.completion), pendingFact: !task.completion && event && owner ? { date: owner.document.date, id: event.id, time: event.time, note: event.note, remark: event.remark } : undefined };
  }));
  const records = diaries.flatMap(d => [
    ...d.document.facts.events.map(e => ({ date: d.document.date, kind: 'facts' as const, id: e.id, summary: e.note.slice(0, 2000) })),
    ...(['learn', 'input', 'idea'] as const).flatMap(kind => (d.document.entries?.[kind] || []).map(e => ({ date: d.document.date, kind, id: e.id, summary: e.content.slice(0, 2000) }))),
  ]);
  return { tasks, records };
}
export async function changeAction(input: ActionInput) {
  return withVaultLock(async () => {
    assertDate(input.date);
    if (input.task.plannedDate) assertDate(input.task.plannedDate);
    if (input.task.dueDate) assertDate(input.task.dueDate);
    const current = await loadDiary(input.date);
    const tasks = current.document.todos;
    const existing = tasks.find(t => t.id === input.task.id);
    if (input.mode === 'create' && existing) return { diary: current };
    if (input.mode === 'complete' && existing?.done && existing.operationId === input.operationId) return { diary: current };
    if (input.version !== current.version) throw conflict('待办所在日记已修改，请重新加载后重试；输入仍保留。');
    if (input.mode !== 'create' && !existing) throw conflict('待办已被删除，不能继续修改。');
    if (input.mode === 'create') {
      if (input.task.source) {
        assertDate(input.task.source.date);
        const source = input.task.source.date === input.date ? current : await loadDiary(input.task.source.date);
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
      current.document.todos = tasks.filter(t => t.id !== existing!.id);
    } else if (input.mode === 'update') {
      const patch: Partial<Todo> = {};
      for (const field of updatableFields) {
        if (input.task[field] !== undefined) patch[field] = input.task[field] as never;
      }
      Object.assign(existing!, patch);
    } else if (input.mode === 'status') {
      const next = input.nextStatus || 'todo';
      existing!.status = next;
      existing!.done = next === 'done';
      if (next === 'done' && !existing!.completedAt) existing!.completedAt = new Date().toISOString();
      if (next !== 'done') { existing!.completedAt = undefined; existing!.completion = undefined; }
    } else if (input.mode === 'restore') {
      existing!.deletedAt = undefined;
      existing!.done = false;
      existing!.status = 'todo';
      existing!.completedAt = undefined;
    } else {
      if (!existing!.completion) {
        const pending = (await listActions()).tasks.find(row => row.date === input.date && row.task.id === existing!.id)?.pendingFact;
        if (pending && (!input.fact || pending.id !== input.operationId || pending.date !== input.fact.date)) throw conflict('已有写入中的完成事实，请使用恢复未完成保存，不要重新生成。');
      }
      if (input.fact && existing!.completion) throw conflict('这项待办已有完成事实，请查看原事实；可选择仅完成，不会重复生成。');
      if (input.fact) {
        assertDate(input.fact.date);
        const target = input.fact.date === input.date ? current : await loadDiary(input.fact.date);
        const factId = input.operationId;
        const prior = target.document.facts.events.find(e => e.id === factId);
        const reference = { date: input.date, kind: 'todo' as const, id: existing!.id, summary: existing!.title };
        const journal = `${vaultPaths.system}/actions/${input.operationId}.json`;
        const recorded = await readJson<{ date: string; taskId: string; target: string } | null>(journal, null);
        if (recorded && (recorded.date !== input.date || recorded.taskId !== existing!.id || recorded.target !== input.fact.date)) throw conflict('这次提交已有未完成的保存，请保持原目标日期重试。');
        if (!prior) {
          if (target.version !== input.fact.version) throw conflict('目标日期的日记已变化，请刷新版本后重试。');
          await writeJson(journal, { date: input.date, taskId: existing!.id, target: input.fact.date, phase: 'prepared' });
          target.document.facts.events.push({ id: factId, time: input.fact.time, note: input.fact.note, remark: input.fact.remark, people: [], places: [], activities: [], foods: [], attachments: [], task: reference });
          if (input.fact.date !== input.date) await saveDiaryUnlocked(input.fact.date, target.document, target.version);
        } else if (prior.task?.id !== existing!.id || prior.task?.date !== input.date) throw conflict('操作编号已被其他记录使用。');
        existing!.completion = { date: input.fact.date, kind: 'facts', id: factId, summary: (prior?.note || input.fact.note).slice(0, 2000) };
      }
      Object.assign(existing!, { done: true, status: 'done', completedAt: new Date().toISOString(), operationId: input.operationId });
    }
    try {
      const diary = await saveDiaryUnlocked(input.date, current.document, current.version);
      if (input.mode === 'complete' && input.fact) await writeJson(`${vaultPaths.system}/actions/${input.operationId}.json`, { date: input.date, taskId: input.task.id, target: input.fact.date, phase: 'complete' });
      return { diary };
    } catch (error) {
      if (input.mode === 'complete' && input.fact && input.fact.date !== input.date) throw conflict('事实可能已写入，但待办尚未更新。请刷新版本并重试本次提交，不要重新创建；系统会检查编号避免重复。');
      throw error;
    }
  });
}
