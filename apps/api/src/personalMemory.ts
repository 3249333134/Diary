import {candidateFor,extractExplicitMemories,ignoredMemoryCandidate,onceMemoryKey} from './memoryExtraction.js';
export {candidateFor,extractExplicitMemories} from './memoryExtraction.js';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { personalMemorySchema, memoryCandidateSchema, type PersonalMemory, type MemoryCandidate, type MemorySource, type DiaryDocument, type PersonalMemorySnapshot } from '@diary/contracts';
import { request, ProxyAgent } from 'undici';
import { config, vaultPaths } from './config.js';
import { pool, queryRows } from './db.js';
import { readJson, writeJson, withVaultLock, loadDiary } from './vault.js';
import { syncTransaction } from './sync-db.js';
import { readJsonObject } from './split.js';
import { assertDate } from './date.js';

type MemoryDocument = { records: PersonalMemory[]; candidates: MemoryCandidate[]; ignored: string[] };
const key = () => `${vaultPaths?.system || '_system'}/personal-memory.json`;
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const sourceJobId=(userId:number,source:MemorySource)=>hash([userId,source.date,source.recordKind,source.recordId]);
const fail = (message: string, statusCode = 400) => Object.assign(new Error(message), { statusCode });
let changed: (userId: number) => void = () => {};
export async function memoryDocument(userId: number) {
  const document = await readJson<MemoryDocument>(key(), { records: [], candidates: [], ignored: [] }, userId);
  return { document, version: hash(document) };
}
let ready: Promise<void> | undefined;
export function ensureMemoryTables() {
  return ready ||= (async () => {
    for (const sql of [
      'CREATE TABLE IF NOT EXISTS personal_memory_jobs (id VARCHAR(64) PRIMARY KEY,user_id INT NOT NULL,payload LONGTEXT NOT NULL,source_version VARCHAR(64) NOT NULL,next_at VARCHAR(30) NOT NULL,state VARCHAR(16) NOT NULL,attempts INT NOT NULL,error VARCHAR(300))',
      'CREATE TABLE IF NOT EXISTS personal_memory_operations (user_id INT NOT NULL,operation_id VARCHAR(36) NOT NULL,request_hash VARCHAR(64) NOT NULL,result LONGTEXT NOT NULL,PRIMARY KEY(user_id,operation_id))',
    ]) await pool.query(sql+(typeof pool.getConnection==='function'?' ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci':''));
  })().catch(error => { ready = undefined; throw error; });
}
export async function memorySnapshot(userId: number): Promise<PersonalMemorySnapshot> {
  const { document, version } = await memoryDocument(userId);
  const counts = await queryRows<{ state: string; count: number }>('SELECT state,COUNT(*) AS count FROM personal_memory_jobs WHERE user_id = ? GROUP BY state', [userId]);
  const jobs=new Map((await queryRows<{id:string;source_version:string}>('SELECT id,source_version FROM personal_memory_jobs WHERE user_id = ?',[userId])).map(j=>[j.id,j.source_version]));
  const candidates=document.candidates.filter(c=>c.record.source.kind!=='record'||jobs.get(sourceJobId(userId,c.record.source))===c.record.source.version);
  return { version, records: document.records, candidates, pending: Number(counts.find(c => c.state === 'pending')?.count || 0), failed: Number(counts.find(c => c.state === 'failed')?.count || 0) };
}
function privateSources(document: DiaryDocument) {
  return [
    ...document.facts.events.filter(e => !e.task).map(e => ({ id: e.id, kind: 'facts', text: [e.note, e.remark].filter(Boolean).join('\n') })),
    ...(['learn', 'input', 'idea'] as const).flatMap(kind => (document.entries?.[kind] || []).filter(e => !e.task).map(e => ({ id: e.id, kind, text: e.content }))),
    ...document.todos.filter(t => !t.seriesId).map(t => ({ id: t.id, kind: 'plan', text: [t.title, t.description].filter(Boolean).join('\n') })),
  ];
}
/** Called in the diary save transaction. Only changed private text enters the durable queue. */
export async function enqueueMemoryExtraction(userId: number, before: DiaryDocument, after: DiaryDocument) {
  const previousSources=privateSources(before),latest=privateSources(after),previous = new Map(previousSources.map(r => [r.id, r.text]));
  for(const removed of previousSources.filter(row=>!latest.some(item=>item.id===row.id))){const id=hash([userId,after.date,removed.kind,removed.id]);await pool.query('DELETE FROM personal_memory_jobs WHERE id = ?',[id]);await pool.query('INSERT INTO personal_memory_jobs (id,user_id,payload,source_version,next_at,state,attempts,error) VALUES (?,?,?,?,?,?,?,?)',[id,userId,'{}',hash(''),new Date().toISOString(),'complete',0,null]);}
  for (const row of latest) {
    if (!row.text.trim() || previous.get(row.id) === row.text) continue;
    const id = hash([userId, after.date, row.kind, row.id]), version = hash(row.text);
    await pool.query('DELETE FROM personal_memory_jobs WHERE id = ?', [id]);
    await pool.query('INSERT INTO personal_memory_jobs (id,user_id,payload,source_version,next_at,state,attempts,error) VALUES (?,?,?,?,?,?,?,?)', [id, userId, JSON.stringify({ ...row, date: after.date }), version, new Date(Date.now() + 5000).toISOString(), 'pending', 0, null]);
  }
}
async function analyzeText(text: string, source: MemorySource) {
  const result = extractExplicitMemories(text, source);
  if (!config.ai.key) return result;
  // Every character is analyzed. Chunks overlap to preserve claims crossing a boundary.
  for (let offset = 0; offset < text.length; offset += 9000) {
    const chunk = text.slice(offset, offset + 10000);
    const response = await request(`${config.ai.url}/chat/completions`, {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${config.ai.key}` }, signal: AbortSignal.timeout(config.ai.timeout), dispatcher: config.ai.proxy ? new ProxyAgent(config.ai.proxy) : undefined,
      body: JSON.stringify({ model: config.ai.model, temperature: 0, max_tokens: 1800, messages: [
        { role: 'system', content: '提取作者明确自述的长期习惯、常去地点、人物姓名/别名/关系/标签，只输出JSON {"memories":[{"kind":"time|place|person|fact","key":"offWork|onWork|wake|sleep|lunch或名称","label":"名称","value":"HH:mm或内容/关系","weekdays":[0-6],"aliases":[],"tags":[],"evidence":"原文连续原句"}]}。不猜测，不把别人、引用内容、计划目标当已知习惯。不提取当天加班/临时安排。没有明确个人信息时返回空数组。' },
        { role: 'user', content: JSON.stringify({text:chunk,memoryExtraction:true}) },
      ] }),
    });
    if (response.statusCode >= 300) { await response.body.dump(); throw new Error('个人记忆分析暂时不可用'); }
    const payload = await response.body.json() as { choices?: { message?: { content?: string } }[] };
    const raw = readJsonObject(payload.choices?.[0]?.message?.content || '') as { memories?: Record<string, unknown>[] };
    if (!Array.isArray(raw.memories)) throw new Error('记忆分析结果无效');
    for (const item of raw.memories.slice(0, 50)) {
      if (typeof item.evidence !== 'string' || !item.evidence || !chunk.includes(item.evidence)) continue;
      try { result.push(candidateFor({ ...item, id: randomUUID(), date: item.kind==='time'&&/今天|今日|今晚|加班/.test(item.evidence)?source.date:undefined } as Partial<PersonalMemory>, item.evidence, source)); } catch { /* Invalid suggestions never alter saved content. */ }
    }
  }
  return result;
}
let processing = false;
export async function processMemoryJobs() {
  if (processing) return; processing = true;
  try {
    const jobs = await queryRows<{ id: string; user_id: number; payload: string; source_version: string; attempts: number }>('SELECT * FROM personal_memory_jobs WHERE state = ? AND next_at <= ? ORDER BY next_at LIMIT 10', ['pending', new Date().toISOString()]);
    for (const job of jobs) {
      try {
        const payload = JSON.parse(job.payload) as { id: string; kind: string; text: string; date: string };
        const source: MemorySource = { kind: 'record', date: payload.date, recordId: payload.id, recordKind: payload.kind, version: job.source_version };
        const candidates = await analyzeText(payload.text, source);
        await withVaultLock(job.user_id, () => syncTransaction(async () => {
          if(typeof pool.getConnection==='function')await queryRows('SELECT id FROM users WHERE id = ? FOR UPDATE',[job.user_id]);
          const [latest] = await queryRows<{ source_version: string }>('SELECT source_version FROM personal_memory_jobs WHERE id = ?', [job.id]);
          if (latest?.source_version !== job.source_version) return;
          const diary = await loadDiary(payload.date, job.user_id), current = privateSources(diary.document).find(r => r.id === payload.id);
          if (current && hash(current.text) === job.source_version) {
            const { document } = await memoryDocument(job.user_id);
            for (const candidate of candidates) if (!ignoredMemoryCandidate(document.ignored,candidate) && !document.candidates.some(c => c.fingerprint === candidate.fingerprint) && !document.records.some(m => m.kind === candidate.record.kind && m.key === candidate.record.key && m.value === candidate.record.value && m.date === candidate.record.date && hash(m.weekdays) === hash(candidate.record.weekdays))) document.candidates.push(candidate);
            await writeJson(key(), document, job.user_id);
          }
          await pool.query('UPDATE personal_memory_jobs SET state = ?,error = ? WHERE id = ? AND source_version = ?', ['complete', null, job.id, job.source_version]);
        })); changed(job.user_id);
      } catch {
        const attempts = job.attempts + 1;
        await pool.query('UPDATE personal_memory_jobs SET state = ?,attempts = ?,error = ?,next_at = ? WHERE id = ? AND source_version = ?', [attempts >= 3 ? 'failed' : 'pending', attempts, '分析失败，已保存内容不受影响', new Date(Date.now() + 15000 * attempts).toISOString(), job.id, job.source_version]); changed(job.user_id);
      }
    }
  } finally { processing = false; }
}
const operationSchema = z.object({ operationId: z.string().uuid(), version: z.string(), action: z.enum(['upsert', 'delete', 'confirm', 'ignore', 'once', 'retry']), record: personalMemorySchema.optional(), candidate: memoryCandidateSchema.optional(), id: z.string().optional() });
export async function memoryOperation(userId: number, body: unknown) {
  const input = operationSchema.parse(body), requestHash = hash(input);
  return withVaultLock(userId, () => syncTransaction(async () => {
    if (typeof pool.getConnection === 'function') await queryRows('SELECT id FROM users WHERE id = ? FOR UPDATE', [userId]);
    const [replay] = await queryRows<{ request_hash: string; result: string }>('SELECT request_hash,result FROM personal_memory_operations WHERE user_id = ? AND operation_id = ?', [userId, input.operationId]);
    if (replay) { if (replay.request_hash !== requestHash) throw fail('操作编号已被使用', 409); return JSON.parse(replay.result) as PersonalMemorySnapshot; }
    const { document, version } = await memoryDocument(userId);
    if (version !== input.version) throw fail('个人记忆已更新，请刷新后重试；输入已保留', 409);
    if (input.action === 'retry') await pool.query('UPDATE personal_memory_jobs SET state = ?,attempts = 0,next_at = ? WHERE user_id = ? AND state = ?', ['pending', new Date().toISOString(), userId, 'failed']);
    else if (input.action === 'delete') document.records = document.records.filter(m => m.id !== input.id);
    else if (input.action === 'upsert' || input.action === 'confirm') {
      const candidate = document.candidates.find(c => c.id === input.id) || input.candidate;
      if(input.action==='confirm'&&candidate?.record.source.kind==='record'){const [job]=await queryRows<{source_version:string}>('SELECT source_version FROM personal_memory_jobs WHERE id = ?',[sourceJobId(userId,candidate.record.source)]);if(job?.source_version!==candidate.record.source.version)throw fail('原记录已修改，这条旧建议已失效，请刷新待确认信息',409);}
      const record = input.action === 'confirm' ? candidate?.record : input.record;
      if (!record) throw fail('请选择要保存的记忆');
      if (record.date) assertDate(record.date);
      // Client-supplied suggestions are private user confirmations, never trusted links to other accounts.
      const validated = { ...record, source: candidate && !document.candidates.includes(candidate) ? { kind: 'ai' as const, excerpt: candidate.evidence } : record.source, updatedAt: new Date().toISOString() };
      document.records = [...document.records.filter(m => m.id !== validated.id), validated];
      if (candidate) { document.candidates = document.candidates.filter(c => c.fingerprint !== candidate.fingerprint); document.ignored.push(candidate.fingerprint); }
    } else if (input.action === 'ignore'||input.action==='once') {
      const candidate = document.candidates.find(c => c.id === input.id) || input.candidate;
      if (candidate) { document.ignored.push(input.action==='once'?onceMemoryKey(candidate):candidate.fingerprint); document.candidates = document.candidates.filter(c => c.fingerprint !== candidate.fingerprint); }
    }
    document.ignored = [...new Set(document.ignored)];
    await writeJson(key(), document, userId);
    const result = await memorySnapshot(userId);
    await pool.query('INSERT INTO personal_memory_operations (user_id,operation_id,request_hash,result) VALUES (?,?,?,?)', [userId, input.operationId, requestHash, JSON.stringify(result)]);
    return result;
  }));
}
export async function registerPersonalMemory(app: FastifyInstance, onChange: (userId: number) => void) {
  await ensureMemoryTables(); changed = onChange;
  app.get('/api/personal-memory', request => memorySnapshot(request.userId!));
  app.post('/api/personal-memory', async request => { const result = await memoryOperation(request.userId!, request.body); changed(request.userId!); return result; });
  const timer = setInterval(() => { void processMemoryJobs().catch(() => {}); }, 2000); timer.unref();
  app.addHook('onClose', async () => clearInterval(timer));
}
