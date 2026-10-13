import { beforeAll,afterAll,it,expect,vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { todoSchema,emptyDiary } from '@diary/contracts';
vi.mock('./db.js',async()=>{const {createDemoPool}=await import('./demoDatabase.js');const pool=createDemoPool(':memory:');return {pool,queryRows:async(sql:string,params:unknown[]=[])=> (await pool.query(sql,params))[0]};});
import { pool } from './db.js';
import { loadDiary,saveDiary } from './vault.js';
import { listSchedule,updateSeries } from './schedule.js';
import { changeAction,listActions } from './actions.js';
let task=todoSchema.parse({id:randomUUID(),title:'重复学习',dueDate:'2026-10-11',dueTime:'23:30',startDate:'2026-10-11',startTime:'23:00',repeat:{type:'daily'},entities:[{type:'person',name:'张三',tags:['同事']}]});
beforeAll(async()=>{await changeAction({mode:'create',date:'2026-10-11',version:'0',task,operationId:randomUUID()},1);});
afterAll(async()=>{vi.useRealTimers();await pool.end();});
it('projects read-only, pages deterministically and moves a single occurrence only',async()=>{
 const before=await loadDiary('2026-10-11',1),page=await listSchedule({from:'2026-10-11',to:'2026-10-15',limit:2},1);
 expect(page.tasks).toHaveLength(2);expect(page.nextCursor).toBeTruthy();expect((await loadDiary('2026-10-11',1)).version).toBe(before.version);
 const second=page.tasks.find(r=>r.task.seriesId)!;expect(second.task.occurrenceDate).toBe('2026-10-12');
 await changeAction({mode:'update',date:second.date,version:second.version,task:{...second.task,dueDate:'2026-10-14',dueTime:'12:00'},operationId:randomUUID()},1);
 const all=await listSchedule({from:'2026-10-11',to:'2026-10-15',limit:200},1);
 expect(all.tasks.filter(r=>r.task.id===second.task.id)).toHaveLength(1);expect(all.tasks.find(r=>r.task.id===second.task.id)?.task).toMatchObject({dueDate:'2026-10-14',dueTime:'12:00',startDate:'2026-10-12',startTime:'23:00'});
 expect(all.tasks.find(r=>r.task.occurrenceDate==='2026-10-13')?.task.dueTime).toBe('23:30');
 await expect(changeAction({mode:'update',date:second.date,version:second.version,task:second.task,operationId:randomUUID()},1)).rejects.toMatchObject({statusCode:409});
});
it('completes independently across midnight, retries without duplicate facts and restores only the linked fact',async()=>{
 vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-11T16:20:00Z'));
 const row=(await listSchedule({from:'2026-10-12',to:'2026-10-12',limit:200},1)).tasks[0] || (await listSchedule({from:'2026-10-13',to:'2026-10-13',limit:200},1)).tasks[0];
 const done=await changeAction({mode:'complete',automaticRecord:true,date:row.date,version:row.version,task:row.task,operationId:randomUUID()},1);
 const completed=done.diary.document.todos.find(t=>t.id===row.task.id)!;
 expect((await loadDiary('2026-10-12',1)).document.facts.events).toMatchObject([{time:'00:20',note:'完成计划：重复学习',people:[{name:'张三',tags:['同事']}],plannedStart:{date:row.task.startDate,time:'23:00'}}]);
 await changeAction({mode:'complete',automaticRecord:true,date:row.date,version:row.version,task:row.task,operationId:randomUUID()},1);expect((await loadDiary('2026-10-12',1)).document.facts.events).toHaveLength(1);
 const next=(await listSchedule({from:'2026-10-15',to:'2026-10-15',limit:200},1)).tasks[0];expect(next.task.done).toBe(false);
 await changeAction({mode:'restore',date:row.date,version:done.diary.version,task:completed,operationId:randomUUID()},1);expect((await loadDiary('2026-10-12',1)).document.facts.events).toHaveLength(0);vi.useRealTimers();
});
it('updates or stops future periods, preserves history and respects version conflicts',async()=>{
 const current=await loadDiary('2026-10-11',1),root=current.document.todos.find(t=>t.id===task.id)!;
 await expect(updateSeries({date:current.document.date,version:'stale',from:'2026-10-16',task:root,stop:false},1)).rejects.toMatchObject({statusCode:409});
 const changed=await updateSeries({date:current.document.date,version:current.version,from:'2026-10-16',task:{...root,title:'新的学习',dueDate:'2026-10-16',startDate:'2026-10-16'},stop:false},1);
 expect((await listSchedule({from:'2026-10-16',to:'2026-10-16',limit:200},1)).tasks[0].task.title).toBe('新的学习');
 await updateSeries({date:current.document.date,version:changed.diary.version,from:'2026-10-17',task:root,stop:true},1);
 expect((await listSchedule({from:'2026-10-17',to:'2026-10-20',limit:200},1)).tasks).toHaveLength(0);expect((await listActions(1)).tasks.some(r=>r.task.id===root.id)).toBe(true);
});
it('recovers an interrupted virtual occurrence at its first completion time without duplicating facts',async()=>{
 const row=(await listSchedule({from:'2026-10-16',to:'2026-10-16',limit:200},1)).tasks[0];
 const original=pool.query.bind(pool);let interrupted=false;
 const spy=vi.spyOn(pool,'query').mockImplementation(async(sql:any,args:any)=>{if(!interrupted&&String(sql).includes('INSERT INTO diaries')&&args[1]==='2026-10-11'){interrupted=true;throw new Error('simulated owner-write interruption');}return original(sql,args) as any;});
 vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-20T06:20:00Z'));
 await expect(changeAction({mode:'complete',automaticRecord:true,date:row.date,version:row.version,task:row.task,operationId:randomUUID()},1)).rejects.toMatchObject({statusCode:409});spy.mockRestore();
 expect((await listSchedule({from:'2026-10-16',to:'2026-10-16',limit:200},1)).tasks[0].completionPending).toBe(true);
 vi.setSystemTime(new Date('2026-10-21T07:00:00Z'));const done=await changeAction({mode:'complete',automaticRecord:true,date:row.date,version:row.version,task:row.task,operationId:randomUUID()},1);
 const stored=done.diary.document.todos.find(t=>t.id===row.task.id)!;expect(stored.completedAt).toBe('2026-10-20T06:20:00.000Z');expect((await loadDiary('2026-10-20',1)).document.facts.events).toHaveLength(1);expect((await loadDiary('2026-10-21',1)).document.facts.events).toHaveLength(0);vi.useRealTimers();
 await changeAction({mode:'restore',date:row.date,version:done.diary.version,task:stored,operationId:randomUUID()},1);expect((await loadDiary('2026-10-20',1)).document.facts.events).toHaveLength(0);
});
it('does not resurrect permanently removed occurrences or leak a different user’s schedule',async()=>{
 const row=(await listSchedule({from:'2026-10-14',to:'2026-10-14',limit:200},1)).tasks.find(r=>r.task.occurrenceDate==='2026-10-14')!;
 const deleted=await changeAction({mode:'delete',date:row.date,version:row.version,task:row.task,operationId:randomUUID()},1);
 await changeAction({mode:'purge',date:row.date,version:deleted.diary.version,task:row.task,operationId:randomUUID()},1);
 expect((await listSchedule({from:'2026-10-14',to:'2026-10-14',limit:200},1)).tasks.some(r=>r.task.id===row.task.id)).toBe(false);
 expect((await listSchedule({from:'2026-10-11',to:'2026-10-20',limit:200},2)).tasks).toHaveLength(0);
});
