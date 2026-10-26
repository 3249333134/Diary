import {describe,expect,it} from 'vitest';
import {emptyDiary,validateDiary,captureDraftSchema} from '@diary/contracts';
import {appendCreation,appendRecognized,creationIssues,creationStorageKey,creationTask,emptyCreationSession,fromCaptureDraft,hasCreationDraft,newCreationDraft,restoreCreationSession} from './creationDraft';

describe('creation snapshots and draft protection',()=>{
 it('keeps manual text above the AI input limit and validates the original field boundaries',()=>{
  const draft={...newCreationDraft('learn','2026-10-20',''),content:'中😀'.repeat(10000)};
  expect(creationIssues(draft)).toEqual([]);expect(validateDiary(appendCreation(emptyDiary(draft.date),draft))).toEqual([]);
  expect(creationIssues({...draft,content:'中'.repeat(50001)})[0].maximum).toBe(50000);
  expect(creationIssues({...newCreationDraft('facts',draft.date,''),content:'中'.repeat(10001)})[0].maximum).toBe(10000);
 });
 it('checks merged body length and keeps the source document and full text intact',()=>{
  const document=emptyDiary('2026-10-20');document.learn.content='旧'.repeat(30000);
  const draft={...newCreationDraft('learn',document.date,''),content:'新'.repeat(25000)};
  const next=appendCreation(document,draft);expect(validateDiary(next).some(i=>i.path==='learn.content')).toBe(true);expect(document.learn.content.length).toBe(30000);expect(next.entries!.learn.at(-1)!.content.length).toBe(25000);
 });
 it('retries with the same ID without duplicating facts, and keeps metadata and attachments',()=>{
  const draft={...newCreationDraft('facts','2026-10-20','23:59'),content:'散步',description:'河边',entities:[{type:'person' as const,name:'小林',tags:['朋友']}],tags:['生活'],attachments:[{path:'a.pdf',name:'附件'}]};
  const once=appendCreation(emptyDiary(draft.date),draft),again=appendCreation(once,draft);expect(again.facts.events).toHaveLength(1);expect(again.facts.events[0]).toMatchObject({id:draft.id,time:'23:59',note:'散步',remark:'河边',people:draft.entities,attachments:draft.attachments});
 });
 it('keeps owner/start/due snapshots independent and preserves recurring plan fields',()=>{
  const draft={...newCreationDraft('plan','2026-10-25','20:00'),content:'读书',date:'2026-10-26',startDate:'2026-10-24',startTime:'09:00',repeat:{type:'daily' as const},priority:'high'};
  const task=creationTask(draft);expect(draft.ownerDate).toBe('2026-10-25');expect(task).toMatchObject({dueDate:'2026-10-26',dueTime:'20:00',startDate:'2026-10-24',startTime:'09:00',repeat:{type:'daily'},priority:'high'});
 });
 it('restores manual and mixed AI drafts, submitted snapshots and account isolation',()=>{
  const manual={...newCreationDraft('input','2026-10-20','12:00'),content:'摘录'},ai=fromCaptureDraft(captureDraftSchema.parse({id:crypto.randomUUID(),kind:'plan',date:'2026-10-26',content:'例会'}),'2026-10-25');
  const session={...emptyCreationSession(),manual:{'input:2026-10-20':manual},text:'明天开会',rows:[{draft:ai,state:'error' as const,submitted:ai}]};expect(restoreCreationSession(JSON.stringify(session))).toEqual(session);expect(hasCreationDraft(session)).toBe(true);expect(creationStorageKey(1)).not.toBe(creationStorageKey(2));expect(restoreCreationSession('{bad')).toEqual(emptyCreationSession());expect(restoreCreationSession('{"version":1,"manual":{"bad":{}},"text":"","rows":[]}')).toEqual(emptyCreationSession());
 });
 it('does not mark untouched contextual metadata as an unsaved draft',()=>{
  const blank={...newCreationDraft('idea','2026-10-20',''),tags:['现有标签']};expect(hasCreationDraft({...emptyCreationSession(),manual:{idea:blank}})).toBe(false);expect(hasCreationDraft({...emptyCreationSession(),manual:{idea:{...blank,edited:true}}})).toBe(true);
 });
 it('appends successive recognition batches without replacing edits, raw text or saved identities',()=>{
  const first=captureDraftSchema.parse({id:crypto.randomUUID(),kind:'plan',date:'2026-10-26',content:'读书',repeat:{type:'daily'},checkinEnabled:true});
  const session=emptyCreationSession(),rows=appendRecognized(session,[first],'每天读书','2026-10-25');
  rows[0].draft.content='已修改的读书安排';rows[0].state='saved';session.rows=rows;
  const added=appendRecognized(session,[first],'再安排一次','2026-10-25');
  expect(added[0].draft.id).not.toBe(first.id);expect(rows[0].draft.content).toBe('已修改的读书安排');expect(rows[0].originalText).toBe('每天读书');expect(added[0].originalText).toBe('再安排一次');expect(creationTask(added[0].draft).checkinEnabled).toBe(true);
  expect(creationTask({...added[0].draft,checkinEnabled:false}).checkinEnabled).toBe(false);
 });
});
