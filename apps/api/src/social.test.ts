import {beforeAll,beforeEach,afterAll,it,expect,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import {emptyDiary,todoSchema} from '@diary/contracts';
vi.mock('./db.js',async()=>{const {createDemoPool}=await import('./demoDatabase.js');const pool=createDemoPool(':memory:');return {pool,queryRows:async(sql:string,params:unknown[]=[])=> (await pool.query(sql,params))[0]};});
import {pool,queryRows} from './db.js';
import {loadDiary,saveDiary} from './vault.js';
import {ensureSocialTables,socialProfile,socialSnapshot,requestFriend,respondFriend,createWindow,inviteMember,changeMember,changeSharedTask,listSharedTasks,processSharedFactJobs,editWindow,removeFriend} from './social.js';
beforeAll(ensureSocialTables);
beforeEach(async()=>{
 vi.useRealTimers();
 for(const table of ['shared_notice_jobs','shared_fact_jobs','shared_operations','shared_tasks','shared_members','shared_windows','social_friends','social_notices','social_profiles','diaries','settings','obsidian_changes','obsidian_operations'])try{await pool.query('DELETE FROM '+table);}catch{}
 for(let id=2;id<=4;id++)if(!(await queryRows('SELECT id FROM users WHERE id = ?',[id])).length)await pool.query('INSERT INTO users (id,username,password_hash) VALUES (?,?,?)',[id,'好友'+id,'disabled']);
});
afterAll(async()=>{vi.useRealTimers();await pool.end();});
async function friends(a=1,b=2){await requestFriend(a,(await socialProfile(b)).code);const r=(await socialSnapshot(b)).requests[0];await respondFriend(b,r.id,'accept');}
async function windowWithEditor(){await friends();const win=await createWindow(1,{name:'一起安排',color:'#7561bd'});await inviteMember(win.id,1,(await socialProfile(2)).code,'editor');await changeMember(win.id,2,'accept');return win;}
async function createTask(id:string,patch:object={}){const task=todoSchema.parse({id:randomUUID(),title:'共同读书',dueDate:'2026-10-24',dueTime:'20:00',startDate:'2026-10-24',startTime:'19:00',important:true,urgent:false,...patch});return (await changeSharedTask(id,1,{mode:'create',date:'2026-10-24',version:'0',task,operationId:randomUUID()})).row;}
const act=(win:string,user:number,row:any,mode:string,extra:object={})=>changeSharedTask(win,user,{mode,date:row.date,version:row.version,task:row.task,operationId:randomUUID(),...extra});

it('uses stable random friend codes, approved relationships and private response shapes',async()=>{
 const profile=await socialProfile(1);expect(profile).toEqual(await socialProfile(1));expect(profile.code).toMatch(/^[A-F0-9]{12}$/);
 await expect(requestFriend(1,profile.code)).rejects.toMatchObject({statusCode:400});
 await requestFriend(1,(await socialProfile(2)).code);expect((await socialSnapshot(1)).friends).toHaveLength(0);
 const r=(await socialSnapshot(2)).requests[0];await expect(respondFriend(3,r.id,'accept')).rejects.toMatchObject({statusCode:404});
 await expect(requestFriend(2,profile.code)).rejects.toMatchObject({statusCode:409});await respondFriend(2,r.id,'accept');expect((await socialSnapshot(1)).friends).toHaveLength(1);
 expect(JSON.stringify(await socialSnapshot(2))).not.toMatch(/user_id|password_hash|owner_id/);
});
it('supports rejection, withdrawal and unfriend independently from window membership',async()=>{
 await requestFriend(1,(await socialProfile(2)).code);await respondFriend(1,(await socialSnapshot(1)).requests[0].id,'withdraw');expect((await socialSnapshot(2)).requests).toHaveLength(0);
 await requestFriend(1,(await socialProfile(2)).code);await respondFriend(2,(await socialSnapshot(2)).requests[0].id,'reject');
 const win=await windowWithEditor();await removeFriend(1,(await socialProfile(2)).code);expect((await socialSnapshot(1)).friends).toHaveLength(0);expect((await socialSnapshot(2)).windows[0].id).toBe(win.id);
});
it('requires invitation acceptance and enforces viewer/editor/owner access on the server',async()=>{
 await friends();const win=await createWindow(1,{name:'共享窗口',color:'#7561bd'});await inviteMember(win.id,1,(await socialProfile(2)).code,'viewer');
 expect((await socialSnapshot(2)).windows).toHaveLength(0);expect((await listSharedTasks(2))).toHaveLength(0);
 const row=await createTask(win.id);await expect(act(win.id,2,row,'update')).rejects.toMatchObject({statusCode:403});
 await changeMember(win.id,2,'accept');expect((await listSharedTasks(2))[0].readOnly).toBe(true);await expect(act(win.id,2,row,'complete')).rejects.toMatchObject({statusCode:403});
 await changeMember(win.id,1,'role',(await socialProfile(2)).code,'editor');await act(win.id,2,row,'update',{task:{...row.task,title:'好友修改'}});
 expect((await listSharedTasks(1))[0].task.title).toBe('好友修改');await expect(act(win.id,3,row,'update')).rejects.toMatchObject({statusCode:403});
 await expect(editWindow(win.id,2,{...win,archived:true})).rejects.toMatchObject({statusCode:403});
});
it('strips private sources and completion links from canonical shared data',async()=>{
 const win=await windowWithEditor(),ref={date:'2026-10-24',kind:'facts',id:randomUUID(),summary:'私人内容'};
 await createTask(win.id,{source:ref,completion:ref,done:true,status:'done',category:'personal'});
 const row=(await listSharedTasks(2))[0];expect(row.task.source).toBeUndefined();expect(row.task.completion).toBeUndefined();expect(row.task.done).toBe(false);expect(row.task.category).toBeNull();expect(JSON.stringify(row)).not.toContain('私人内容');
});
it('shares the check-in choice and counts only opted-in recurring completions',async()=>{
 const win=await windowWithEditor(),tracked=await createTask(win.id,{repeat:{type:'daily'},checkinEnabled:true});
 await act(win.id,2,tracked,'complete');
 let rows=await listSharedTasks(1,'2026-10-25','2026-10-25');expect(rows.find(row=>row.task.seriesId===tracked.task.id)?.task).toMatchObject({checkinEnabled:true,checkins:1});
 await act(win.id,1,(await listSharedTasks(1)).find(row=>row.task.id===tracked.task.id)!,'restore');
 expect((await listSharedTasks(2,'2026-10-25','2026-10-25')).find(row=>row.task.seriesId===tracked.task.id)?.task.checkins).toBe(0);
 const plain=await createTask(win.id,{repeat:{type:'daily'},checkinEnabled:false});await act(win.id,2,plain,'complete');
 rows=await listSharedTasks(2,'2026-10-25','2026-10-25');const task=rows.find(row=>row.task.seriesId===plain.task.id)?.task;expect(task?.checkinEnabled).toBe(false);expect(task?.checkins).toBeUndefined();
});
it('round trips multiline Chinese and emoji without treating content as internal metadata',async()=>{
 const win=await windowWithEditor(),title='一起读书 📚 <!-- diary-links:eyJkdWVEYXRlIjoiMTk5OS0wMS0wMSJ9 -->',description='第一行\n第二行 📚';await createTask(win.id,{title,description});const row=(await listSharedTasks(2))[0];expect(row.task.title).toBe(title);expect(row.task.description).toBe(description);expect(row.task.dueDate).toBe('2026-10-24');expect(row.task.completion).toBeUndefined();
});
it('uses version checks and stable operation ids without duplicate writes or notices',async()=>{
 const win=await windowWithEditor(),row=await createTask(win.id),operationId=randomUUID(),input={mode:'update',date:row.date,version:row.version,task:{...row.task,title:'共同改名'},operationId};
 const changed=await changeSharedTask(win.id,2,input),count=(await socialSnapshot(1)).notices.length;
 await changeSharedTask(win.id,2,input);expect((await socialSnapshot(1)).notices).toHaveLength(count);
 await expect(act(win.id,1,row,'update')).rejects.toMatchObject({statusCode:409});
 await expect(changeSharedTask(win.id,2,{...input,task:{...input.task,title:'另一项'}})).rejects.toMatchObject({statusCode:409});expect(changed.row.task.title).toBe('共同改名');
});
it('writes one completion fact per active member at the original Shanghai completion time',async()=>{
 const win=await windowWithEditor(),row=await createTask(win.id);vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-24T16:07:00Z'));
 const input={mode:'complete',date:row.date,version:row.version,task:row.task,operationId:randomUUID()};await changeSharedTask(win.id,2,input);
 vi.setSystemTime(new Date('2026-10-26T03:00:00Z'));await changeSharedTask(win.id,2,input);
 for(const user of [1,2]){const facts=(await loadDiary('2026-10-25',user)).document.facts.events;expect(facts).toHaveLength(1);expect(facts[0]).toMatchObject({time:'00:07',note:'共享日程已完成：共同读书',plannedStart:{date:'2026-10-24',time:'19:00'},task:{windowId:win.id,id:row.task.id}});expect(facts[0].remark).toContain('实际完成人：好友2');expect((await loadDiary('2026-10-26',user)).document.facts.events).toHaveLength(0);}
 const other=(await listSharedTasks(1))[0];expect(other.task.completion?.id).not.toBe((await listSharedTasks(2))[0].task.completion?.id);
});
it('keeps completed status when one diary fails, retries safely and restores only linked facts',async()=>{
 const win=await windowWithEditor(),row=await createTask(win.id);vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-24T06:00:00Z'));
 const privateDoc=emptyDiary('2026-10-24');privateDoc.facts.events=[{id:randomUUID(),time:'09:00',note:'私人事实',remark:'',people:[],places:[],activities:[],foods:[],attachments:[]}];await saveDiary(privateDoc.date,privateDoc,'0',2);
 const original=pool.query.bind(pool);const spy=vi.spyOn(pool,'query').mockImplementation(async(sql:any,args:any)=>{if(/INSERT INTO diaries/.test(sql)&&args[0]===2)throw new Error('模拟保存失败');return original(sql,args) as any;});
 const done=await act(win.id,1,row,'complete');expect(done.row.task.done).toBe(true);expect(done.row.completionPending).toBe(true);spy.mockRestore();
 await processSharedFactJobs();await processSharedFactJobs();expect((await loadDiary('2026-10-24',2)).document.facts.events).toHaveLength(2);
 await act(win.id,1,(await listSharedTasks(1))[0],'restore');expect((await loadDiary('2026-10-24',1)).document.facts.events).toHaveLength(0);expect((await loadDiary('2026-10-24',2)).document.facts.events.map(e=>e.note)).toEqual(['私人事实']);
});
it('does not append stale facts when restore overtakes an interrupted completion',async()=>{
 const win=await windowWithEditor(),row=await createTask(win.id),original=pool.query.bind(pool);vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-24T06:00:00Z'));
 const spy=vi.spyOn(pool,'query').mockImplementation(async(sql:any,args:any)=>{if(/INSERT INTO diaries/.test(sql))throw new Error('offline');return original(sql,args) as any;});
 await act(win.id,1,row,'complete');await act(win.id,1,(await listSharedTasks(1))[0],'restore');spy.mockRestore();await processSharedFactJobs();for(const id of [1,2])expect((await loadDiary('2026-10-24',id)).document.facts.events).toHaveLength(0);
});
it('new members receive no historic facts; former members keep detached history',async()=>{
 const win=await windowWithEditor(),row=await createTask(win.id);vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-24T06:00:00Z'));await act(win.id,1,row,'complete');
 await friends(1,3);await inviteMember(win.id,1,(await socialProfile(3)).code,'viewer');await changeMember(win.id,3,'accept');expect((await loadDiary('2026-10-24',3)).document.facts.events).toHaveLength(0);
 await changeMember(win.id,2,'leave');await act(win.id,1,(await listSharedTasks(1))[0],'restore');expect((await loadDiary('2026-10-24',2)).document.facts.events).toHaveLength(1);expect(await listSharedTasks(2)).toHaveLength(0);
});
it('retains independent recurrence identities, moved deadlines and month-end rules',async()=>{
 const win=await windowWithEditor();await createTask(win.id,{dueDate:'2026-01-31',dueTime:'15:00',repeat:{type:'monthly',monthDay:31}});
 const feb=(await listSharedTasks(2,'2026-02-01','2026-02-28'))[0];expect(feb.task.dueDate).toBe('2026-02-28');
 await act(win.id,2,feb,'update',{task:{...feb.task,dueDate:'2026-02-27',dueTime:'16:15'}});
 expect((await listSharedTasks(1,'2026-02-01','2026-02-28')).filter(r=>r.task.id===feb.task.id)).toHaveLength(1);expect((await listSharedTasks(1,'2026-03-01','2026-03-31'))[0].task.dueDate).toBe('2026-03-31');
 const moved=(await listSharedTasks(1,'2026-02-01','2026-02-28'))[0];expect(moved.task.occurrenceDate).toBe('2026-02-28');
 await act(win.id,1,moved,'series',{seriesVersion:moved.seriesVersion,from:'2026-02-28',stop:true});expect(await listSharedTasks(2,'2026-03-01','2026-03-31')).toHaveLength(0);
});
it('revoked permissions and archived windows reject stale editors',async()=>{
 const win=await windowWithEditor(),row=await createTask(win.id);await changeMember(win.id,1,'role',(await socialProfile(2)).code,'viewer');await expect(act(win.id,2,row,'update')).rejects.toMatchObject({statusCode:403});
 await editWindow(win.id,1,{...win,archived:true});expect(await listSharedTasks(1)).toHaveLength(0);await expect(act(win.id,1,row,'complete')).rejects.toMatchObject({statusCode:403});
});
it('durably retries notices after a task commit and deduplicates delivery',async()=>{
 const win=await windowWithEditor(),row=await createTask(win.id),original=pool.query.bind(pool),before=(await socialSnapshot(1)).notices.length;
 const spy=vi.spyOn(pool,'query').mockImplementation(async(sql:any,args:any)=>{if(/INSERT INTO social_notices/.test(sql))throw new Error('notice unavailable');return original(sql,args) as any;});
 const changed=await act(win.id,1,row,'update',{task:{...row.task,title:'已写入但通知稍后同步'}});expect(changed.row.task.title).toBe('已写入但通知稍后同步');spy.mockRestore();
 await processSharedFactJobs();await processSharedFactJobs();expect((await socialSnapshot(1)).notices.length).toBe(before+1);
});
it('serializes concurrent member revocation and diary writes for the demo database',async()=>{
 const win=await windowWithEditor(),row=await createTask(win.id);
 const results=await Promise.allSettled([changeMember(win.id,1,'role',(await socialProfile(2)).code,'viewer'),act(win.id,2,row,'update',{task:{...row.task,title:'不得保存'}})]);expect(results[0].status).toBe('fulfilled');expect(results[1]).toMatchObject({status:'rejected',reason:{statusCode:403}});
 await Promise.all([saveDiary('2026-10-24',emptyDiary('2026-10-24'),'0',1),saveDiary('2026-10-24',emptyDiary('2026-10-24'),'0',2)]);expect((await loadDiary('2026-10-24',1)).exists).toBe(true);
});
it('does not accept a friend request after a concurrent withdrawal',async()=>{
 await requestFriend(1,(await socialProfile(2)).code);const request=(await socialSnapshot(2)).requests[0];
 const outcomes=await Promise.allSettled([respondFriend(1,request.id,'withdraw'),respondFriend(2,request.id,'accept')]);
 expect(outcomes.filter(r=>r.status==='fulfilled')).toHaveLength(1);expect(outcomes.filter(r=>r.status==='rejected')).toHaveLength(1);
});
it('reports committed writes as saved when follow-up reads fail and retries their jobs',async()=>{
 const win=await windowWithEditor(),row=await createTask(win.id),original=pool.query.bind(pool);
 const spy=vi.spyOn(pool,'query').mockImplementation(async(sql:any,args:any)=>{if(/^SELECT \* FROM shared_notice_jobs/.test(sql))throw new Error('follow-up offline');return original(sql,args) as any;});
 const saved=await act(win.id,1,row,'complete');expect(saved.row.task.done).toBe(true);expect(saved.refreshWarning).toContain('已保存');spy.mockRestore();
 await processSharedFactJobs();expect((await listSharedTasks(2))[0].completionPending).toBe(false);
});
