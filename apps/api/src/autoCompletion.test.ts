import { beforeAll, afterAll, it, expect, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { emptyDiary, todoSchema } from '@diary/contracts';
let root='';const previous=process.env.OBSIDIAN_DIR;
beforeAll(async()=>{root=await mkdtemp(join(tmpdir(),'diary-auto-'));process.env.OBSIDIAN_DIR=root;vi.resetModules();});
afterAll(async()=>{if(previous===undefined)delete process.env.OBSIDIAN_DIR;else process.env.OBSIDIAN_DIR=previous;if(root.startsWith(join(tmpdir(),'diary-auto-')))await rm(root,{recursive:true,force:true});});

it('cross-midnight completion uses actual Shanghai time and preserves the scheduled start snapshot',async()=>{
  const vault=await import('./vault.js');const {completeAutomatically}=await import('./autoCompletion.js');const {changeAction}=await import('./actions.js');
  const doc=emptyDiary('2026-10-11');doc.todos=[todoSchema.parse({id:randomUUID(),title:'核对方案',description:'预期提交，不代表已经提交',startDate:'2026-10-11',startTime:'23:00',category:'work',important:true,urgent:false,tags:['项目'],entities:[{type:'person',name:'张三',tags:['同事']},{type:'place',name:'办公室',tags:['公司']},{type:'thing',name:'方案文档',tags:['项目']}]})];
  const current=await vault.saveDiary(doc.date,doc,'0');
  const completed=await vault.withVaultLock(()=>completeAutomatically(current,current.document.todos[0],new Date('2026-10-11T16:20:00Z')));
  const task=completed.diary.document.todos[0],target=await vault.loadDiary('2026-10-12');
  expect(target.document.facts.events).toHaveLength(1);
  expect(target.document.facts.events[0]).toMatchObject({time:'00:20',note:'完成计划：核对方案',plannedStart:{date:'2026-10-11',time:'23:00'},tags:['项目'],task:{id:task.id},people:[{name:'张三',type:'person',tags:['同事']}],places:[{name:'办公室',type:'place',tags:['公司']}]});
  expect(target.document.facts.events[0].remark).toContain('原计划说明：预期提交，不代表已经提交');
  expect(target.document.facts.events[0].planEntities).toEqual(doc.todos[0].entities);
  const duplicate=await changeAction({mode:'complete',automaticRecord:true,date:doc.date,version:current.version,task,operationId:randomUUID()});
  expect(duplicate.diary.document.todos[0].completion?.id).toBe(task.completion?.id);
  const restored=await changeAction({mode:'restore',date:doc.date,version:completed.diary.version,task,operationId:randomUUID()});
  expect(restored.diary.document.todos[0].completion).toBeUndefined();
  expect((await vault.loadDiary('2026-10-12')).document.facts.events).toHaveLength(0);
  const changed=await changeAction({mode:'update',date:doc.date,version:restored.diary.version,task:{...restored.diary.document.todos[0],startTime:'08:00'},operationId:randomUUID()});
  await changeAction({mode:'status',date:doc.date,version:changed.diary.version,task:changed.diary.document.todos[0],nextStatus:'done',operationId:randomUUID()});
  const newTask=(await vault.loadDiary(doc.date)).document.todos[0];
  expect(newTask.completion?.id).not.toBe(task.completion?.id);
  expect(newTask.completedAt).not.toBe(task.completedAt);
});

it('recovers a cross-date interruption without duplication or replacing first completion time',async()=>{
  const vault=await import('./vault.js');const {completeAutomatically}=await import('./autoCompletion.js');const {listActions}=await import('./actions.js');
  const doc=emptyDiary('2026-10-01');doc.todos=[todoSchema.parse({id:randomUUID(),title:'恢复案例'})];
  const current=await vault.saveDiary(doc.date,doc,'0');const original=vault.saveDiaryUnlocked;
  const failure=vi.spyOn(vault,'saveDiaryUnlocked').mockImplementation(async(date,...args)=>{if(date===doc.date)throw new Error('模拟写入中断');return original(date,...args);});
  await expect(vault.withVaultLock(()=>completeAutomatically(current,current.document.todos[0],new Date('2026-10-11T16:20:00Z')))).rejects.toMatchObject({statusCode:409});failure.mockRestore();
  expect((await listActions()).tasks.find(row=>row.task.id===doc.todos[0].id)?.completionPending).toBe(true);
  const pending=await vault.loadDiary(doc.date),target=await vault.loadDiary('2026-10-12');
  await vault.withVaultLock(()=>completeAutomatically(pending,pending.document.todos[0],new Date('2026-10-13T08:00:00Z')));
  expect((await vault.loadDiary('2026-10-12')).version).toBe(target.version);
  expect((await vault.loadDiary('2026-10-13')).exists).toBe(false);
  expect((await vault.loadDiary(doc.date)).document.todos[0].completedAt).toBe('2026-10-11T16:20:00.000Z');
});

it('shares entity and explicit record tags, saves OR-tag views, and round trips classification',async()=>{
  const {tagLibrary,savePlanViews,getPlanViews,addSharedTag}=await import('./planSettings.js');
  await addSharedTag('新标签');const tags=await tagLibrary({person:['人物标签'],place:[],activity:[],food:[],thing:['事物标签']});
  expect(tags).toEqual(expect.arrayContaining(['新标签','人物标签','事物标签','项目','同事']));
  const views=[{id:randomUUID(),name:'我的视图',color:'#88aaff',tags:['项目','新标签']}];await savePlanViews(views);expect(await getPlanViews()).toEqual(views);
  await expect(savePlanViews([{...views[0],tags:[]}])).rejects.toThrow();
  const {loadDiary}=await import('./vault.js');expect((await loadDiary('2026-10-11')).document.todos[0]).toMatchObject({category:'work',important:true,urgent:false});
});
