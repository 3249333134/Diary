import { z } from 'zod';
import { todoSchema, type Todo } from '@diary/contracts';
import { listActions } from './actions.js';
import { addDays, assertDate } from './date.js';
import { deriveOccurrence, isSeries, firstOccurrence } from './recurrence.js';
import { loadDiary, saveDiaryUnlocked, withVaultLock, readJson } from './vault.js';
import { autoJournalPath } from './autoCompletion.js';

export const scheduleQuery = z.object({from:z.string(),to:z.string(),cursor:z.string().optional(),limit:z.coerce.number().int().min(1).max(200).default(200)});
export async function listSchedule(query:z.infer<typeof scheduleQuery>,userId:number) {
  const from=assertDate(query.from),to=assertDate(query.to);
  if(from>to || (Date.parse(to)-Date.parse(from))/86400000>36600)throw Object.assign(new Error('请选择有效日期范围（最多100年）'),{statusCode:400});
  const data=await listActions(userId),materialized=new Map(data.tasks.map(r=>[r.task.id,r]));
  const roots=data.tasks.filter(r=>isSeries(r.task)),items=[] as typeof data.tasks;
  for(const row of data.tasks) if(!row.task.occurrenceSuppressed&&!isSeries(row.task) && (row.task.dueDate||row.task.plannedDate||'')>=from && (row.task.dueDate||row.task.plannedDate||'')<=to) items.push(row);
  for(const root of roots) for(let date=from;date<=to;date=addDays(date,1)) {
    const task=deriveOccurrence(root.task,date);if(!task)continue;
    // The stored root is also the first occurrence; later overrides always win.
    if(date===root.task.recurrenceAnchor && !root.task.seriesChanges?.some(c=>c.from<=date)) {
      if(root.task.dueDate>=from&&root.task.dueDate<=to)items.push(root);
    } else if(date!==root.task.recurrenceAnchor&&!materialized.has(task.id)&&!(root.task.dueDate===date&&root.task.seriesChanges?.some(c=>c.from===root.task.recurrenceAnchor)))items.push({...root,task,completionExists:false,completionPending:false,pendingRecord:undefined,pendingFact:undefined,restorePending:false});
  }
  // Root may have been moved outside its anchor day.
  for(const root of roots) if(root.task.dueDate>=from&&root.task.dueDate<=to&&!items.some(r=>r.task.id===root.task.id))items.push(root);
  items.sort((a,b)=>(a.task.dueDate+':'+a.task.id).localeCompare(b.task.dueDate+':'+b.task.id));
  const after=query.cursor?items.filter(r=>(r.task.dueDate+':'+r.task.id)>query.cursor!):items;
  const tasks=after.slice(0,query.limit),last=tasks.at(-1);
  await Promise.all(tasks.filter(r=>r.task.seriesId&&!materialized.has(r.task.id)).map(async row=>{
    const journal=await readJson<{phase:string}|null>(autoJournalPath(row.date,row.task.id),null,userId);
    row.completionPending=journal?.phase==='prepared';
  }));
  return {tasks,nextCursor:after.length>query.limit&&last?last.task.dueDate+':'+last.task.id:undefined,from,to};
}

export const seriesRequest=z.object({date:z.string(),version:z.string(),task:todoSchema,from:z.string(),stop:z.boolean().default(false)});
export async function updateSeries(input:z.infer<typeof seriesRequest>,userId:number) {
  assertDate(input.date);assertDate(input.from);
  return withVaultLock(userId,async()=>{
    const current=await loadDiary(input.date,userId);
    if(current.version!==input.version)throw Object.assign(new Error('重复系列已变化，请刷新后重试，输入仍保留。'),{statusCode:409});
    const root=current.document.todos.find(t=>t.id===(input.task.seriesId||input.task.id));
    if(!root||!isSeries(root)||input.from<root.recurrenceAnchor!)throw Object.assign(new Error('重复系列不存在或日期无效'),{statusCode:409});
    if(!input.stop&&!['daily','weekly','monthly'].includes(input.task.repeat?.type||''))throw Object.assign(new Error('请选择每日、每周或每月；停止请使用停止系列'),{statusCode:400});
    if(input.task.startDate)assertDate(input.task.startDate);
    if(input.task.repeat?.until)assertDate(input.task.repeat.until);
    const {seriesId,occurrenceDate,recurrenceAnchor,seriesChanges,seriesTemplate,occurrenceSuppressed,...template}=input.task;
    if(!input.stop){
      if(!template.dueDate||template.dueDate<input.from)throw Object.assign(new Error('系列首次截止日期不能早于所选期次；提前请仅修改这一期'),{statusCode:400});
      template.dueDate=firstOccurrence(template.dueDate,template.repeat);
    }
    root.seriesChanges=[...(root.seriesChanges||[]).filter(c=>c.from<input.from),{from:input.from,stop:input.stop,template}];
    if(input.from===root.recurrenceAnchor && !root.done) {
      Object.assign(root,template,{id:root.id,recurrenceAnchor:root.recurrenceAnchor,status:input.stop?'cancelled':'todo'});
    }
    // Keep completed history; remove only future, untouched generated overrides.
    for(const task of current.document.todos) if(task.seriesId===root.id && task.occurrenceDate!>=input.from && !task.done && task.status!=='cancelled' && !task.deletedAt) {
      const next=deriveOccurrence(root,task.occurrenceDate!);
      if(input.stop)task.status='cancelled';
      else if(next)Object.assign(task,next);
      else task.occurrenceSuppressed=true;
    }
    return {diary:await saveDiaryUnlocked(input.date,current.document,current.version,userId)};
  });
}
