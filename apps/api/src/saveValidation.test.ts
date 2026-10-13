import {beforeAll,afterAll,it,expect,vi} from 'vitest';
import {emptyDiary} from '@diary/contracts';
vi.mock('./db.js',async()=>{const {createDemoPool}=await import('./demoDatabase.js');const pool=createDemoPool(':memory:');return {pool,queryRows:async(sql:string,params:unknown[]=[])=> (await pool.query(sql,params))[0]};});
vi.mock('./auth.js',()=>({registerAuth:(app:any)=>{app.decorateRequest('userId',null);app.addHook('preHandler',async(req:any)=>{req.userId=1;});},hashPassword:vi.fn(),verifyPassword:vi.fn(),createSession:vi.fn(),destroySession:vi.fn(),verifySession:vi.fn(),setSessionCookie:vi.fn(),clearSessionCookie:vi.fn(),getSessionToken:vi.fn()}));
vi.mock('./entities.js',()=>({EntityIndex:class {async rebuild(){throw new Error('index unavailable');}}}));
let app:Awaited<ReturnType<typeof import('./server')['buildServer']>>;
beforeAll(async()=>{const {buildServer}=await import('./server');app=await buildServer();});afterAll(async()=>{await app.close();});
it('returns a field-specific diagnostic with request ID, without exposing content',async()=>{
 const document=emptyDiary('2026-10-13');document.facts.note='private'.repeat(3000);
 const r=await app.inject({method:'PUT',url:'/api/diaries/'+document.date,headers:{'if-match':'0','x-diary-record-version':'2'},payload:document});
 expect(r.statusCode).toBe(400);expect(r.json()).toMatchObject({code:'VALIDATION_FAILED',requestId:expect.any(String),issues:[expect.objectContaining({path:'facts.note',maximum:20000})]});expect(r.body).not.toContain('private');
});
it('keeps a successful save successful when index refresh fails, and preserves conflict checks',async()=>{
 const document=emptyDiary('2026-10-14');document.facts.note='保存成功';
 const r=await app.inject({method:'PUT',url:'/api/diaries/'+document.date,headers:{'if-match':'0','x-diary-record-version':'2'},payload:document});expect(r.statusCode).toBe(200);expect(r.json().warning.code).toBe('CONTEXT_REFRESH_FAILED');
 const read=await app.inject({method:'GET',url:'/api/diaries/'+document.date});expect(read.json().document.facts.note).toBe('保存成功');
 const conflict=await app.inject({method:'PUT',url:'/api/diaries/'+document.date,headers:{'if-match':'0','x-diary-record-version':'2'},payload:document});expect(conflict.statusCode).toBe(409);expect(conflict.json().code).toBe('VERSION_CONFLICT');
});
it('rejects merged entry content even when supplied legacy content is blank',async()=>{
 const document=emptyDiary('2026-10-15');document.entries={learn:[],idea:[],input:[{id:'a',content:'中'.repeat(26000),time:'',sources:[],tags:[],attachments:[]},{id:'b',content:'中'.repeat(26000),time:'',sources:[],tags:[],attachments:[]}]};
 const r=await app.inject({method:'PUT',url:'/api/diaries/'+document.date,headers:{'if-match':'0','x-diary-record-version':'2'},payload:document});expect(r.statusCode).toBe(400);expect(r.json().issues[0]).toMatchObject({path:'input.excerpt',maximum:50000});expect(r.json().error).toContain('合并后');
});
