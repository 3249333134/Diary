import { randomUUID } from 'node:crypto';
import { captureDraftSchema, captureRequestSchema, todoRepeatSchema, defaultPlanCategories, type PlanCategory } from '@diary/contracts';
import type { z } from 'zod';
import { assertDate, zonedClock } from './date.js';
import { firstOccurrence } from './recurrence.js';
import { config } from './config.js';
import { request, ProxyAgent } from 'undici';
import { readJsonObject } from './split.js';

/** 兼容 AI 返回的实体格式，统一补齐 type 字段并按 people/places/activities/foods 分组 */
function normalizeEntities(value: unknown) {
  const grouped: Record<'people' | 'places' | 'activities' | 'foods', Array<{ type: string; name?: unknown; tags?: unknown }>> = { people: [], places: [], activities: [], foods: [] };
  const bucketOf = (key: string) => key === 'person' || key === 'people' ? 'people' as const : key === 'place' || key === 'places' ? 'places' as const : key === 'activity' || key === 'activities' ? 'activities' as const : key === 'food' || key === 'foods' ? 'foods' as const : '';
  const typeOf = { people: 'person', places: 'place', activities: 'activity', foods: 'food' } as const;
  const push = (bucket: 'people' | 'places' | 'activities' | 'foods', item: unknown) => {
    if (!item || typeof item !== 'object') return;
    const entry = item as { name?: unknown; tags?: unknown };
    grouped[bucket].push({ type: typeOf[bucket], name: entry.name, tags: entry.tags });
  };
  if (Array.isArray(value)) {
    for (const item of value) {
      if (!item || typeof item !== 'object') continue;
      const bucket = bucketOf(typeof (item as { type?: unknown }).type === 'string' ? (item as { type: string }).type : '');
      if (bucket) push(bucket, item);
    }
  } else if (value && typeof value === 'object') {
    for (const [key, items] of Object.entries(value as Record<string, unknown>)) {
      const bucket = bucketOf(key);
      if (bucket && Array.isArray(items)) for (const item of items) push(bucket, item);
    }
  }
  return grouped;
}

/** 清洗 AI 返回的草稿字段：null 转 undefined，类型/格式不符的字段丢弃让 zod 用默认值 */
function sanitizeDraft(item: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...item };
  for (const [k, v] of Object.entries(out)) if (v === null && !['category','important','urgent'].includes(k)) out[k] = undefined;
  if (out.priority !== 'high' && out.priority !== 'medium' && out.priority !== 'low') out.priority = undefined;
  if (out.list !== undefined) out.list = typeof out.list === 'string' ? out.list : Array.isArray(out.list) ? out.list.filter((s): s is string => typeof s === 'string').join('，') : undefined;
  for (const k of ['date', 'startDate']) { const v = out[k]; if (v !== undefined && (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$|^$/.test(v))) out[k] = undefined; }
  for (const k of ['time', 'startTime']) { const v = out[k]; if (v !== undefined && (typeof v !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d$|^$/.test(v))) out[k] = undefined; }
  if (out.tags !== undefined) out.tags = Array.isArray(out.tags) ? out.tags.filter((t): t is string => typeof t === 'string' && !!t.trim()).map(t => t.trim()) : undefined;
  if (out.category !== undefined && out.category !== 'work' && out.category !== 'personal' && !(typeof out.category === 'string' && /^cat-[a-f0-9-]{36}$/.test(out.category))) out.category = undefined;
  for (const k of ['description', 'reviewReason']) if (out[k] !== undefined && typeof out[k] !== 'string') out[k] = undefined;
  for (const k of ['important', 'urgent', 'needsReview']) if (out[k] !== undefined && typeof out[k] !== 'boolean' && !(out[k]===null&&k!=='needsReview')) out[k] = undefined;
  const repeat=todoRepeatSchema.safeParse(out.repeat);out.repeat=repeat.success?repeat.data:null;
  return out;
}

/** Configured AI parsing with an explicitly unconfirmed manual fallback. */
export async function parseCapture(input: z.infer<typeof captureRequestSchema>, known: { names: string[]; tags: string[]; categories?: PlanCategory[] } = { names: [], tags: [] }) {
  const clock=zonedClock(config.timezone),today=clock.date,time=`${String(clock.hour).padStart(2,'0')}:${String(clock.minute).padStart(2,'0')}`;
  const categories=known.categories||defaultPlanCategories;
  if (config.ai.key) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const response = await request(`${config.ai.url}/chat/completions`, {
          method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${config.ai.key}` },
          dispatcher: config.ai.proxy ? new ProxyAgent(config.ai.proxy) : undefined, signal: AbortSignal.timeout(25_000),
          body: JSON.stringify({ model: config.ai.model, temperature: .1, messages: [
            { role: 'system', content: `你是日记与计划录入助手。直接以 { 开头输出纯 JSON {drafts:[]}，禁止输出任何解释、前后缀文字或 Markdown 代码块标记，否则视为失败。混合输入拆成独立条目。每条 kind 为 plan/facts/learn/input/idea，content 为原意正文，description 为说明，date 为 YYYY-MM-DD 或空，time 为明确 HH:mm 或空，tags 为标签数组。entities 必须是按类型分组的对象 {"people":[{"name","tags"}],"places":[],"activities":[],"foods":[]}，禁止输出为数组。现实今天是 ${today}，时区 ${config.timezone}；相对日期据此计算，不根据浏览日期。未来安排用 plan，已发生用 facts。无明确日期时间时默认现实上海日期和当前分钟，草稿中可修改。计划 startDate/startTime 表示原定开始，date/time 表示截止；只有开始安排时不要当作截止。category 为已知类别ID或null，important/urgent 为 boolean/null，仅有明确依据才设置。priority 为 high/medium/low，list 为清单字符串。含糊日期返回 needsReview:true,reviewReason。不猜人物、地点、成果或感受，不把计划目标当作已发生事实。沿用已知名称和标签，但不得补入无关实体。` },
            { role: 'system', content: `当前时间为 ${today} ${time}。没有明确日期或分钟的部分使用此值，日记和计划都如此；原定开始只在明确提供时填写。重复计划返回 repeat:{type:"daily"|"weekly"|"monthly",interval:1,weekdays:[0..6],monthDay:1..31,until:"YYYY-MM-DD"}，星期天是0；无重复为null，无结束日期不填until。识别每天、每周指定星期、每月指定日期。类别仅使用以下已知ID或null：${JSON.stringify(categories.map(c=>({id:c.id,name:c.name})))}。` },
            { role: 'user', content: JSON.stringify({ text: input.text, completion: input.completion, known }) },
          ] }),
        });
        if (response.statusCode >= 300) { await response.body.dump(); throw new Error(`AI 服务响应 ${response.statusCode}`); }
        const payload = await response.body.json() as { choices?: { message?: { content?: string } }[] };
        const text = payload.choices?.[0]?.message?.content || '';
        const raw = readJsonObject(text) as { drafts?: unknown[] };
        if (!Array.isArray(raw.drafts) || !raw.drafts.length || raw.drafts.length > 30) throw new Error('草稿格式异常');
        const drafts = raw.drafts.map(item => {
          const normalized = item && typeof item === 'object' ? { ...(item as Record<string, unknown>), entities: normalizeEntities((item as Record<string, unknown>).entities) } : item;
          const draft = captureDraftSchema.parse({ ...sanitizeDraft(normalized as Record<string, unknown>), id: randomUUID() });
          if (!draft.date) draft.date = input.completion?.date || today;
          if (!draft.time) draft.time = input.completion?.time || time;
          if(draft.repeat?.until)assertDate(draft.repeat.until);
          if(draft.category&&!categories.some(c=>c.id===draft.category))draft.category=null;
          if (draft.date) assertDate(draft.date);
          if(draft.kind==='plan')draft.date=firstOccurrence(draft.date,draft.repeat);
          if (draft.startDate) assertDate(draft.startDate);
          return draft;
        });
        return { today, timezone: config.timezone, mode: 'ai', drafts };
      } catch (error) {
        console.error(`[capture] AI 解析第 ${attempt} 次失败:`, error instanceof Error ? error.message : error);
      }
    }
  }
  return { today, timezone: config.timezone, mode: 'manual', drafts: [captureDraftSchema.parse({
    id: randomUUID(), kind: 'facts', date: input.completion?.date || today, time: input.completion?.time || time,
    content: input.text, needsReview: true, reviewReason: '当前为手动草稿，请选择用途并核对日期和内容。',
  })] };
}
