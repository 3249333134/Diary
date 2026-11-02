import {beforeAll,afterAll,it,expect,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import {emptyDiary,diaryEventSchema,todoSchema,personalMemorySchema,textEntrySchema,projectEntries} from '@diary/contracts';
const {memoryRequest}=vi.hoisted(()=>({memoryRequest:vi.fn()}));
vi.mock('undici',()=>({request:memoryRequest,ProxyAgent:class{}}));
vi.mock('./config.js',async()=>{const original=await vi.importActual<any>('./config.js');return {...original,config:{...original.config,ai:{...original.config.ai,key:''}}};});
vi.mock('./db.js',async()=>{const {createDemoPool}=await import('./demoDatabase.js');const pool=createDemoPool(':memory:');return {pool,queryRows:async(sql:string,args:unknown[]=[])=> (await pool.query(sql,args))[0]};});
import {config} from './config.js';
import {pool,queryRows} from './db.js';
import {ensureMemoryTables,memorySnapshot,memoryOperation,processMemoryJobs,extractExplicitMemories} from './personalMemory.js';
import {saveDiary,loadDiary} from './vault.js';
import {projectSchedule,taskSpan} from './scheduleSpan.js';
import {deriveOccurrence,occurrenceId} from './recurrence.js';
import {changeAction} from './actions.js';
beforeAll(async()=>{await ensureMemoryTables();vi.useFakeTimers();vi.setSystemTime(new Date('2026-11-01T10:00:00Z'));});
afterAll(async()=>{vi.useRealTimers();await pool.end();});
it('isolates account documents, enforces versions and replays stable operation IDs',async()=>{
 const initial=await memorySnapshot(1),record=personalMemorySchema.parse({id:randomUUID(),kind:'time',key:'offWork',label:'下班时间',value:'18:00'}),input={version:initial.version,operationId:randomUUID(),action:'upsert',record};
 const saved=await memoryOperation(1,input);expect(saved.records).toHaveLength(1);expect(await memoryOperation(1,input)).toEqual(saved);expect((await memorySnapshot(2)).records).toHaveLength(0);
 await expect(memoryOperation(1,{...input,operationId:randomUUID(),record:{...record,value:'19:00'}})).rejects.toMatchObject({statusCode:409});
});
it('coalesces auto saves for five seconds, analyzes latest private text and never extracts linked completion facts',async()=>{
 const doc=emptyDiary('2026-11-01');doc.facts.events=[diaryEventSchema.parse({id:randomUUID(),note:'我工作日18点下班'})];
 let saved=await saveDiary(doc.date,doc,'0',1,{analyze:true});
 saved.document.facts.events[0].note='我工作日19点下班';saved=await saveDiary(doc.date,saved.document,saved.version,1,{analyze:true});
 expect((await memorySnapshot(1)).pending).toBe(1);await processMemoryJobs();expect((await memorySnapshot(1)).candidates).toHaveLength(0);
 vi.setSystemTime(new Date(Date.now()+5001));await processMemoryJobs();let snapshot=await memorySnapshot(1);expect(snapshot.candidates.map(c=>c.record.value)).toEqual(['19:00']);
 const candidate=snapshot.candidates[0];snapshot=await memoryOperation(1,{action:'confirm',version:snapshot.version,operationId:randomUUID(),id:candidate.id});expect(snapshot.records.find(m=>m.value==='19:00')?.weekdays).toEqual([1,2,3,4,5]);
 const completed=await loadDiary(doc.date,1);completed.document.facts.events.push(diaryEventSchema.parse({id:randomUUID(),note:'我每天22点下班',task:{date:doc.date,kind:'todo',id:randomUUID(),summary:'完成计划'}}));
 await saveDiary(doc.date,completed.document,completed.version,1,{analyze:true});expect((await memorySnapshot(1)).pending).toBe(0);
});
it('discards stale analysis, supports failures and explicit retry without changing saved diaries',async()=>{
 const doc=emptyDiary('2026-11-02');doc.facts.events=[diaryEventSchema.parse({id:randomUUID(),note:'我每天8点上班'})];const saved=await saveDiary(doc.date,doc,'0',1,{analyze:true});
 const original=pool.query.bind(pool),spy=vi.spyOn(pool,'query').mockImplementation(async(sql:any,args:any)=>{if(String(sql).startsWith('INSERT INTO settings'))throw new Error('simulated analysis write failure');return original(sql,args) as any;});
 for(let i=0;i<3;i++){vi.setSystemTime(new Date(Date.now()+60000));await processMemoryJobs();}spy.mockRestore();
 expect((await memorySnapshot(1)).failed).toBe(1);expect((await loadDiary(doc.date,1)).version).toBe(saved.version);
 let snapshot=await memorySnapshot(1);await memoryOperation(1,{action:'retry',version:snapshot.version,operationId:randomUUID()});await processMemoryJobs();expect((await memorySnapshot(1)).failed).toBe(0);
 const current=await loadDiary(doc.date,1);current.document.facts.events[0].note='我每天9点上班';await saveDiary(doc.date,current.document,current.version,1,{analyze:true});
 // A deletion in the meantime invalidates the queued evidence even when no replacement job is added.
 const latest=await loadDiary(doc.date,1);latest.document.facts.events=[];await saveDiary(doc.date,latest.document,latest.version,1,{analyze:true});vi.setSystemTime(new Date(Date.now()+6000));await processMemoryJobs();
 expect((await memorySnapshot(1)).candidates.some(c=>c.record.value==='09:00')).toBe(false);
});
it('keeps day overtime as a dated candidate and excludes other people from self habits',()=>{
 expect(extractExplicitMemories('今天加班到20点，下班后健身',{kind:'ai',date:'2026-11-01'})[0].record).toMatchObject({key:'offWork',value:'20:00',date:'2026-11-01'});
 expect(extractExplicitMemories('小王每天18点下班',{kind:'ai'})).toHaveLength(0);
});
it('assigns server creation time once, permits unscheduled repeating rules, activates on first deadline',async()=>{
 const task=todoSchema.parse({id:randomUUID(),title:'下班后健身',startDate:'2026-11-03',startTime:'18:00',createdAt:'1999-01-01T00:00:00Z',repeat:{type:'daily'}}),date='2026-11-03',operationId=randomUUID();
 const saved=await changeAction({mode:'create',date,version:'0',task,operationId},1),created=saved.diary.document.todos[0];expect(created.createdAt).not.toBe(task.createdAt);expect(created.recurrenceAnchor).toBeUndefined();
 const retry=await changeAction({mode:'create',date,version:'0',task,operationId},1);expect(retry.diary.document.todos[0].createdAt).toBe(created.createdAt);
 const updated=await changeAction({mode:'update',date,version:saved.diary.version,task:{...created,dueDate:'2026-11-05',dueTime:'19:00',createdAt:task.createdAt},operationId:randomUUID()},1);
 expect(updated.diary.document.todos[0]).toMatchObject({createdAt:created.createdAt,recurrenceAnchor:'2026-11-05'});
});
it('queries interval overlap outside both deadline boundaries and keeps recurring starts on rule dates',()=>{
 const ordinary=todoSchema.parse({id:randomUUID(),title:'跨年持续',createdAt:'2026-12-30T15:00:00Z',dueDate:'2027-01-03',dueTime:'20:00'});
 expect(projectSchedule([{task:ordinary}],'2027-01-01','2027-01-01')).toHaveLength(1);
 const root=todoSchema.parse({id:randomUUID(),title:'每周',createdAt:'2026-10-01T00:00:00Z',dueDate:'2026-10-05',dueTime:'18:00',repeat:{type:'weekly'},recurrenceAnchor:'2026-10-05'});
 const occurrence=deriveOccurrence(root,'2026-10-12')!,moved={...occurrence,dueDate:'2026-10-14'};
 expect(taskSpan(moved,root)).toMatchObject({start:'2026-10-05T18:00',end:'2026-10-14T18:00'});
 expect(taskSpan(deriveOccurrence(root,'2026-10-19')!,root)?.start).toBe('2026-10-12T18:00');
 const rows=projectSchedule([{task:root},{task:moved}],'2026-10-08','2026-10-08');expect(rows.filter(row=>row.task.id===occurrenceId(root.id,'2026-10-12'))).toHaveLength(1);
});

it('rejects confirmation of old evidence and ignores a declined candidate across later saves',async()=>{
 const doc=emptyDiary('2026-11-07');doc.facts.events=[diaryEventSchema.parse({id:randomUUID(),note:'我周末17点下班'})];let saved=await saveDiary(doc.date,doc,'0',1,{analyze:true});vi.setSystemTime(new Date(Date.now()+6000));await processMemoryJobs();
 const snapshot=await memorySnapshot(1),candidate=snapshot.candidates.find(c=>c.record.value==='17:00')!;expect(candidate).toBeTruthy();saved.document.facts.events[0].note='我周末16点下班';saved=await saveDiary(doc.date,saved.document,saved.version,1,{analyze:true});
 expect((await memorySnapshot(1)).candidates.some(c=>c.id===candidate.id)).toBe(false);await expect(memoryOperation(1,{action:'confirm',version:snapshot.version,id:candidate.id,operationId:randomUUID()})).rejects.toMatchObject({statusCode:409});
 vi.setSystemTime(new Date(Date.now()+6000));await processMemoryJobs();let next=await memorySnapshot(1);const declined=next.candidates.find(c=>c.record.value==='16:00')!;next=await memoryOperation(1,{action:'ignore',version:next.version,id:declined.id,operationId:randomUUID()});
 saved.document.facts.events[0].note='我周末16点下班。今天散步';await saveDiary(doc.date,saved.document,saved.version,1,{analyze:true});vi.setSystemTime(new Date(Date.now()+6000));await processMemoryJobs();expect((await memorySnapshot(1)).candidates.some(c=>c.fingerprint===declined.fingerprint)).toBe(false);
});

it('applies a one-use choice only to the same dated evidence without storing a long-term record',async()=>{
 const candidate=extractExplicitMemories('我每天21点睡觉',{kind:'ai',date:'2026-11-08'})[0],snapshot=await memorySnapshot(1),result=await memoryOperation(1,{action:'once',version:snapshot.version,operationId:randomUUID(),candidate});
 expect(result.records.some(m=>m.key==='sleep')).toBe(false);const {ignoredMemoryCandidate}=await import('./memoryExtraction.js'),{document}=await import('./personalMemory.js').then(m=>m.memoryDocument(1));expect(ignoredMemoryCandidate(document.ignored,candidate)).toBe(true);expect(ignoredMemoryCandidate(document.ignored,{...candidate,record:{...candidate.record,source:{...candidate.record.source,date:'2026-11-09'}}})).toBe(false);
});

it('analyzes every chunk of a long newly saved record without truncating its stored body',async()=>{
 const original=config.ai.key,received:string[]=[],body='甲'.repeat(24000)+'。我每天22点睡觉';Object.assign(config.ai,{key:'test'});
 memoryRequest.mockImplementation(async(_url,options)=>{const text=JSON.parse(JSON.parse(options.body).messages.at(-1).content).text;received.push(text);return{statusCode:200,body:{json:async()=>({choices:[{message:{content:JSON.stringify({memories:[]})}}]})}};});
 try{const doc=emptyDiary('2026-11-10');doc.entries={learn:[],input:[],idea:[textEntrySchema.parse({id:randomUUID(),content:body})]};const saved=await saveDiary(doc.date,projectEntries(doc),'0',1,{analyze:true});vi.setSystemTime(new Date(Date.now()+6000));await processMemoryJobs();expect(received).toEqual([body.slice(0,10000),body.slice(9000,19000),body.slice(18000,28000)]);expect((await loadDiary(doc.date,1)).document.entries!.idea[0].content).toBe(body);expect((await loadDiary(doc.date,1)).version).toBe(saved.version);expect((await memorySnapshot(1)).candidates.some(c=>c.record.value==='22:00')).toBe(true);}finally{Object.assign(config.ai,{key:original});}
});
it('discards an analysis already in flight when a newer record version is saved',async()=>{
 const original=config.ai.key;Object.assign(config.ai,{key:'test'});let release:(value:unknown)=>void=()=>{},started:()=>void=()=>{};const waiting=new Promise<void>(resolve=>started=resolve),response={statusCode:200,body:{json:async()=>({choices:[{message:{content:'{"memories":[]}'}}]})}};
 memoryRequest.mockImplementationOnce(()=>{started();return new Promise(resolve=>release=resolve);});
 try{const doc=emptyDiary('2026-11-11');doc.facts.events=[diaryEventSchema.parse({id:randomUUID(),note:'我每天07:00起床'})];let saved=await saveDiary(doc.date,doc,'0',1,{analyze:true});vi.setSystemTime(new Date(Date.now()+6000));const processing=processMemoryJobs();await waiting;saved.document.facts.events[0].note='我每天08:30起床';await saveDiary(doc.date,saved.document,saved.version,1,{analyze:true});release(response);await processing;expect((await memorySnapshot(1)).candidates.some(c=>c.record.key==='wake'&&c.record.value==='07:00')).toBe(false);memoryRequest.mockResolvedValue(response);vi.setSystemTime(new Date(Date.now()+6000));await processMemoryJobs();expect((await memorySnapshot(1)).candidates.some(c=>c.record.key==='wake'&&c.record.value==='08:30')).toBe(true);}finally{Object.assign(config.ai,{key:original});}
});
