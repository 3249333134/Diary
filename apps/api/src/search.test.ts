import {beforeAll,afterAll,it,expect,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import {emptyDiary,diaryEventSchema,textEntrySchema,todoSchema,projectEntries,personalMemorySchema,searchTerms,type PlanCategory} from '@diary/contracts';
vi.mock('./db.js',async()=>{const {createDemoPool}=await import('./demoDatabase.js');const pool=createDemoPool(':memory:');return {pool,queryRows:async(sql:string,args:unknown[]=[])=> (await pool.query(sql,args))[0]};});
import {pool} from './db.js';
import * as vault from './vault.js';
import {addPlanCategory} from './planSettings.js';
import {vaultPaths} from './config.js';
import {searchRecords} from './search.js';
import {ensureMemoryTables,memoryOperation,memorySnapshot} from './personalMemory.js';
import {ensureSocialTables,socialProfile,socialSnapshot,requestFriend,respondFriend,createWindow,inviteMember,changeMember,changeSharedTask} from './social.js';
const customId='cat-'+randomUUID(),personId=randomUUID(),date='2026-11-01';let windowId='';
beforeAll(async()=>{
 await ensureSocialTables();await ensureMemoryTables();await pool.query('INSERT INTO users (id,username,password_hash) VALUES (?,?,?)',[2,'另一个账号','disabled']);
 const profile=personalMemorySchema.parse({id:personId,kind:'person',key:'李明',label:'李明',value:'同事',aliases:['小李'],tags:['同事']});await memoryOperation(1,{action:'upsert',record:profile,version:(await memorySnapshot(1)).version,operationId:randomUUID()});
 const document=emptyDiary(date);document.facts.note='今天对项目的新想法，准备长期学习';document.facts.events=[diaryEventSchema.parse({id:randomUUID(),note:'和李明一起跑步',remark:'沿河边训练',tags:['运动'],places:[{type:'place',name:'滨江公园',tags:['户外']}],activities:[{type:'activity',name:'跑步',tags:[]}],people:[{type:'person',name:'李明',personId,tags:['同事']}]}),diaryEventSchema.parse({id:randomUUID(),note:'旧姓名记录',people:[{type:'person',name:'李明',tags:['同学']}]})];
 document.entries={learn:[textEntrySchema.parse({id:randomUUID(),content:'读完性能调优书\n学习减少重复请求',tags:['学习'],sources:[{type:'person',name:'陈老师',tags:[]}]})],input:[],idea:[]};document.todos=[todoSchema.parse({id:randomUUID(),title:'准备项目评审',category:'work',description:'整理客户需求',tags:['项目A'],createdAt:'2026-10-31T00:00:00Z',dueDate:'2026-11-03',dueTime:'18:00'}),todoSchema.parse({id:randomUUID(),title:'每日健身',category:'personal',dueDate:date,dueTime:'20:00',repeat:{type:'daily'},recurrenceAnchor:date,createdAt:'2026-10-31T00:00:00Z'})];await vault.saveDiary(date,projectEntries(document),'0',1);
 await addPlanCategory({name:'天文观察',color:'#7561bd'},1,customId);await addPlanCategory({name:'园艺维护',color:'#447766'},2,customId);
 const custom=emptyDiary('2026-11-05');custom.todos=[todoSchema.parse({id:randomUUID(),title:'周五晚间安排',category:customId})];await vault.saveDiary(custom.date,custom,'0',1);
 const other=emptyDiary(date);other.todos=[todoSchema.parse({id:randomUUID(),title:'周六上午安排',category:customId})];other.facts.events=[diaryEventSchema.parse({id:randomUUID(),note:'另一账号的秘密'})];await vault.saveDiary(date,other,'0',2);
 await requestFriend(1,(await socialProfile(2)).code);await respondFriend(2,(await socialSnapshot(2)).requests[0].id,'accept');const window=await createWindow(1,{name:'共同运动',color:'#7561bd'});windowId=window.id;await inviteMember(windowId,1,(await socialProfile(2)).code,'viewer');await changeMember(windowId,2,'accept');
 await changeSharedTask(windowId,1,{mode:'create',date,version:'0',operationId:randomUUID(),task:todoSchema.parse({id:randomUUID(),title:'共同跑步',tags:['运动'],entities:[{type:'person',name:'李明',personId,tags:['同事']}],dueDate:'2026-11-03',dueTime:'18:00'})});
});
afterAll(()=>pool.end());
it('parses plain text, quoted phrases, tags and Chinese/English field names',()=>expect(searchTerms('#运动 人物:小李 task:"项目 评审" 事件：跑步')).toEqual([{field:'tag',value:'运动'},{field:'person',value:'小李'},{field:'task',value:'项目 评审'},{field:'event',value:'跑步'}]));
it('accepts spaces after field prefixes without losing the filter',()=>expect(searchTerms('人物: 小李 标签： 运动')).toEqual([{field:'person',value:'小李'},{field:'tag',value:'运动'}]));
it('combines fields, searches full text and separates diary/task scopes',async()=>{
 const result=await searchRecords(1,{q:'#运动 人物:小李'});expect(result.items.some(item=>item.ref.kind==='facts')).toBe(true);expect(result.items.some(item=>item.title==='旧姓名记录')).toBe(false);
 expect((await searchRecords(1,{q:'标签:学习'})).items[0].title).toContain('性能调优');expect((await searchRecords(1,{q:'人物:陈老师'})).items[0].ref.kind).toBe('learn');expect((await searchRecords(1,{q:'任务:评审 #项目A'})).items[0].title).toBe('准备项目评审');expect((await searchRecords(1,{q:'任务:项目A'})).items[0].title).toBe('准备项目评审');expect((await searchRecords(1,{q:'事件:运动'})).items[0].ref.kind).toBe('facts');expect((await searchRecords(1,{q:'事件:跑步'})).items.every(item=>item.ref.kind==='facts')).toBe(true);expect((await searchRecords(1,{q:'跑步',scope:'diary'})).items.every(item=>item.ref.kind==='facts')).toBe(true);
});
it('never exposes another account and immediately removes revoked shared results without leaking private profile IDs',async()=>{
 expect((await searchRecords(1,{q:'秘密'})).total).toBe(0);expect((await searchRecords(2,{q:'秘密'})).total).toBe(1);
 const shared=(await searchRecords(2,{q:'共同跑步'})).items[0];expect(shared.row?.readOnly).toBe(true);expect(JSON.stringify(shared)).not.toContain(personId);
 await changeMember(windowId,1,'remove',(await socialProfile(2)).code);expect((await searchRecords(2,{q:'共同跑步'})).total).toBe(0);expect((await searchRecords(2,{q:'窗口:共同运动'})).total).toBe(0);
});
it('keeps unchanged private documents cached and refreshes edited text by version',async()=>{
 await searchRecords(1,{q:'评审'});const spy=vi.spyOn(vault,'loadDiary');await searchRecords(1,{q:'训练'});expect(spy).not.toHaveBeenCalled();
 const saved=await vault.loadDiary(date,1);saved.document.facts.events[0].note='跑步完成后做拉伸';await vault.saveDiary(date,saved.document,saved.version,1);spy.mockClear();expect((await searchRecords(1,{q:'拉伸'})).total).toBe(1);expect(spy).toHaveBeenCalledTimes(1);spy.mockRestore();
});
it('returns stable virtual occurrence identities when searching a specific date',async()=>{
 const result=await searchRecords(1,{q:'任务:健身 日期:2026-11-04'});expect(result.items.some(item=>item.row?.task.occurrenceDate==='2026-11-04')).toBe(true);expect(new Set(result.items.map(item=>item.ref.id)).size).toBe(result.items.length);
});

it('supports location, activity, diary kind and date range filters, including day notes',async()=>{
 expect((await searchRecords(1,{q:'地点:滨江 活动:跑步 类型:事实'})).total).toBe(1);
 expect((await searchRecords(1,{q:'类型:新知 标签:学习 日期:2026-10-31..2026-11-02'})).items[0].ref.kind).toBe('learn');
 expect((await searchRecords(1,{q:'长期学习'})).items[0].information).toBe(true);
});

it('matches meaningful Chinese words across word order without treating unfinished filters as all results',async()=>{
 expect((await searchRecords(1,{q:'评审项目',scope:'todo'})).items[0].title).toBe('准备项目评审');
 expect((await searchRecords(1,{q:'人物:'})).total).toBe(0);
});

it('searches built-in category labels even when the title and body do not contain them',async()=>{
 const work=await searchRecords(1,{q:'工作'});expect(work.total).toBeGreaterThan(0);expect(work.items.find(item=>item.title==='准备项目评审')).toMatchObject({categoryName:'工作',row:{task:{category:'work'}}});
 expect((await searchRecords(1,{q:'个人生活'})).items.some(item=>item.title==='每日健身')).toBe(true);
 expect((await searchRecords(1,{q:'分类:工作 标签:项目A'})).items.map(item=>item.title)).toEqual(['准备项目评审']);
 expect((await searchRecords(1,{q:'工作',scope:'diary'})).total).toBe(0);expect((await searchRecords(1,{q:'标签:工作'})).total).toBe(0);
});
it('resolves custom labels per account and refreshes settings without requiring a diary rewrite',async()=>{
 const saved=await vault.loadDiary('2026-11-05',1);expect((await searchRecords(1,{q:'天文观察'})).items[0].title).toBe('周五晚间安排');expect((await searchRecords(2,{q:'天文观察'})).total).toBe(0);expect((await searchRecords(1,{q:'园艺维护'})).total).toBe(0);expect((await searchRecords(2,{q:'园艺维护'})).items[0].title).toBe('周六上午安排');
 const key=`${vaultPaths.system}/plan-categories.json`,categories=await vault.readJson<PlanCategory[]>(key,[],1);await vault.writeJson(key,categories.map(category=>category.id===customId?{...category,name:'星空观察'}:category),1);
 expect((await searchRecords(1,{q:'天文观察'})).total).toBe(0);expect((await searchRecords(1,{q:'星空观察'})).items[0].categoryName).toBe('星空观察');expect((await vault.loadDiary('2026-11-05',1)).version).toBe(saved.version);
});
it('searches category and shared window names with independent fields',async()=>{
 expect((await searchRecords(1,{q:'窗口:工作'})).items.some(item=>item.title==='准备项目评审')).toBe(true);
 const shared=await searchRecords(1,{q:'窗口:共同运动'});expect(shared.total).toBe(1);expect(shared.items[0].windowName).toBe('共同运动');expect(shared.items[0].categoryName).toBeUndefined();
 expect(searchTerms('分类:工作 窗口:共同运动')).toEqual([{field:'category',value:'工作'},{field:'window',value:'共同运动'}]);
});
it('paginates the same ordered result set without omitting later results',async()=>{
 const full=await searchRecords(1,{q:'类型:日程',limit:100}),all=[];let offset=0,next:number|undefined;
 do{const page=await searchRecords(1,{q:'类型:日程',limit:2,offset});expect(page.total).toBe(full.total);all.push(...page.items);next=page.nextOffset;offset=next||0;}while(next!==undefined);
 expect(all.map(item=>item.ref)).toEqual(full.items.map(item=>item.ref));expect(new Set(all.map(item=>item.ref.id)).size).toBe(all.length);
});
