import {it,expect} from 'vitest';
import {emptyDiary,fieldLimit,diaryDocumentSchema,validateDiary,projectEntries} from './index';
it('uses the same length limit for client hints and server validation, without changing content',()=>{
 const document=emptyDiary('2026-10-13');document.facts.note='中'.repeat(20000);
 expect(fieldLimit(diaryDocumentSchema,'facts.note')).toBe(20000);expect(validateDiary(document)).toEqual([]);
 document.facts.note+='😀';const errors=validateDiary(document);
 expect(errors[0]).toMatchObject({path:'facts.note',maximum:20000,code:'too_big'});expect(document.facts.note.endsWith('😀')).toBe(true);
 expect(fieldLimit(diaryDocumentSchema,'facts.events.0.people.0.name')).toBe(80);
});
it('checks the legacy combined projection, even when each entry fits individually',()=>{
 const document=emptyDiary('2026-10-13');document.entries={learn:[],idea:[],input:[{id:'a',content:'字'.repeat(26000),time:'10:00',sources:[],tags:[],attachments:[]},{id:'b',content:'字'.repeat(26000),time:'',sources:[],tags:[],attachments:[]}]};
 const errors=validateDiary(document);expect(errors).toContainEqual(expect.objectContaining({path:'input.excerpt',maximum:50000}));expect(diaryDocumentSchema.safeParse(document).success).toBe(false);
 expect(document.entries.input[0].content.length).toBe(26000);
});
