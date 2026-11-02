import type {FastifyInstance} from 'fastify';
import {z} from 'zod';
import {searchTerms,normalizeSearch,createSearchMatcher,displayScheduleSpan,type SearchResult,type SearchResponse,type DiaryResponse,type TaggedEntity,type RecordRef,type SearchScope} from '@diary/contracts';
import {queryRows} from './db.js';
import {loadDiary} from './vault.js';
import {listSharedTasks} from './social.js';
import {listSchedule} from './schedule.js';
import {taskSpan} from './scheduleSpan.js';
import {memoryDocument} from './personalMemory.js';
import {getPlanCategories} from './planSettings.js';

type Indexed={result:SearchResult;body:string;entities:TaggedEntity[]};
const documents=new Map<number,Map<string,{version:string;value:DiaryResponse;items:Indexed[]}>>();
const querySchema=z.object({q:z.string().trim().max(400).default(''),scope:z.enum(['all','todo','diary']).default('all'),limit:z.coerce.number().int().min(1).max(100).default(60),offset:z.coerce.number().int().min(0).default(0)});
function taskItem(row:NonNullable<SearchResult['row']>):Indexed{
 const task=row.task,entities=task.entities||[],date=task.dueDate||task.plannedDate||row.date;
 return {result:{ref:{date:row.date,kind:'todo',id:task.id,summary:task.title.slice(0,2000),windowId:row.windowId},date,title:task.title,excerpt:task.description.slice(0,180),tags:task.tags||[],people:entities.filter(e=>e.type==='person').map(e=>e.name),windowName:row.windowName,row},body:[task.title,task.description,...task.subtasks.map(s=>s.title),task.list,task.startDate,task.startTime,task.dueDate,task.dueTime,...entities.flatMap(e=>[e.name,...e.tags])].filter(Boolean).join('\n'),entities};
}
function documentItems(saved:DiaryResponse):Indexed[]{
 const document=saved.document,date=document.date,items:Indexed[]=[];
 const information=[document.facts.note,document.weather,document.sleep,document.mood].filter(Boolean).join('\n');if(information)items.push({result:{ref:{date,kind:'facts',id:'day-information',summary:'今日信息与备注'},information:true,date,title:'今日信息与备注',excerpt:information.slice(0,180),tags:[],people:[]},body:information,entities:[]});
 for(const event of document.facts.events){const entities=[...event.people,...event.places,...event.activities,...event.foods],body=[event.note,event.remark,event.time,event.location?.name,...entities.flatMap(e=>[e.name,...e.tags])].filter(Boolean).join('\n');items.push({result:{ref:{date,kind:'facts',id:event.id,summary:event.note.slice(0,2000)},date,title:event.note||'事件记录',excerpt:event.remark.slice(0,180),tags:event.tags||[],people:event.people.map(e=>e.name)},body,entities});}
 for(const kind of ['learn','input','idea'] as const)for(const entry of document.entries?.[kind]||[]){items.push({result:{ref:{date,kind,id:entry.id,summary:entry.content.slice(0,2000)},date,title:entry.content.split('\n')[0].slice(0,200),excerpt:entry.content.slice(0,180),tags:entry.tags,people:entry.sources.filter(e=>e.type==='person').map(e=>e.name)},body:[entry.content,...entry.sources.flatMap(e=>[e.name,...e.tags])].join('\n'),entities:entry.sources});}
 for(const task of document.todos.filter(t=>!t.deletedAt&&!t.occurrenceSuppressed)){items.push(taskItem({date,version:saved.version,task,span:taskSpan(task,document.todos.find(t=>t.id===task.seriesId)),sourceExists:!!task.source,completionExists:!!task.completion}));}
 return items;
}
async function privateItems(userId:number):Promise<Indexed[]>{
 const versions=await queryRows<{date:string;version:string}>('SELECT date,version FROM diaries WHERE user_id = ? ORDER BY date',[userId]);
 const cache=documents.get(userId)||new Map<string,{version:string;value:DiaryResponse;items:Indexed[]}>();documents.delete(userId);documents.set(userId,cache);if(documents.size>8)documents.delete(documents.keys().next().value!);
 const dates=new Set(versions.map(r=>r.date));for(const date of cache.keys())if(!dates.has(date))cache.delete(date);
 await Promise.all(versions.map(async row=>{if(cache.get(row.date)?.version===row.version)return;const value=await loadDiary(row.date,userId);cache.set(row.date,{version:row.version,value,items:documentItems(value)});}));
 return versions.flatMap(row=>cache.get(row.date)?.items||[]);
}
export async function searchRecords(userId:number,input:{q:string;scope?:SearchScope;limit?:number;offset?:number}):Promise<SearchResponse>{
 const query=querySchema.parse(input);if(!query.q)return{items:[],total:0};
 const terms=searchTerms(query.q),match=createSearchMatcher(query.q);if(terms.some(term=>!term.value))return{items:[],total:0};const [privateRows,sharedRows,personal,categories]=await Promise.all([privateItems(userId),listSharedTasks(userId),memoryDocument(userId),getPlanCategories(userId)]);
 let items=[...privateRows,...sharedRows.filter(row=>!row.task.deletedAt&&!row.task.occurrenceSuppressed).map(taskItem)];
 const date=terms.find(t=>t.field==='date'&&/^\d{4}-\d{2}-\d{2}$/.test(t.value))?.value;
 if(date){const {tasks}=await listSchedule({from:date,to:date,limit:200},userId);const ids=new Set(items.map(item=>(item.result.ref.windowId||'private')+':'+item.result.ref.id));for(const row of tasks)if(!row.task.deletedAt&&!row.task.occurrenceSuppressed&&!ids.has('private:'+row.task.id))items.push(taskItem(row));const shared=await listSharedTasks(userId,date,date);for(const row of shared)if(!row.task.deletedAt&&!row.task.occurrenceSuppressed&&!ids.has(row.windowId+':'+row.task.id))items.push(taskItem(row));}
 const people=personal.document.records.filter(m=>m.kind==='person'&&m.enabled),categoryNames=new Map(categories.map(category=>[category.id,category.name]));
 const ranked=items.flatMap(item=>{
  const result=item.result,task=result.ref.kind==='todo',span=result.row?displayScheduleSpan(result.row.task,result.row.span):undefined;if(query.scope==='todo'&&!task||query.scope==='diary'&&task)return[];
  // Resolve visible labels at query time: settings may change while the diary version stays the same.
  const categoryName=task&&!result.ref.windowId?(categoryNames.get(result.row!.task.category||'')||'待分类'):undefined;
  const aliases=item.entities.filter(e=>e.type==='person').flatMap(entity=>people.filter(m=>entity.personId===m.id||!!result.ref.windowId&&entity.name===m.label).flatMap(m=>[m.label,...m.aliases]));
  const score=match({kind:result.ref.kind,title:result.title,body:item.body,date:result.date,ownerDate:result.ref.date,tags:result.tags,people:result.people,aliases,entities:item.entities,categoryName,windowName:result.windowName,shared:!!result.ref.windowId,information:result.information,start:span?.start,end:span?.end});if(score===undefined)return[];
  const textTerm=terms.find(t=>t.field==='text'||t.field==='task'||t.field==='event')?.value,at=textTerm?normalizeSearch(item.body).indexOf(textTerm):-1;
  return [{result:{...result,categoryName,excerpt:at>=0?item.body.slice(Math.max(0,at-35),at+145):result.excerpt},score}];
 });
 ranked.sort((a,b)=>b.score-a.score||b.result.date.localeCompare(a.result.date)||a.result.ref.id.localeCompare(b.result.ref.id));
 return {items:ranked.slice(query.offset,query.offset+query.limit).map(row=>row.result),total:ranked.length,...query.offset+query.limit<ranked.length?{nextOffset:query.offset+query.limit}:{}};
}
export function registerSearch(app:FastifyInstance){app.get('/api/search',request=>searchRecords(request.userId!,querySchema.parse(request.query)));}
