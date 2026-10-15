import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { todoSchema } from '@diary/contracts';
vi.mock('./db.js', async () => { const { createDemoPool } = await import('./demoDatabase.js'); const pool = createDemoPool(':memory:'); return { pool, queryRows: async (sql: string, params: unknown[] = []) => (await pool.query(sql, params))[0] }; });
import { pool } from './db.js';
import { loadDiary } from './vault.js';
import { listSchedule } from './schedule.js';
import { changeAction } from './actions.js';

const task = todoSchema.parse({ id: randomUUID(), title: '每天喝水', dueDate: '2026-10-11', repeat: { type: 'daily' } });
const anchor = '2026-10-11';
const rootCheckins = async () => (await loadDiary(anchor, 1)).document.todos.find(t => t.id === task.id)?.checkins;

beforeAll(async () => { await changeAction({ mode: 'create', date: anchor, version: '0', task, operationId: randomUUID() }, 1); });
afterAll(async () => { vi.useRealTimers(); await pool.end(); });

it('完成期次打卡 +1，取消 -1，完成首日根任务也计数', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-12T10:00:00Z'));
  expect(await rootCheckins()).toBeUndefined();
  // 完成第一期（根任务本身即首次期次）
  let row = (await listSchedule({ from: anchor, to: anchor, limit: 200 }, 1)).tasks[0];
  await changeAction({ mode: 'complete', automaticRecord: true, date: row.date, version: row.version, task: row.task, operationId: randomUUID() }, 1);
  expect(await rootCheckins()).toBe(1);
  // 完成第二期（虚拟期次，先物化再完成）
  row = (await listSchedule({ from: '2026-10-12', to: '2026-10-12', limit: 200 }, 1)).tasks[0];
  const done = await changeAction({ mode: 'complete', automaticRecord: true, date: row.date, version: row.version, task: row.task, operationId: randomUUID() }, 1);
  expect(done.diary.document.todos.find(t => t.id === task.id)?.checkins).toBe(2);
  // 期次行透传计数，前端日历/看板可直接展示
  expect((await listSchedule({ from: '2026-10-13', to: '2026-10-13', limit: 200 }, 1)).tasks[0].task.checkins).toBe(2);
  // 取消第二期完成 → 计数回落
  const stored = done.diary.document.todos.find(t => t.seriesId === task.id && t.occurrenceDate === '2026-10-12')!;
  await changeAction({ mode: 'restore', date: row.date, version: done.diary.version, task: stored, operationId: randomUUID() }, 1);
  expect(await rootCheckins()).toBe(1);
  vi.useRealTimers();
});
