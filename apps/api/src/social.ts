import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {EventEmitter} from 'node:events';
import type {FastifyInstance} from 'fastify';
import {z} from 'zod';
import {emptyDiary,diaryEventSchema,todoSchema,type Todo,type SocialSnapshot,type SharedWindow,type WindowRole} from '@diary/contracts';
import {pool,queryRows} from './db.js';
import {syncTransaction} from './sync-db.js';
import {loadDiary,saveDiaryUnlocked,withVaultLock} from './vault.js';
import {serializeDiaryMarkdown,parseDiaryMarkdown} from './markdown.js';
import {deriveOccurrence,isSeries,firstOccurrence} from './recurrence.js';
import {addDays,assertDate,todayInTimezone} from './date.js';
import {config} from './config.js';
import {getSessionToken,verifySession,createSession,setSessionCookie} from './auth.js';

const fail=(message:string,statusCode=400)=>Object.assign(new Error(message),{statusCode});
const now=()=>new Date().toISOString();
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
const uuid=z.string().uuid(),role=z.enum(['viewer','editor']);
const metadata=z.object({name:z.string().trim().min(1).max(30),color:z.string().regex(/^#[a-f0-9]{6}$/i)});
const events=new EventEmitter();events.setMaxListeners(0);
type Member={user_id:number;role:WindowRole;status:string};
type StoredTask={window_id:string;task_id:string;date:string;content:string;version:string};
const locks=new Map<string,Promise<unknown>>();
function serial<T>(key:string,work:()=>Promise<T>):Promise<T>{const previous=locks.get(key)||Promise.resolve();const result=previous.then(work,work),settled=result.catch(()=>{});locks.set(key,settled);return result.finally(()=>{if(locks.get(key)===settled)locks.delete(key);});}

export async function ensureSocialTables(){
 const sqlite=typeof pool.getConnection!=='function',sequence=sqlite?'INTEGER PRIMARY KEY AUTOINCREMENT':'BIGINT PRIMARY KEY AUTO_INCREMENT';
 for(const sql of [
  'CREATE TABLE IF NOT EXISTS social_profiles (user_id INT PRIMARY KEY,friend_code VARCHAR(16) UNIQUE NOT NULL)',
  'CREATE TABLE IF NOT EXISTS social_friends (id VARCHAR(36) PRIMARY KEY,pair_key VARCHAR(80) UNIQUE NOT NULL,sender_id INT NOT NULL,recipient_id INT NOT NULL,status VARCHAR(20) NOT NULL,created_at VARCHAR(30) NOT NULL)',
  'CREATE TABLE IF NOT EXISTS shared_windows (id VARCHAR(36) PRIMARY KEY,owner_id INT NOT NULL,name VARCHAR(30) NOT NULL,color VARCHAR(7) NOT NULL,version VARCHAR(36) NOT NULL,archived INT NOT NULL DEFAULT 0)',
  'CREATE TABLE IF NOT EXISTS shared_members (window_id VARCHAR(36) NOT NULL,user_id INT NOT NULL,role VARCHAR(10) NOT NULL,status VARCHAR(12) NOT NULL,PRIMARY KEY(window_id,user_id))',
  'CREATE TABLE IF NOT EXISTS shared_tasks (window_id VARCHAR(36) NOT NULL,task_id VARCHAR(80) NOT NULL,date VARCHAR(10) NOT NULL,content LONGTEXT NOT NULL,version VARCHAR(64) NOT NULL,PRIMARY KEY(window_id,task_id))',
  `CREATE TABLE IF NOT EXISTS social_notices (id ${sequence},user_id INT NOT NULL,kind VARCHAR(30) NOT NULL,title VARCHAR(300) NOT NULL,window_id VARCHAR(36),task_id VARCHAR(80),event_key VARCHAR(36) UNIQUE,is_read INT NOT NULL DEFAULT 0,created_at VARCHAR(30) NOT NULL)`,
  'CREATE TABLE IF NOT EXISTS shared_operations (user_id INT NOT NULL,operation_id VARCHAR(36) NOT NULL,request_hash VARCHAR(64) NOT NULL,result LONGTEXT NOT NULL,PRIMARY KEY(user_id,operation_id))',
  'CREATE TABLE IF NOT EXISTS shared_notice_jobs (id VARCHAR(36) PRIMARY KEY,completion_id VARCHAR(36) NOT NULL,user_id INT NOT NULL,kind VARCHAR(30) NOT NULL,title VARCHAR(300) NOT NULL,window_id VARCHAR(36) NOT NULL,task_id VARCHAR(80) NOT NULL)',
  'CREATE TABLE IF NOT EXISTS shared_fact_jobs (id VARCHAR(36) PRIMARY KEY,window_id VARCHAR(36) NOT NULL,task_id VARCHAR(80) NOT NULL,completion_id VARCHAR(36) NOT NULL,user_id INT NOT NULL,date VARCHAR(10) NOT NULL,event_id VARCHAR(36) NOT NULL,payload LONGTEXT NOT NULL,desired VARCHAR(10) NOT NULL,state VARCHAR(12) NOT NULL,created_at VARCHAR(30) NOT NULL,UNIQUE(completion_id,user_id))',
 ])await pool.query(sql+(sqlite?'':' ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'));
}
export async function socialProfile(userId:number){
 let rows=await queryRows<{friend_code:string}>('SELECT friend_code FROM social_profiles WHERE user_id = ?',[userId]);
 if(!rows.length){
  try{await pool.query('INSERT INTO social_profiles (user_id,friend_code) VALUES (?,?)',[userId,randomBytes(6).toString('hex').toUpperCase()]);}catch(error){rows=await queryRows('SELECT friend_code FROM social_profiles WHERE user_id = ?',[userId]);if(!rows.length)throw error;}
  rows=await queryRows('SELECT friend_code FROM social_profiles WHERE user_id = ?',[userId]);
 }
 const users=await queryRows<{username:string}>('SELECT username FROM users WHERE id = ?',[userId]);
 if(!users.length)throw fail('账号不存在',404);
 return {code:rows[0].friend_code,name:users[0].username};
}
async function personId(code:string){const users=await queryRows<{user_id:number}>('SELECT user_id FROM social_profiles WHERE friend_code = ?',[code.trim().toUpperCase()]);if(!users.length)throw fail('未找到这个好友码',404);return users[0].user_id;}
async function notice(users:number[],kind:string,title:string,windowId?:string,taskId?:string){
 for(const id of new Set(users)){await pool.query('INSERT INTO social_notices (user_id,kind,title,window_id,task_id,created_at) VALUES (?,?,?,?,?,?)',[id,kind,title,windowId||null,taskId||null,now()]);events.emit(String(id));}
}
async function members(windowId:string){return queryRows<Member>('SELECT user_id,role,status FROM shared_members WHERE window_id = ?',[windowId]);}
export async function requireWindow(windowId:string,userId:number,write=false,owner=false){
 uuid.parse(windowId);const [win]=await queryRows<{id:string;name:string;color:string;version:string;archived:number;owner_id:number}>('SELECT * FROM shared_windows WHERE id = ?',[windowId]);
 const member=(await members(windowId)).find(m=>m.user_id===userId&&m.status==='active');
 if(!win||win.archived||!member)throw fail('共享窗口不存在或你已不在窗口中',403);
 if(owner&&member.role!=='owner'||write&&member.role==='viewer')throw fail('当前为仅查看权限，不能修改此窗口',403);
 return {...win,role:member.role};
}
async function windowInfo(id:string,userId:number):Promise<SharedWindow>{
 const [win]=await queryRows<{id:string;name:string;color:string;version:string}>('SELECT * FROM shared_windows WHERE id = ?',[id]);
 const list=(await members(id)).filter(m=>m.status==='active'||m.status==='invited');
 return {id:win.id,name:win.name,color:win.color,version:win.version,role:list.find(m=>m.user_id===userId)!.role,members:await Promise.all(list.map(async m=>({...await socialProfile(m.user_id),role:m.role,status:m.status as 'active'|'invited'})))};
}
export async function socialSnapshot(userId:number):Promise<SocialSnapshot>{
 const profile=await socialProfile(userId);
 const pairs=await queryRows<{id:string;sender_id:number;recipient_id:number;status:string;created_at:string}>('SELECT * FROM social_friends WHERE sender_id = ? OR recipient_id = ?',[userId,userId]);
 const joins=await queryRows<{window_id:string;status:string}>('SELECT m.window_id,m.status FROM shared_members m JOIN shared_windows w ON m.window_id = w.id WHERE m.user_id = ? AND w.archived = 0 AND (m.status = ? OR m.status = ?)',[userId,'active','invited']);
 const windows=await Promise.all(joins.filter(j=>j.status==='active').map(j=>windowInfo(j.window_id,userId))),invitations=await Promise.all(joins.filter(j=>j.status==='invited').map(j=>windowInfo(j.window_id,userId)));
 const notices=await queryRows<{id:number;kind:string;title:string;window_id:string|null;task_id:string|null;is_read:number;created_at:string}>('SELECT * FROM social_notices WHERE user_id = ? ORDER BY id DESC LIMIT 100',[userId]);
 return {profile,friends:await Promise.all(pairs.filter(p=>p.status==='accepted').map(p=>socialProfile(p.sender_id===userId?p.recipient_id:p.sender_id))),requests:await Promise.all(pairs.filter(p=>p.status==='pending').map(async p=>({id:p.id,person:await socialProfile(p.sender_id===userId?p.recipient_id:p.sender_id),direction:p.sender_id===userId?'outgoing' as const:'incoming' as const,createdAt:p.created_at}))),windows,invitations,notices:notices.map(n=>({id:Number(n.id),kind:n.kind,title:n.title,windowId:n.window_id||undefined,taskId:n.task_id||undefined,read:!!n.is_read,createdAt:n.created_at})),cursor:Number(notices[0]?.id||0)};
}
export async function requestFriend(userId:number,code:string){
 const other=await personId(code);if(other===userId)throw fail('不能添加自己为好友');
 const key=[userId,other].sort((a,b)=>a-b).join(':');
 await serial('friend:'+key,()=>syncTransaction(async()=>{
  const [old]=await queryRows<{id:string;status:string}>('SELECT id,status FROM social_friends WHERE pair_key = ?',[key]);
  if(old?.status==='accepted')throw fail('已经是好友',409);
  if(old?.status==='pending')throw fail('已有待处理好友申请，请到通讯查看',409);
  if(old)await pool.query('DELETE FROM social_friends WHERE id = ?',[old.id]);
  await pool.query('INSERT INTO social_friends (id,pair_key,sender_id,recipient_id,status,created_at) VALUES (?,?,?,?,?,?)',[randomUUID(),key,userId,other,'pending',now()]);
 }));
 await notice([other],'friend',`${(await socialProfile(userId)).name} 请求添加你为好友`);events.emit(String(userId));
}
export async function respondFriend(userId:number,id:string,action:'accept'|'reject'|'withdraw'|'remove'){
 uuid.parse(id);const [r]=await queryRows<{id:string;sender_id:number;recipient_id:number;status:string}>('SELECT * FROM social_friends WHERE id = ?',[id]);
 if(!r||![r.sender_id,r.recipient_id].includes(userId))throw fail('申请不存在',404);
 if(action==='remove'){if(r.status!=='accepted')throw fail('好友关系不存在',409);}
 else if(r.status!=='pending'||(action==='withdraw'?r.sender_id!==userId:r.recipient_id!==userId))throw fail('申请已处理或无权操作',409);
 const [changed]=await pool.query('UPDATE social_friends SET status = ? WHERE id = ? AND status = ?',[action==='accept'?'accepted':action==='remove'?'removed':'rejected',id,r.status]);
 if(!(changed as {affectedRows:number}).affectedRows)throw fail('申请已由另一方处理，请刷新',409);
 await notice([r.sender_id,r.recipient_id],'friend',action==='accept'?'好友申请已通过':action==='remove'?'好友关系已解除；已有共享窗口成员关系保持':action==='withdraw'?'好友申请已撤回':'好友申请已拒绝');
}
export async function removeFriend(userId:number,code:string){const other=await personId(code);const [r]=await queryRows<{id:string}>('SELECT id FROM social_friends WHERE pair_key = ? AND status = ?',[[userId,other].sort((a,b)=>a-b).join(':'),'accepted']);if(!r)throw fail('好友关系不存在',404);await respondFriend(userId,r.id,'remove');}
export async function createWindow(userId:number,input:unknown){
 const data=metadata.parse(input),id=randomUUID();
 await syncTransaction(async()=>{await pool.query('INSERT INTO shared_windows (id,owner_id,name,color,version) VALUES (?,?,?,?,?)',[id,userId,data.name,data.color,randomUUID()]);await pool.query('INSERT INTO shared_members (window_id,user_id,role,status) VALUES (?,?,?,?)',[id,userId,'owner','active']);});
 events.emit(String(userId));return windowInfo(id,userId);
}
export async function inviteMember(windowId:string,userId:number,code:string,permission:'viewer'|'editor'){
 const win=await requireWindow(windowId,userId,false,true),other=await personId(code);role.parse(permission);
 const friendship=await queryRows('SELECT id FROM social_friends WHERE pair_key = ? AND status = ?',[[userId,other].sort((a,b)=>a-b).join(':'),'accepted']);
 if(!friendship.length)throw fail('只能邀请已同意的好友');
 await serial(windowId,()=>syncTransaction(async()=>{
  await requireWindow(windowId,userId,false,true);
  const old=(await members(windowId)).find(m=>m.user_id===other);
  if(old?.status==='active'||old?.status==='invited')throw fail('好友已加入或已有邀请',409);
  if(old)await pool.query('UPDATE shared_members SET role = ?,status = ? WHERE window_id = ? AND user_id = ?',[permission,'invited',windowId,other]);
  else await pool.query('INSERT INTO shared_members (window_id,user_id,role,status) VALUES (?,?,?,?)',[windowId,other,permission,'invited']);
 }));
 await notice([other,userId],'invitation',`邀请加入共享窗口「${win.name}」`,windowId);
}
export async function changeMember(windowId:string,userId:number,action:string,code?:string,permission?:'viewer'|'editor'){
 return serial(windowId,async()=>{
 uuid.parse(windowId);const list=await members(windowId),self=list.find(m=>m.user_id===userId);
 if(action==='accept'||action==='reject'){
  const [w]=await queryRows<{archived:number}>('SELECT archived FROM shared_windows WHERE id = ?',[windowId]);
  if(!w||w.archived||self?.status!=='invited')throw fail('邀请已失效',409);
  await pool.query('UPDATE shared_members SET status = ? WHERE window_id = ? AND user_id = ?',[action==='accept'?'active':'left',windowId,userId]);
 }else{
  await requireWindow(windowId,userId,false,action!=='leave');
  const target=action==='leave'?userId:await personId(code||'');
  const member=list.find(m=>m.user_id===target);
  if(!member||member.role==='owner')throw fail('创建者需要归档窗口，不能移除或退出');
  if(action==='role')await pool.query('UPDATE shared_members SET role = ? WHERE window_id = ? AND user_id = ?',[role.parse(permission),windowId,target]);
  else if(action==='leave'||action==='remove'){
   await pool.query('UPDATE shared_members SET status = ? WHERE window_id = ? AND user_id = ?',['left',windowId,target]);
   await pool.query('UPDATE shared_fact_jobs SET state = ? WHERE window_id = ? AND user_id = ?',['frozen',windowId,target]);
  }else throw fail('未知成员操作');
 }
 await notice(list.map(m=>m.user_id),'membership','共享窗口成员或权限已更新',windowId);
 });
}
export async function editWindow(windowId:string,userId:number,input:unknown){
 return serial(windowId,async()=>{
 const data=metadata.extend({version:z.string(),archived:z.boolean().default(false)}).parse(input);await requireWindow(windowId,userId,false,true);
 const [result]=await pool.query('UPDATE shared_windows SET name = ?,color = ?,archived = ?,version = ? WHERE id = ? AND version = ?',[data.name,data.color,data.archived?1:0,randomUUID(),windowId,data.version]);
 if(!(result as {affectedRows:number}).affectedRows)throw fail('窗口已被修改，请刷新重试',409);
 if(data.archived)await pool.query('UPDATE shared_fact_jobs SET state = ? WHERE window_id = ?',['frozen',windowId]);
 await notice((await members(windowId)).map(m=>m.user_id),'window',data.archived?'共享窗口已归档':'共享窗口信息已修改',windowId);
 });
}

const storedState=(row:StoredTask)=>{const raw=row.content.match(/<!-- shared-state:([A-Za-z0-9+/=]+) -->\s*$/)?.[1];return raw?JSON.parse(Buffer.from(raw,'base64').toString()):undefined;};
const parseTask=(row:StoredTask):Todo=>{const state=storedState(row);return state?todoSchema.parse(state.task):parseDiaryMarkdown(row.content,row.date).todos[0];};
function cleanTask(input:Todo):Todo{
 const clean=todoSchema.parse({...input,category:null,source:undefined,completion:undefined,operationId:undefined});
 if(clean.seriesTemplate)clean.seriesTemplate=cleanTask(todoSchema.parse(clean.seriesTemplate));
 if(clean.seriesChanges)clean.seriesChanges=clean.seriesChanges.map(c=>({...c,template:cleanTask(todoSchema.parse(c.template))}));
 return clean;
}
function taskContent(task:Todo,date:string,completion?:string){const doc=emptyDiary(date);doc.todos=[cleanTask(task)];return serializeDiaryMarkdown(doc)+`\n<!-- shared-state:${Buffer.from(JSON.stringify({task:doc.todos[0],completion})).toString('base64')} -->`;}
async function taskRow(win:Awaited<ReturnType<typeof requireWindow>>,stored:StoredTask,userId:number,task=parseTask(stored)){
 const completion=completionOf(stored);
 const actualJobs=completion?await queryRows<{user_id:number;date:string;event_id:string;state:string;desired:string}>('SELECT user_id,date,event_id,state,desired FROM shared_fact_jobs WHERE window_id = ? AND task_id = ? AND completion_id = ?',[win.id,task.id,completion]):[];
 const [root]=task.seriesId?await queryRows<{version:string}>('SELECT version FROM shared_tasks WHERE window_id = ? AND task_id = ?',[win.id,task.seriesId]):[];
 const own=actualJobs.find(j=>j.user_id===userId&&j.desired==='present'&&j.state!=='frozen');
 const visible=cleanTask(task);if(own?.state==='done')visible.completion={date:own.date,id:own.event_id,kind:'facts',summary:`共享日程已完成：${task.title}`};
 const restoreJobs=!completion?await queryRows('SELECT id FROM shared_fact_jobs WHERE window_id = ? AND task_id = ? AND desired = ? AND state = ?',[win.id,task.id,'absent','pending']):[];
 return {restorePending:restoreJobs.length>0,date:stored.date,version:stored.version,seriesVersion:root?.version||stored.version,task:visible,windowId:win.id,windowName:win.name,readOnly:win.role==='viewer',role:win.role,sourceExists:false,completionExists:own?.state==='done',completionPending:actualJobs.some(j=>j.state==='pending')};
}
const completionOf=(row:StoredTask)=>{const state=storedState(row);if(state)return state.completion as string|undefined;const raw=row.content.match(/<!-- shared-operation:([A-Za-z0-9+/=]+) -->\s*$/)?.[1];return raw?JSON.parse(Buffer.from(raw,'base64').toString()).completion as string|undefined:undefined;};
async function storeTask(windowId:string,date:string,task:Todo,expected?:string,completion?:string){
 const content=taskContent(task,date,completion);
 const version=hash(content);
 if(expected){const[result]=await pool.query('UPDATE shared_tasks SET content = ?,version = ? WHERE window_id = ? AND task_id = ? AND version = ?',[content,version,windowId,task.id,expected]);if(!(result as {affectedRows:number}).affectedRows)throw fail('共享日程已被其他成员修改，输入已保留，请刷新版本',409);}
 else await pool.query('INSERT INTO shared_tasks (window_id,task_id,date,content,version) VALUES (?,?,?,?,?)',[windowId,task.id,date,content,version]);
 return {window_id:windowId,task_id:task.id,date,content,version};
}
export async function listSharedTasks(userId:number,from?:string,to?:string){
 if(from)assertDate(from);if(to)assertDate(to);if(from&&to&&(from>to||(Date.parse(to)-Date.parse(from))/86400000>3660))throw fail('共享日程查询范围最多十年');
 const windows=(await socialSnapshot(userId)).windows,result=[] as Awaited<ReturnType<typeof taskRow>>[];
 for(const window of windows){
  const win=await requireWindow(window.id,userId),stored=await queryRows<StoredTask>('SELECT * FROM shared_tasks WHERE window_id = ?',[win.id]);
  const tasks=stored.map(row=>({row,task:parseTask(row)})),ids=new Set(tasks.map(t=>t.task.id));
  const checkins=new Map<string,number>();for(const {task}of tasks)if(task.done&&!task.deletedAt&&task.checkinEnabled!==false){const root=task.seriesId||(isSeries(task)?task.id:undefined);if(root)checkins.set(root,(checkins.get(root)||0)+1);}
  for(const item of tasks){
   const {task,row}=item;
   if(task.checkinEnabled===false)delete task.checkins;
   else if(isSeries(task)||task.seriesId)task.checkins=checkins.get(task.seriesId||task.id)||0;
   if(!task.occurrenceSuppressed&&(!from||((task.dueDate||task.plannedDate||'')>=from&&(task.dueDate||task.plannedDate||'')<=to!)))result.push(await taskRow(win,row,userId,task));
   if(from&&to&&isSeries(task))for(let date=from;date<=to;date=addDays(date,1)){
    if(date===task.recurrenceAnchor)continue;const occurrence=deriveOccurrence(task,date);
    if(occurrence&&!ids.has(occurrence.id))result.push(await taskRow(win,{...row,task_id:occurrence.id},userId,occurrence));
   }
  }
 }
 return result;
}
const sharedAction=z.object({mode:z.enum(['create','update','delete','purge','complete','restore','status','series']),date:z.string(),version:z.string(),seriesVersion:z.string().optional(),task:todoSchema.refine(task=>/^[a-zA-Z0-9-]+$/.test(task.id),{message:'日程编号无效',path:['id']}),operationId:uuid,nextStatus:z.enum(['todo','doing','done','cancelled']).optional(),from:z.string().optional(),stop:z.boolean().optional()});
export async function changeSharedTask(windowId:string,userId:number,body:unknown){
 const input=sharedAction.parse(body);assertDate(input.date);if(input.task.dueDate)assertDate(input.task.dueDate);if(input.task.startDate)assertDate(input.task.startDate);if(input.task.repeat?.until)assertDate(input.task.repeat.until);
 const requestHash=hash(JSON.stringify({windowId,input}));
 const result=await serial(windowId,async()=>{
  const win=await requireWindow(windowId,userId,true,input.mode==='purge');
  const [replay]=await queryRows<{request_hash:string;result:string}>('SELECT request_hash,result FROM shared_operations WHERE user_id = ? AND operation_id = ?',[userId,input.operationId]);
  if(replay){if(replay.request_hash!==requestHash)throw fail('操作编号已用于其他内容',409);return JSON.parse(replay.result);}
  return syncTransaction(async()=>{
   const [found]=await queryRows<StoredTask>('SELECT * FROM shared_tasks WHERE window_id = ? AND task_id = ?',[windowId,input.task.id]);
   let stored=found,old=stored?parseTask(stored):undefined,completion=stored?completionOf(stored):undefined;
   if(!old&&input.mode!=='create'&&input.task.seriesId&&input.task.occurrenceDate){
    const[root]=await queryRows<StoredTask>('SELECT * FROM shared_tasks WHERE window_id = ? AND task_id = ?',[windowId,input.task.seriesId]);
    const occurrence=root&&deriveOccurrence(parseTask(root),input.task.occurrenceDate);
    if(!occurrence||occurrence.id!==input.task.id||root.version!==input.version)throw fail('这期共享日程已变更，请刷新',409);
    old=occurrence;stored={...root,task_id:occurrence.id};
   }
   if(input.mode==='create'&&old)throw fail('任务编号已存在',409);
   if(input.mode!=='create'&&!old)throw fail('共享日程不存在',404);
   if(input.mode!=='create'&&stored.version!==input.version)throw fail('共享日程已由其他成员修改，输入已保留',409);
   let task=cleanTask(input.task);
   if(input.mode==='create'){
    task={...task,done:false,status:'todo',deletedAt:undefined,completedAt:undefined,seriesId:undefined,occurrenceDate:undefined,recurrenceAnchor:undefined,seriesTemplate:undefined,seriesChanges:undefined,occurrenceSuppressed:undefined,checkins:undefined};
    if(['daily','weekly','monthly'].includes(task.repeat?.type||'')){
     if(!task.dueDate)throw fail('重复日程需要截止日期');task.dueDate=firstOccurrence(task.dueDate,task.repeat);task.recurrenceAnchor=task.dueDate;task.seriesTemplate=todoSchema.parse(task);
    }
   }else if(input.mode==='update'){
    task=cleanTask({...task,done:old!.done,status:old!.status,deletedAt:old!.deletedAt,completedAt:old!.completedAt,seriesId:old!.seriesId,occurrenceDate:old!.occurrenceDate,recurrenceAnchor:old!.recurrenceAnchor,seriesChanges:old!.seriesChanges,seriesTemplate:old!.seriesTemplate});
    if(!task.seriesId&&!task.recurrenceAnchor&&['daily','weekly','monthly'].includes(task.repeat?.type||'')){if(!task.dueDate)throw fail('重复日程需要截止日期');task.dueDate=firstOccurrence(task.dueDate,task.repeat);task.recurrenceAnchor=task.dueDate;task.seriesTemplate=todoSchema.parse(task);}
   }else if(input.mode==='series'){
    const rootId=old!.seriesId||old!.id,[root]=await queryRows<StoredTask>('SELECT * FROM shared_tasks WHERE window_id = ? AND task_id = ?',[windowId,rootId]);
    const rootTask=root&&parseTask(root),from=assertDate(input.from||old!.occurrenceDate||old!.recurrenceAnchor||'');
    if(!rootTask||!isSeries(rootTask)||from<rootTask.recurrenceAnchor!)throw fail('重复系列已变更',409);
    if(root.version!==(input.seriesVersion||input.version))throw fail('系列已被其他成员修改，请重新打开编辑',409);
    if(!input.stop&&!['daily','weekly','monthly'].includes(task.repeat?.type||''))throw fail('请选择每日、每周或每月重复');
    const {seriesId,occurrenceDate,recurrenceAnchor,seriesChanges,seriesTemplate,occurrenceSuppressed,...template}=task;
    if(!input.stop){if(!template.dueDate||template.dueDate<from)throw fail('系列截止不能早于所选期次');template.dueDate=firstOccurrence(template.dueDate,template.repeat);}
    rootTask.seriesChanges=[...(rootTask.seriesChanges||[]).filter(c=>c.from<from),{from,stop:!!input.stop,template}];
    if(from===rootTask.recurrenceAnchor&&!rootTask.done)Object.assign(rootTask,template,{status:input.stop?'cancelled':'todo'});
    stored=await storeTask(windowId,root.date,rootTask,root.version,completionOf(root));task=rootTask;
    const overrides=await queryRows<StoredTask>('SELECT * FROM shared_tasks WHERE window_id = ?',[windowId]);
    for(const row of overrides){const t=parseTask(row);if(t.seriesId===rootId&&t.occurrenceDate!>=from&&!t.done&&t.status!=='cancelled'&&!t.deletedAt){const next=deriveOccurrence(rootTask,t.occurrenceDate!);await storeTask(windowId,row.date,input.stop?{...t,status:'cancelled'}:next||{...t,occurrenceSuppressed:true},row.version);}}
   }else{
    task=old!;
    const finishing=input.mode==='complete'||input.mode==='status'&&input.nextStatus==='done';
    const restoring=input.mode==='restore'||input.mode==='status'&&(input.nextStatus==='todo'||input.nextStatus==='doing');
    if(finishing&&!task.done){
     completion=input.operationId;const completedAt=now(),date=todayInTimezone(config.timezone,new Date(completedAt)),actor=await socialProfile(userId);
     const time=new Intl.DateTimeFormat('en-GB',{timeZone:config.timezone,hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(completedAt));
     task={...task,done:true,status:'done',completedAt};
     for(const member of(await members(windowId)).filter(m=>m.status==='active')){
      const id=randomUUID(),event=diaryEventSchema.parse({id,time,note:`共享日程已完成：${task.title}`,remark:[`实际完成人：${actor.name}`,`共享窗口：${win.name}`,task.description,`原定开始：${task.startDate||'未设置'} ${task.startTime||''}`].filter(Boolean).join('\n'),plannedStart:{date:task.startDate||'',time:task.startTime||''},planEntities:task.entities,tags:task.tags,people:(task.entities||[]).filter(e=>e.type==='person'),places:(task.entities||[]).filter(e=>e.type==='place'),activities:(task.entities||[]).filter(e=>e.type==='activity'),foods:(task.entities||[]).filter(e=>e.type==='food'),task:{windowId,date:stored?.date||input.date,kind:'todo',id:task.id,summary:task.title}});
      await pool.query('INSERT INTO shared_fact_jobs (id,window_id,task_id,completion_id,user_id,date,event_id,payload,desired,state,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',[randomUUID(),windowId,task.id,completion,member.user_id,date,id,JSON.stringify(event),'present','pending',completedAt]);
     }
    }else if(restoring){
     if(completion)for(const member of(await members(windowId)).filter(m=>m.status==='active'))await pool.query('UPDATE shared_fact_jobs SET desired = ?,state = ? WHERE completion_id = ? AND user_id = ? AND state <> ?',['absent','pending',completion,member.user_id,'frozen']);
     completion=undefined;task={...task,done:false,status:input.nextStatus==='doing'?'doing':'todo',completedAt:undefined,deletedAt:undefined};
    }else if(input.mode==='delete'||input.mode==='purge')task={...task,deletedAt:now(),...(input.mode==='purge'?{occurrenceSuppressed:true}:{} )};
    else if(input.mode==='status')task={...task,status:input.nextStatus||'todo'};
   }
   if(input.mode!=='series')stored=await storeTask(windowId,found?.date||input.date,task,found?.version,completion);
   const response={row:await taskRow(win,stored,userId,task)};
   await pool.query('INSERT INTO shared_operations (user_id,operation_id,request_hash,result) VALUES (?,?,?,?)',[userId,input.operationId,requestHash,JSON.stringify(response)]);
   const title=`共享日程${({create:'已新增',update:'已修改',delete:'已删除',purge:'已删除',complete:'已完成',restore:'已恢复',status:'状态已更新',series:'重复规则已更新'})[input.mode]}：${input.task.title}`.slice(0,300);
   for(const member of(await members(windowId)).filter(m=>m.status==='active'))await pool.query('INSERT INTO shared_notice_jobs (id,completion_id,user_id,kind,title,window_id,task_id) VALUES (?,?,?,?,?,?,?)',[randomUUID(),input.operationId,member.user_id,'schedule',title,windowId,input.task.id]);
   return response;
  });
 });
 try{
  await processSharedFactJobs();
  const win=await requireWindow(windowId,userId),[stored]=await queryRows<StoredTask>('SELECT * FROM shared_tasks WHERE window_id = ? AND task_id = ?',[windowId,result.row.task.id]);
  return stored?{row:await taskRow(win,stored,userId)}:result;
 }catch(error){
  if((error as {statusCode?:number}).statusCode===403)throw error;
  console.warn('[shared-followup]',{operationId:input.operationId});
  return {...result,refreshWarning:'共享日程已保存，通知或完成事实稍后自动同步'};
 }
}

let processing=false;
let diaryChanged:(userId:number)=>void=()=>{};
export async function processSharedFactJobs(){
 if(processing)return;processing=true;
 try{
  const notices=await queryRows<{id:string;user_id:number;kind:string;title:string;window_id:string;task_id:string}>('SELECT * FROM shared_notice_jobs LIMIT 100');
  for(const n of notices)try{await syncTransaction(async()=>{const pending=await queryRows('SELECT id FROM shared_notice_jobs WHERE id = ?',[n.id]);if(!pending.length)return;const delivered=await queryRows('SELECT id FROM social_notices WHERE event_key = ?',[n.id]);if(!delivered.length)await pool.query('INSERT INTO social_notices (user_id,kind,title,window_id,task_id,event_key,created_at) VALUES (?,?,?,?,?,?,?)',[n.user_id,n.kind,n.title,n.window_id,n.task_id,n.id,now()]);await pool.query('DELETE FROM shared_notice_jobs WHERE id = ?',[n.id]);});events.emit(String(n.user_id));}catch{console.warn('[shared-notice]',{jobId:n.id});}
  const jobs=await queryRows<{id:string;window_id:string;user_id:number;task_id:string;date:string;event_id:string;payload:string;desired:string}>('SELECT * FROM shared_fact_jobs WHERE state = ? ORDER BY created_at LIMIT 100',['pending']);
  for(const job of jobs)try{
   await serial(job.window_id,()=>withVaultLock(job.user_id,()=>syncTransaction(async()=>{
    const [current]=await queryRows<{state:string;desired:string}>('SELECT state,desired FROM shared_fact_jobs WHERE id = ?',[job.id]);
    if(current?.state!=='pending')return;
    const member=(await members(job.window_id)).find(m=>m.user_id===job.user_id&&m.status==='active');
    if(!member){await pool.query('UPDATE shared_fact_jobs SET state = ? WHERE id = ?',['frozen',job.id]);return;}
    const diary=await loadDiary(job.date,job.user_id),existing=diary.document.facts.events.find(e=>e.id===job.event_id);
    if(current.desired==='present'&&!existing)diary.document.facts.events.push(diaryEventSchema.parse(JSON.parse(job.payload)));
    else if(current.desired==='absent'&&existing){if(existing.task?.windowId!==job.window_id||existing.task.id!==job.task_id)throw fail('完成事实关联不一致',409);diary.document.facts.events=diary.document.facts.events.filter(e=>e.id!==job.event_id);}
    if((current.desired==='present'&&!existing)||(current.desired==='absent'&&existing))await saveDiaryUnlocked(job.date,diary.document,diary.version,job.user_id);
    await pool.query('UPDATE shared_fact_jobs SET state = ? WHERE id = ?',['done',job.id]);
   })));
   diaryChanged(job.user_id);events.emit(String(job.user_id));
  }catch(error){console.warn('[shared-fact]',{jobId:job.id,errorType:error instanceof Error?error.name:'Error'});}
 }finally{processing=false;}
}

export async function registerSocial(app:FastifyInstance,onDiaryChanged?:(userId:number)=>void){
 diaryChanged=onDiaryChanged||(()=>{});
 await ensureSocialTables();
 const retry=setInterval(()=>void processSharedFactJobs().catch(()=>{}),5000);retry.unref();app.addHook('onClose',async()=>clearInterval(retry));
 app.get('/api/social',request=>socialSnapshot(request.userId!));
 app.get('/api/shared-tasks',async request=>{const q=z.object({from:z.string().optional(),to:z.string().optional()}).parse(request.query);return {tasks:await listSharedTasks(request.userId!,q.from,q.to)};});
 app.post('/api/friends',async request=>{await requestFriend(request.userId!,z.object({code:z.string().trim().min(1).max(16)}).parse(request.body).code);return {ok:true};});
 app.post('/api/friends/:id/respond',async request=>{const {id}=request.params as {id:string};await respondFriend(request.userId!,id,z.object({action:z.enum(['accept','reject','withdraw'])}).parse(request.body).action);return {ok:true};});
 app.delete('/api/friends/:code',async request=>{await removeFriend(request.userId!,(request.params as {code:string}).code);return {ok:true};});
 app.post('/api/shared-windows',async request=>({window:await createWindow(request.userId!,request.body)}));
 app.patch('/api/shared-windows/:id',async request=>{await editWindow((request.params as {id:string}).id,request.userId!,request.body);return {ok:true};});
 app.post('/api/shared-windows/:id/invite',async request=>{const data=z.object({code:z.string(),role:role.default('viewer')}).parse(request.body);await inviteMember((request.params as {id:string}).id,request.userId!,data.code,data.role);return {ok:true};});
 app.post('/api/shared-windows/:id/members',async request=>{const data=z.object({action:z.enum(['accept','reject','leave','remove','role']),code:z.string().optional(),role:role.optional()}).parse(request.body);await changeMember((request.params as {id:string}).id,request.userId!,data.action,data.code,data.role);return {ok:true};});
 app.post('/api/shared-windows/:id/actions',request=>changeSharedTask((request.params as {id:string}).id,request.userId!,request.body));
 app.post('/api/social/read',async request=>{const {through}=z.object({through:z.number().int().nonnegative()}).parse(request.body);await pool.query('UPDATE social_notices SET is_read = 1 WHERE user_id = ? AND id <= ?',[request.userId!,through]);events.emit(String(request.userId!));return {ok:true};});
 app.get('/api/social/events',async(request,reply)=>{
  reply.hijack();reply.raw.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache','Connection':'keep-alive','X-Accel-Buffering':'no'});
  const userId=request.userId!,send=()=>{if(!reply.raw.destroyed)reply.raw.write('event: change\ndata: {}\n\n');};
  events.on(String(userId),send);send();
  const heartbeat=setInterval(()=>{void(async()=>{const token=getSessionToken(request);if(token&&await verifySession(token)!==userId){reply.raw.end();return;}if(!reply.raw.destroyed)reply.raw.write(': heartbeat\n\n');})().catch(()=>reply.raw.end());},20000);
  request.raw.on('close',()=>{clearInterval(heartbeat);events.off(String(userId),send);});
 });
 if(config.demoDatabase&&config.host==='127.0.0.1'){
  for(const name of ['演示好友小林','演示好友小周']){const [existing]=await queryRows('SELECT id FROM users WHERE username = ?',[name]);if(!existing)await pool.query('INSERT INTO users (username,password_hash) VALUES (?,?)',[name,'disabled']);}
  app.get('/api/demo/accounts',async()=>({accounts:await Promise.all((await queryRows<{id:number}>('SELECT id FROM users ORDER BY id')).map(u=>socialProfile(u.id)))}));
  app.post('/api/demo/account',async(request,reply)=>{const {code}=z.object({code:z.string()}).parse(request.body);const userId=await personId(code);setSessionCookie(reply,await createSession(userId));return socialProfile(userId);});
 }
}
