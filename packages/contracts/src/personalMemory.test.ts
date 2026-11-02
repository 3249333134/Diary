import {describe,it,expect} from 'vitest';
import {personalMemorySchema,matchPersonalMemory,selectTimeMemory,chineseClock,resolveScheduleSpan,spanIntersects,previewScheduleSpan,entityRefKey} from './index.js';
const memory=(patch:object={})=>personalMemorySchema.parse({id:crypto.randomUUID(),kind:'time',key:'offWork',label:'下班时间',value:'18:00',...patch});
describe('confirmed personal context',()=>{
 it('resolves date exceptions before weekdays before defaults; ignores disabled values',()=>{
  const records=[memory(),memory({value:'17:00',weekdays:[5]}),memory({value:'20:00',date:'2026-10-30'}),memory({value:'22:00',enabled:false})];
  expect(selectTimeMemory(records,'offWork','2026-10-30')).toMatchObject({record:{value:'20:00'}});
  expect(selectTimeMemory(records,'offWork','2026-11-06')).toMatchObject({record:{value:'17:00'}});
  expect(selectTimeMemory(records,'offWork','2026-11-02')).toMatchObject({record:{value:'18:00'}});
 });
 it('never picks an arbitrary same-scope conflicting time',()=>expect(selectTimeMemory([memory(),memory({value:'19:00'})],'offWork','2026-11-01')).toEqual({conflict:true}));
 it('uses an explicit one-day overtime start without changing the confirmed habit',()=>{
  const record=memory(),result=matchPersonalMemory('今天加班到20点，下班后健身','2026-11-01',[record]);
  expect(result.startTime).toBe('20:00');expect(record.value).toBe('18:00');expect(result.applied[0].id).toBeUndefined();
  expect(matchPersonalMemory('下班后健身','2026-11-02',[record]).startTime).toBe('18:00');
 });
 it('asks for an unknown time instead of inventing one',()=>{const result=matchPersonalMemory('下班后健身','2026-11-01',[]);expect(result.startTime).toBeUndefined();expect(result.questions).toHaveLength(1);});
 it('matches canonical people and aliases with their current tags, and keeps ambiguous people separate',()=>{
  const person=memory({kind:'person',key:'李明',label:'李明',value:'同事',aliases:['小李'],tags:['同事','项目A']});
  const matched=matchPersonalMemory('下班后和小李去吃饭','2026-11-01',[person]);expect(matched.people).toEqual([{name:'李明',tags:['同事','项目A'],personId:person.id}]);
  expect(matchPersonalMemory('和小李吃饭','2026-11-01',[person,memory({kind:'person',key:'李华',label:'李华',value:'朋友',aliases:['小李']})]).people).toHaveLength(0);
  expect(entityRefKey({type:'person',name:'李明',personId:person.id,tags:[]})).not.toBe(entityRefKey({type:'person',name:'李明',tags:[]}));
 });
 it('parses Chinese clocks and validates time memories',()=>{expect(chineseClock('下午六点半')).toBe('18:30');expect(chineseClock('晚上十一点三刻')).toBe('23:45');expect(personalMemorySchema.safeParse({...memory(),value:'25:00'}).success).toBe(false);});
});
describe('lifecycle projection',()=>{
 it('uses Shanghai creation time, intersects across year boundaries and preserves the start in a preview',()=>{
  const task={createdAt:'2026-12-31T15:00:00Z',dueDate:'2027-01-02',dueTime:'12:00'},span=resolveScheduleSpan(task)!;
  expect(span.start).toBe('2026-12-31T23:00');expect(spanIntersects(task,span,'2027-01-01','2027-01-01')).toBe(true);
  expect(previewScheduleSpan({...task,dueDate:'2027-01-03'},span)?.start).toBe(span.start);
 });
 it('uses end of day for all-day dates and falls back to a point for unreliable intervals',()=>{
  expect(resolveScheduleSpan({createdAt:'2026-10-31T15:59:00Z',dueDate:'2026-11-01'})?.end).toBe('2026-11-01T23:59');
  for(const createdAt of ['', 'invalid','2026-11-01','2026-11-02T00:00:00Z'])expect(resolveScheduleSpan({createdAt,dueDate:'2026-11-01'})).toBeUndefined();
  expect(resolveScheduleSpan({createdAt:'2026-11-01T10:00:00Z',dueDate:''})).toBeUndefined();
 });
});
