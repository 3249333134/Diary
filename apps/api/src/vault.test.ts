import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
vi.mock('./db.js',async()=>{const {createDemoPool}=await import('./demoDatabase.js');const pool=createDemoPool(':memory:');return {pool,queryRows:async(sql:string,params:unknown[]=[])=> (await pool.query(sql,params))[0]};});
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { emptyDiary, projectEntries } from "@diary/contracts";

let temporaryVault = "";

beforeAll(async () => {
  temporaryVault = await mkdtemp(join(tmpdir(), "independent-diary-test-"));
  process.env.OBSIDIAN_DIR = temporaryVault;
  vi.resetModules();
});

afterAll(async () => {
  await rm(temporaryVault, { recursive: true, force: true });
});

describe("vault storage", () => {
  it('links a source to a cross-day action, preserves IDs and recovers without duplicate facts', async () => {
    const { loadDiary, saveDiary } = await import('./vault.js');
    const { changeAction, listActions } = await import('./actions.js');
    const source = emptyDiary('2026-09-10'); source.learn.content = '新知一\n\n新知二';
    const saved = await saveDiary(source.date, source, '0', 1);
    const entry = saved.document.entries!.learn[1];
    const reordered = structuredClone(saved.document); reordered.entries!.learn.reverse(); reordered.entries!.learn[0].content = '修改新知二\n- 保留列表\n\n保留段落';
    const revised = await saveDiary(source.date, projectEntries(reordered), saved.version, 1);
    expect(revised.document.entries!.learn[0].id).toBe(entry.id);
    expect(revised.document.entries!.learn[0].content).toContain('- 保留列表');
    const task = { id: crypto.randomUUID(), title: '实践新知', time: '09:00', plannedDate: '2026-09-10', done: false, source: { date: source.date, kind: 'learn' as const, id: entry.id, summary: '新知二' } };
    const created = await changeAction({ mode: 'create', date: source.date, version: revised.version, sourceVersion: revised.version, task, operationId: crypto.randomUUID() }, 1);
    const operationId = crypto.randomUUID();
    const input = { mode: 'complete' as const, date: source.date, version: created.diary.version, task, operationId, fact: { date: '2026-09-11', version: '0', time: '15:42', note: '实践了整理方法', remark: '有用' } };
    const completed = await changeAction(input, 1);
    await changeAction(input, 1);
    const target = await loadDiary('2026-09-11', 1);
    expect(target.document.facts.events).toHaveLength(1);
    expect(target.document.facts.events[0].id).toBe(operationId);
    expect(target.document.facts.events[0].time).toBe('15:42');
    expect(completed.diary.document.todos[0].completion?.date).toBe('2026-09-11');
    const restored = await changeAction({ ...input, mode: 'restore', fact: undefined, version: completed.diary.version }, 1);
    expect(restored.diary.document.todos[0].done).toBe(false);
    expect((await loadDiary('2026-09-11', 1)).document.facts.events).toHaveLength(0);
    await expect(changeAction({ ...input, operationId: crypto.randomUUID(), version: restored.diary.version }, 1)).rejects.toMatchObject({ statusCode: 409 });
    // Recreate only the target write to simulate a later interrupted completion.
    const missingTarget=await loadDiary('2026-09-11', 1);
    await saveDiary('2026-09-11',target.document,missingTarget.version, 1);
    // Simulate a crash after target write but before source update.
    const orphan = structuredClone(restored.diary.document); orphan.todos[0].completion = undefined; orphan.todos[0].operationId = undefined;
    const pending = await saveDiary(source.date, orphan, restored.diary.version, 1);
    expect((await listActions(1)).tasks.find(r => r.task.id === task.id)?.pendingFact?.id).toBe(operationId);
    const recovered = await changeAction({ ...input, version: pending.version }, 1);
    expect(recovered.diary.document.todos[0].done).toBe(true);
    expect((await loadDiary('2026-09-11', 1)).document.facts.events).toHaveLength(1);
    // Deleting a source preserves the task and reports a missing source.
    const removed = structuredClone(recovered.diary.document); removed.entries!.learn = [];
    await saveDiary(source.date, projectEntries(removed), recovered.diary.version, 1);
    expect((await listActions(1)).tasks.find(r => r.task.id === task.id)?.sourceExists).toBe(false);
  });
  it("saves atomically and refuses a stale version", async () => {
    const { loadDiary, saveDiary } = await import("./vault.js");
    const original = emptyDiary("2026-09-07");
    original.learn.content = "第一次保存";

    const first = await saveDiary("2026-09-07", original, "0", 1);
    expect(first.version).not.toBe("0");
    expect((await loadDiary("2026-09-07", 1)).document.learn.content).toBe("第一次保存");

    const changed = { ...first.document, entries: { ...first.document.entries!, learn: first.document.entries!.learn.map(e => ({ ...e, content: '第二次保存' })) } };
    const second = await saveDiary("2026-09-07", changed, first.version, 1);
    expect(second.document.learn.content).toBe("第二次保存");

    await expect(saveDiary("2026-09-07", original, first.version, 1)).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
    expect((await loadDiary("2026-09-07", 1)).document.learn.content).toBe("第二次保存");
  });
});
