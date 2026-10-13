import { beforeAll, afterAll, it, expect, vi } from 'vitest';
vi.mock('./db.js',async()=>{const {createDemoPool}=await import('./demoDatabase.js');const pool=createDemoPool(':memory:');return {pool,queryRows:async(sql:string,params:unknown[]=[])=> (await pool.query(sql,params))[0]};});
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { emptyDiary, todoSchema, diaryEventSchema } from '@diary/contracts';
let root=''; const previous=process.env.OBSIDIAN_DIR;
beforeAll(async()=>{root=await mkdtemp(join(tmpdir(),'diary-restore-'));process.env.OBSIDIAN_DIR=root;vi.resetModules();});
afterAll(async()=>{vi.restoreAllMocks();if(previous===undefined)delete process.env.OBSIDIAN_DIR;else process.env.OBSIDIAN_DIR=previous;if(root.startsWith(join(tmpdir(),'diary-restore-')))await rm(root,{recursive:true,force:true});});

it('status undo removes only its own same-day fact, is retry-safe, and later completion gets a new ID',async()=>{
  const vault=await import('./vault.js');const {completeAutomatically}=await import('./autoCompletion.js');const {changeAction}=await import('./actions.js');
  const doc=emptyDiary('2026-10-11');doc.todos=[todoSchema.parse({id:randomUUID(),title:'整理文件'})];
  const unrelated=diaryEventSchema.parse({id:randomUUID(),note:'独立记录'});doc.facts.events=[unrelated];
  const current=await vault.saveDiary(doc.date,doc,'0', 1);
  const done=await vault.withVaultLock(1, ()=>completeAutomatically(current,current.document.todos[0],1, new Date('2026-10-11T02:00:00Z')));
  const request={mode:'status' as const,nextStatus:'doing' as const,date:doc.date,version:done.diary.version,task:done.diary.document.todos[0],operationId:randomUUID()};
  const restored=await changeAction(request, 1);await changeAction(request, 1);
  expect(restored.diary.document.facts.events.map(e=>e.id)).toEqual([unrelated.id]);
  expect(restored.diary.document.todos[0]).toMatchObject({done:false,status:'doing'});
  expect(restored.diary.document.todos[0].completion).toBeUndefined();
  const again=await vault.withVaultLock(1, ()=>completeAutomatically(restored.diary,restored.diary.document.todos[0],1, new Date('2026-10-11T03:00:00Z')));
  expect(again.diary.document.facts.events).toHaveLength(2);
  expect(again.diary.document.todos[0].completion?.id).not.toBe(request.task.completion?.id);
  expect(again.diary.document.todos[0].completedAt).toBe('2026-10-11T03:00:00.000Z');
});

it('recovers interrupted cross-day removal and blocks completing before undo finishes',async()=>{
  const vault=await import('./vault.js');const {completeAutomatically}=await import('./autoCompletion.js');const {changeAction,listActions}=await import('./actions.js');
  const doc=emptyDiary('2026-10-01');doc.todos=[todoSchema.parse({id:randomUUID(),title:'跨日期恢复'})];
  const current=await vault.saveDiary(doc.date,doc,'0', 1);
  const done=await vault.withVaultLock(1, ()=>completeAutomatically(current,current.document.todos[0],1, new Date('2026-10-11T16:20:00Z')));
  const request={mode:'restore' as const,date:doc.date,version:done.diary.version,task:done.diary.document.todos[0],operationId:randomUUID()};
  const original=vault.saveDiaryUnlocked;
  const failure=vi.spyOn(vault,'saveDiaryUnlocked').mockImplementation(async(date,...args)=>{if(date===doc.date)throw new Error('模拟计划写入失败');return original(date,...args);});
  await expect(changeAction(request, 1)).rejects.toMatchObject({statusCode:409});failure.mockRestore();
  expect((await vault.loadDiary('2026-10-12', 1)).document.facts.events).toHaveLength(0);
  expect((await listActions(1)).tasks.find(row=>row.task.id===request.task.id)?.restorePending).toBe(true);
  await expect(changeAction({...request,mode:'complete',automaticRecord:true}, 1)).rejects.toMatchObject({statusCode:409});
  const recovered=await changeAction(request, 1);await changeAction(request, 1);
  expect(recovered.diary.document.todos[0].done).toBe(false);
  expect((await listActions(1)).tasks.find(row=>row.task.id===request.task.id)?.restorePending).toBe(false);
  const next=await vault.withVaultLock(1, ()=>completeAutomatically(recovered.diary,recovered.diary.document.todos[0],1, new Date('2026-10-12T02:00:00Z')));
  expect((await vault.loadDiary('2026-10-12', 1)).document.facts.events).toHaveLength(1);
  expect(next.diary.document.todos[0].completedAt).toBe('2026-10-12T02:00:00.000Z');
});
