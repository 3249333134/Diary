import { beforeAll, afterAll, it, expect, vi } from 'vitest';
vi.mock('./db.js',async()=>{const {createDemoPool}=await import('./demoDatabase.js');const pool=createDemoPool(':memory:');return {pool,queryRows:async(sql:string,params:unknown[]=[])=> (await pool.query(sql,params))[0]};});
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { emptyDiary, todoSchema, captureDraftSchema, appendCapture } from '@diary/contracts';
import { parseDiaryMarkdown, serializeDiaryMarkdown } from './markdown.js';
let root = '';
const previous = process.env.OBSIDIAN_DIR;
beforeAll(async () => { root = await mkdtemp(join(tmpdir(), 'diary-capture-')); process.env.OBSIDIAN_DIR = root; vi.resetModules(); });
afterAll(async () => { if (previous === undefined) delete process.env.OBSIDIAN_DIR; else process.env.OBSIDIAN_DIR = previous; if (root.startsWith(join(tmpdir(), 'diary-capture-'))) await rm(root, { recursive: true, force: true }); });

it('round trips every plan field and text backlinks through Markdown', () => {
  const d = emptyDiary('2026-09-27');
  d.todos.push(todoSchema.parse({ id: randomUUID(), title: '整理资料', description: '实际说明', dueDate: '2026-10-01', dueTime: '15:00', priority: 'high', list: '工作', tags: ['资料'], status: 'cancelled', deletedAt: '2026-09-27', subtasks: [{ id: 'sub', title: '阅读', done: true }] }));
  const draft = captureDraftSchema.parse({ id: randomUUID(), kind: 'learn', date: d.date, content: '学到的方法' });
  const result = appendCapture(d, draft, { date: d.date, kind: 'todo', id: d.todos[0].id, summary: '整理资料' });
  appendCapture(result, draft);
  const parsed = parseDiaryMarkdown(serializeDiaryMarkdown(result), d.date);
  expect(parsed.todos).toEqual(d.todos);
  expect(parsed.entries?.learn).toHaveLength(1);
  expect(parsed.entries?.learn[0].task?.id).toBe(d.todos[0].id);
});

for (const [i, kind] of (['facts', 'learn', 'input', 'idea'] as const).entries()) {
  it(`completes into ${kind}, retries, restores and recovers cross-day interruption`, async () => {
    const { changeAction, listActions } = await import('./actions.js');
    const { loadDiary, saveDiary } = await import('./vault.js');
    const date = `2026-09-${10 + i}`;
    const targetDate = `2026-10-${10 + i}`;
    const task = todoSchema.parse({ id: randomUUID(), title: '原目标', dueDate: '2026-12-01', dueTime: '09:00' });
    const created = await changeAction({ mode: 'create', date, version: '0', task, operationId: randomUUID() }, 1);
    const operationId = randomUUID();
    const completionRecord = { ...captureDraftSchema.parse({ id: operationId, kind, date: targetDate, time: '16:42', content: '实际记录' }), kind, version: '0' };
    const input = { mode: 'complete' as const, date, version: created.diary.version, task, operationId, completionRecord };
    const completed = await changeAction(input, 1);
    await changeAction(input, 1);
    expect(completed.diary.document.todos[0].completion).toMatchObject({ kind, date: targetDate, id: operationId });
    const target = await loadDiary(targetDate, 1);
    const records = kind === 'facts' ? target.document.facts.events : target.document.entries![kind];
    expect(records).toHaveLength(1);
    expect(records[0].time).toBe('16:42');
    expect(records[0].task?.id).toBe(task.id);
    const restored = await changeAction({ ...input, mode: 'restore', completionRecord: undefined, version: completed.diary.version }, 1);
    if(kind==='facts') {
      expect(restored.diary.document.todos[0].completion).toBeUndefined();
      expect((await loadDiary(targetDate, 1)).document.facts.events).toHaveLength(0);
      const nextId=randomUUID(), latest=await loadDiary(targetDate, 1);
      await changeAction({...input,version:restored.diary.version,operationId:nextId,completionRecord:{...completionRecord,id:nextId,version:latest.version}}, 1);
      expect((await loadDiary(targetDate, 1)).document.facts.events).toHaveLength(1);
      expect((await loadDiary(targetDate, 1)).document.facts.events[0].id).toBe(nextId);
      return;
    }
    expect(restored.diary.document.todos[0].completion?.id).toBe(operationId);
    await expect(changeAction({ ...input, version: restored.diary.version, operationId: randomUUID() }, 1)).rejects.toMatchObject({ statusCode: 409 });
    const orphan = structuredClone(restored.diary.document); orphan.todos[0].completion = undefined;
    const pending = await saveDiary(date, orphan, restored.diary.version, 1);
    expect((await listActions(1)).tasks.find(r => r.task.id === task.id)?.pendingRecord?.kind).toBe(kind);
    const recovered = await changeAction({ ...input, version: pending.version }, 1);
    expect(recovered.diary.document.todos[0].done).toBe(true);
    expect((await loadDiary(targetDate, 1)).version).toBe(target.version);
  });
}

it('rejects target version conflicts and only-complete writes no diary', async () => {
  const { changeAction } = await import('./actions.js');
  const { loadDiary, saveDiary } = await import('./vault.js');
  const task = todoSchema.parse({ id: randomUUID(), title: '仅完成' });
  const date = '2026-11-01'; const other = '2026-11-02';
  const created = await changeAction({ mode: 'create', date, version: '0', task, operationId: randomUUID() }, 1);
  await saveDiary(other, emptyDiary(other), '0', 1);
  const operationId = randomUUID();
  await expect(changeAction({ mode: 'complete', date, version: created.diary.version, task, operationId, completionRecord: { ...captureDraftSchema.parse({ id: operationId, kind: 'facts', date: other, content: '实际' }), kind: 'facts', version: '0' } }, 1)).rejects.toMatchObject({ statusCode: 409 });
  const done = await changeAction({ mode: 'complete', date, version: created.diary.version, task, operationId }, 1);
  expect(done.diary.document.todos[0].completion).toBeUndefined();
  expect((await loadDiary(other, 1)).document.facts.events).toHaveLength(0);
});
