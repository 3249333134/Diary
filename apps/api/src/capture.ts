import { randomUUID } from 'node:crypto';
import { captureDraftSchema, captureRequestSchema, todoRepeatSchema, defaultPlanCategories, type PlanCategory } from '@diary/contracts';
import type { z } from 'zod';
import { assertDate, zonedClock } from './date.js';
import { firstOccurrence } from './recurrence.js';
import { config } from './config.js';
import { request, ProxyAgent } from 'undici';
import { readJsonObject } from './split.js';

type KnownWindow = { id: string; name: string };
type Known = { names: string[]; tags: string[]; categories?: PlanCategory[]; windows?: KnownWindow[] };

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

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 清洗 AI 返回的草稿字段：null 转 undefined，类型/格式不符的字段丢弃让 zod 用默认值 */
function sanitizeDraft(item: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...item };
  for (const [k, v] of Object.entries(out)) if (v === null && !['category','important','urgent'].includes(k)) out[k] = undefined;
  if (out.priority !== 'high' && out.priority !== 'medium' && out.priority !== 'low') out.priority = undefined;
  if (out.list !== undefined) out.list = typeof out.list === 'string' ? out.list : Array.isArray(out.list) ? out.list.filter((s): s is string => typeof s === 'string').join('，') : undefined;
  for (const k of ['date', 'startDate']) { const v = out[k]; if (v !== undefined && (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$|^$/.test(v))) out[k] = undefined; }
  for (const k of ['time', 'startTime']) { const v = out[k]; if (v !== undefined && (typeof v !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d$|^$/.test(v))) out[k] = undefined; }
  if (out.tags !== undefined) out.tags = Array.isArray(out.tags) ? [...new Set(out.tags.filter((t): t is string => typeof t === 'string').map(t => t.trim().replace(/^#+/, '')).filter(Boolean))].slice(0, 6) : undefined;
  if (out.category !== undefined && out.category !== 'work' && out.category !== 'personal' && !(typeof out.category === 'string' && /^cat-[a-f0-9-]{36}$/.test(out.category))) out.category = undefined;
  if (out.windowId !== undefined && (typeof out.windowId !== 'string' || !UUID.test(out.windowId.trim()))) out.windowId = undefined;
  if (out.checkinEnabled !== undefined && typeof out.checkinEnabled !== 'boolean') out.checkinEnabled = undefined;
  for (const k of ['description', 'reviewReason']) if (out[k] !== undefined && typeof out[k] !== 'string') out[k] = undefined;
  for (const k of ['important', 'urgent', 'needsReview']) if (out[k] !== undefined && typeof out[k] !== 'boolean' && !(out[k]===null&&k!=='needsReview')) out[k] = undefined;
  out.repeat = normalizeRepeat(out.repeat);
  return out;
}

/** 兼容 AI 的 repeat 写法（字符串简写、数字为字符串），再交给 zod 校验 */
function normalizeRepeat(value: unknown) {
  if (typeof value === 'string') return /^(daily|weekly|monthly|yearly|none)$/.test(value) ? { type: value } : null;
  if (value && typeof value === 'object') {
    const r = { ...(value as Record<string, unknown>) };
    if (Array.isArray(r.weekdays)) r.weekdays = r.weekdays.map(Number).filter(n => Number.isInteger(n) && n >= 0 && n <= 6);
    if (r.monthDay !== undefined) r.monthDay = Number(r.monthDay);
    if (r.interval !== undefined) r.interval = Math.max(1, Number(r.interval) || 1) || undefined;
    if (r.until !== undefined && typeof r.until !== 'string') r.until = '';
    if (r.afterDays !== undefined) r.afterDays = Number(r.afterDays);
    const parsed = todoRepeatSchema.safeParse(r);
    return parsed.success ? parsed.data : null;
  }
  return null;
}

const CN_WEEKDAY: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 0, 天: 0 };
/** 从正文里的频率词直接推断重复规则，避免模型漏填 repeat */
export function inferRepeat(text: string) {
  if (/每年/.test(text)) return { type: 'yearly' as const };
  const monthly = /每(?:个)?月(?:的|份)?(\d{1,2})[号日]/.exec(text);
  if (monthly) return { type: 'monthly' as const, monthDay: Number(monthly[1]) };
  if (/每月|每个月/.test(text)) return { type: 'monthly' as const };
  const weekly = /每(?:周|个?星期)([一二三四五六日天])/.exec(text);
  if (weekly) return { type: 'weekly' as const, weekdays: [CN_WEEKDAY[weekly[1]] ?? 1] };
  if (/周[一二三四五六日天]/.test(text) && /每/.test(text)) return { type: 'weekly' as const };
  if (/每天|每日|每晚|天天|每个工作日/.test(text)) return { type: 'daily' as const };
  return null;
}

const KIND_LABEL: Record<string, string> = { plan: '日程', facts: '记录', learn: '学习', input: '摘录', idea: '灵感' };

/** 录入助手的系统提示：覆盖全部创建字段，并给出中文相对日期的推理规则 */
function capturePrompt(today: string, time: string) {
  return [
    '你是「独立日记」的智能录入助手。把用户的一段自然语言拆成若干独立条目，只输出一个 JSON 对象：{"drafts":[...]}。禁止输出任何解释、前后缀文字或 Markdown 代码块标记。',
    '每条草稿的字段（严格按此命名）：',
    '- kind：plan(未来要做/安排)｜facts(已发生的事)｜learn(学到的知识)｜input(阅读观看的摘录)｜idea(想法灵感)',
    '- content：该条目正文，保留原意，可精简到 100 字内',
    '- description：补充说明，可为空字符串',
    '- date：YYYY-MM-DD 或 ""；plan 表示截止日期，facts 表示发生日期',
    '- time：24 小时制 HH:mm 或 ""；plan 表示截止时刻',
    '- startDate / startTime：仅当原文明确说“从…开始/开始于…”时才填，否则留空；不要把截止时间当成开始时间',
    '- category：只能取“已知类别”列表里的 id，没有依据填 null',
    '- windowId：只能取“已知共享窗口”列表里的 id；仅当原文明确说“发到/共享到/安排给…”某个窗口时才填，否则省略该字段',
    '- important / urgent：true｜false｜null；出现“重要/必须/务必”→important=true，出现“紧急/马上/立刻/今天必须”→urgent=true，没有明确依据填 null',
    '- priority："high"｜"medium"｜"low"；有紧急或重要信号时 high，琐碎小事 low，其余 medium',
    '- list：清单名（如 工作/学习/购物/家务），无则 ""',
    '- tags：1-4 个、每个 2-6 字的名词短语，概括该条目的主题；优先复用“已知标签”；每条草稿都必须至少 1 个标签',
    '- entities：必须是对象 {"people":[{"name","tags"}],"places":[],"activities":[],"foods":[]}，禁止输出为数组；没有就各为空数组',
    '- repeat：null，或 {"type":"daily"|"weekly"|"monthly","interval":1,"weekdays":[0-6],"monthDay":1-31,"until":"YYYY-MM-DD"}；星期天是 0；每天→daily，每周三→weekly 且 weekdays:[3]，每月 5 号→monthly 且 monthDay:5；原文出现“每天/每日/每晚/每周X/每月X/每年/以后每…”等频率词时**必须**填写对应 repeat，绝不能返回 null',
    '- checkinEnabled：true｜false；习惯类计划（每天/每周坚持、用户说“打卡”）为 true；已填 repeat 且原文提到打卡/坚持/养成习惯时为 true',
    '- needsReview：日期或意图含糊（如“改天”“最近”“有机会”）时为 true，并在 reviewReason 写一句原因',
    `【日期推理】现实今天是 ${today}，当前时刻 ${time}，时区 Asia/Shanghai。`,
    '今天/明天/后天/大后天/昨天/前天→对应日期；本周X/这周X/下周X→算出具体日期；只说“周三”取未来最近的那个周三；“月底”=本月最后一天，“下月初”=下月 1 号，“三天后”=今天加 3 天。',
    '“下午三点”→15:00，“晚上八点”→20:00，“中午”→12:00，“早八点”→08:00。只有模糊时段（早上/上午/下午/傍晚/晚上/睡前）且没给点数时，time 留空。',
    `没有给日期时：plan 和 facts 都用今天；没有给时间时：plan 用 ${time}，facts 用 ""。`,
    '【示例】输入："明天下午三点提醒我交周报，顺便记一下今天中午和小李在楼下吃了麻辣烫"',
    '输出：{"drafts":[{"kind":"plan","content":"提交周报","description":"","date":"<明天>","time":"15:00","startDate":"","startTime":"","category":null,"important":true,"urgent":false,"priority":"high","list":"工作","tags":["工作","周报"],"entities":{"people":[],"places":[],"activities":[],"foods":[]},"repeat":null,"checkinEnabled":false,"needsReview":false,"reviewReason":""},{"kind":"facts","content":"和小李在楼下吃了麻辣烫","description":"","date":"<今天>","time":"","tags":["美食","午餐"],"entities":{"people":[{"name":"小李","tags":["同事"]}],"places":[{"name":"楼下","tags":[]}],"activities":[{"name":"吃麻辣烫","tags":["午餐"]}],"foods":[{"name":"麻辣烫","tags":[]}]},"repeat":null,"needsReview":false,"reviewReason":""}]}',
    '【铁律】不要把字段名（在哪/和谁/做了什么/吃了什么）当作实体名；不要臆造原文没有的人物、地点、成果或感受；计划目标不能写成已发生事实；可空字符串字段用 ""，不要写 null；数值和布尔值不要加引号。',
  ].join('\n');
}

/** Configured AI parsing with an explicitly unconfirmed manual fallback. */
export async function parseCapture(input: z.infer<typeof captureRequestSchema>, known: Known = { names: [], tags: [] }) {
  const clock=zonedClock(config.timezone),today=clock.date,time=`${String(clock.hour).padStart(2,'0')}:${String(clock.minute).padStart(2,'0')}`;
  const categories=known.categories||defaultPlanCategories,windows=known.windows||[];
  if (config.ai.key) {
    const context = [
      `已知类别（category 只能取这里的 id 或 null）：${JSON.stringify(categories.map(c => ({ id: c.id, name: c.name })))}。`,
      `已知共享窗口（windowId 只能取这里的 id）：${JSON.stringify(windows)}。`,
      `已知标签（优先复用）：${JSON.stringify(known.tags.slice(0, 50))}。`,
      `已知实体（可复用，不要臆造）：${JSON.stringify(known.names.slice(0, 60))}。`,
    ].join('\n');
    let repair = '';
    for (let attempt = 1; attempt <= 2; attempt++) {
      let lastRaw = '';
      try {
        const messages = [
          { role: 'system', content: capturePrompt(today, time) },
          { role: 'system', content: context },
          ...(repair ? [
            { role: 'user', content: JSON.stringify({ text: input.text, completion: input.completion }) },
            { role: 'assistant', content: repair },
            { role: 'user', content: '上一条输出不是合法 JSON 或缺少必需字段。请重新输出：只输出一个合法 JSON 对象 {"drafts":[...]}，每条都包含 kind、content、date、time、tags、entities、repeat，不要任何解释文字或代码块。' },
          ] : [
            { role: 'user', content: JSON.stringify({ text: input.text, completion: input.completion }) },
          ]),
        ];
        const response = await request(`${config.ai.url}/chat/completions`, {
          method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${config.ai.key}` },
          dispatcher: config.ai.proxy ? new ProxyAgent(config.ai.proxy) : undefined, signal: AbortSignal.timeout(14_000),
          body: JSON.stringify({ model: config.ai.model, temperature: attempt === 1 ? .1 : 0, max_tokens: 1600, messages }),
        });
        if (response.statusCode >= 300) { await response.body.dump(); throw new Error(`AI 服务响应 ${response.statusCode}`); }
        const payload = await response.body.json() as { choices?: { message?: { content?: string } }[] };
        const text = payload.choices?.[0]?.message?.content || '';
        lastRaw = text;
        const raw = readJsonObject(text) as { drafts?: unknown[] };
        if (!Array.isArray(raw.drafts) || !raw.drafts.length || raw.drafts.length > 30) throw new Error('草稿格式异常');
        const drafts = raw.drafts.map(item => {
          const normalized = item && typeof item === 'object' ? { ...(item as Record<string, unknown>), entities: normalizeEntities((item as Record<string, unknown>).entities) } : item;
          const draft = captureDraftSchema.parse({ ...sanitizeDraft(normalized as Record<string, unknown>), id: randomUUID() });
          if (!draft.date) draft.date = input.completion?.date || today;
          if (!draft.time) draft.time = input.completion?.time || (draft.kind === 'facts' ? '' : time);
          if(draft.repeat?.until)assertDate(draft.repeat.until);
          if(draft.category&&!categories.some(c=>c.id===draft.category))draft.category=null;
          if(draft.windowId&&!windows.some(w=>w.id===draft.windowId))draft.windowId=undefined;
          if (draft.date) assertDate(draft.date);
          if (draft.kind === 'plan' && !draft.repeat) draft.repeat = inferRepeat(draft.content);
          if (draft.repeat && /打卡|坚持|习惯/.test(draft.content)) draft.checkinEnabled = true;
          if(draft.kind==='plan')draft.date=firstOccurrence(draft.date,draft.repeat);
          if (draft.startDate) assertDate(draft.startDate);
          if (!draft.tags.length) draft.tags = [draft.list || (draft.category ? categories.find(c=>c.id===draft.category)?.name || '' : '') || KIND_LABEL[draft.kind]];
          return draft;
        });
        return { today, timezone: config.timezone, mode: 'ai', drafts };
      } catch (error) {
        if (lastRaw) repair = lastRaw;
        console.error(`[capture] AI 解析第 ${attempt} 次失败:`, error instanceof Error ? error.message : error);
      }
    }
  }
  return { today, timezone: config.timezone, mode: 'manual', drafts: [captureDraftSchema.parse({
    id: randomUUID(), kind: 'facts', date: input.completion?.date || today, time: input.completion?.time || time,
    content: input.text, needsReview: true, reviewReason: '当前为手动草稿，请选择用途并核对日期和内容。',
  })] };
}
