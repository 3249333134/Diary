import {extractExplicitMemories,candidateFor,ignoredMemoryCandidate} from './memoryExtraction.js';
import {matchPersonalMemory,timeAnchors,type PersonalMemory,type AppliedMemory,type MemoryCandidate} from '@diary/contracts';
import { randomUUID } from 'node:crypto';
import { captureDraftSchema, captureRequestSchema, todoRepeatSchema, defaultPlanCategories, type PlanCategory } from '@diary/contracts';
import type { z } from 'zod';
import { assertDate, addDays, zonedClock } from './date.js';
import { firstOccurrence } from './recurrence.js';
import { config } from './config.js';
import { request, ProxyAgent } from 'undici';
import { readJsonObject } from './split.js';

type KnownWindow = { id: string; name: string };
type Known = { names: string[]; tags: string[]; categories?: PlanCategory[]; windows?: KnownWindow[];memories?:PersonalMemory[];ignored?:string[] };

/** 兼容 AI 返回的实体格式，统一补齐 type 字段并按 people/places/activities/foods 分组 */
function normalizeEntities(value: unknown) {
  const grouped: Record<'people' | 'places' | 'activities' | 'foods', Array<{ type: string; name?: unknown; tags?: unknown }>> = { people: [], places: [], activities: [], foods: [] };
  const bucketOf = (key: string) => key === 'person' || key === 'people' ? 'people' as const : key === 'place' || key === 'places' ? 'places' as const : key === 'activity' || key === 'activities' ? 'activities' as const : key === 'food' || key === 'foods' ? 'foods' as const : '';
  const typeOf = { people: 'person', places: 'place', activities: 'activity', foods: 'food' } as const;
  const push = (bucket: 'people' | 'places' | 'activities' | 'foods', item: unknown) => {
    if (typeof item === 'string') { if (item.trim()) grouped[bucket].push({ type: typeOf[bucket], name: item.trim(), tags: [] }); return; }
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

/** 正文被模型精简掉频率词时，回到原文里找与该条最相关的那一句再推断 */
export function inferRepeatFromSource(source: string, content: string) {
  const direct = inferRepeat(content);
  if (direct) return direct;
  const segments = source.split(/[。；;！!？?\n]+/).map(part => part.trim()).filter(Boolean);
  if (!segments.length) return null;
  if (segments.length === 1) return inferRepeat(segments[0]);
  const keys: string[] = [];
  for (let i = 0; i + 1 < content.length; i++) keys.push(content.slice(i, i + 2));
  let best = '', score = 0;
  for (const segment of segments) {
    const hit = keys.reduce((total, key) => total + (segment.includes(key) ? 1 : 0), 0);
    if (hit > score) { score = hit; best = segment; }
  }
  return score ? inferRepeat(best) : null;
}

const KIND_LABEL: Record<string, string> = { plan: '日程', facts: '记录', learn: '学习', input: '摘录', idea: '灵感' };

/** 录入助手的系统提示：覆盖全部创建字段，并给出中文相对日期的推理规则 */
function capturePrompt(today: string, time: string) {
  const tomorrow = addDays(today, 1);
  return [
    '你是「独立日记」的智能录入助手。把用户的一段自然语言拆成若干独立条目，只输出一个 JSON 对象：{"drafts":[...]}。不要任何解释文字或代码块标记。',
    '根对象可以包含memories数组，仅提取明确自述的习惯、人物姓名/别名/关系/标签、常去地点；每项含kind(time|person|place|fact)、key、label、value、weekdays、aliases、tags、evidence(原文连续原句)。时间key使用offWork/onWork/wake/sleep/lunch。绝不臆测，只是待确认候选。',
    '每条草稿只输出有意义的字段，空值一律省略（不要写 null、""、[]）：',
    '- kind：plan(未来要做)｜facts(已发生)｜learn(学到的知识)｜input(阅读观看的摘录)｜idea(想法灵感)',
    '- content：正文，保留原意，100 字内',
    '- date：YYYY-MM-DD；plan 是截止日，facts 是发生日',
    '- time：HH:mm；plan 是截止时刻',
    '- startDate/startTime：原文的执行开始或“下班后”等时间锚点用于开始，不作为截止',
    '- category：只能取“已知类别”里的 id',
    '- windowId：只能取“已知共享窗口”里的 id；仅当原文说“发到/共享给某个窗口”才填',
    '- important / urgent：true｜false；“重要/必须/务必”→important，“紧急/马上/立刻”→urgent',
    '- priority：high｜medium｜low；有紧急或重要→high，琐碎小事→low，其余省略',
    '- list：清单名（工作/学习/购物/家务）',
    '- tags：1-4 个 2-6 字名词短语，优先复用“已知标签”，每条至少 1 个',
    '- entities：{"people":["张三"],"places":["楼下"],"activities":["吃麻辣烫"],"foods":["麻辣烫"]}；值为字符串数组，没有就省略整个字段',
    '- repeat：原文出现“每天/每日/每晚/每周X/每月X号/每年/以后每…”等频率词时必须填，格式 {"type":"daily"|"weekly"|"monthly"|"yearly","weekdays":[0-6],"monthDay":1-31}，星期天是 0；每周三→{"type":"weekly","weekdays":[3]}，每月 5 号→{"type":"monthly","monthDay":5}',
    '- checkinEnabled：true（原文说打卡/坚持/养成习惯）',
    '- description：仅当 content 不足以表达时补充',
    '- needsReview：true（日期或意图含糊，如“改天/最近/有机会”），并写 reviewReason',
    `【日期】今天是 ${today} ${time}（Asia/Shanghai）。今天/明天/后天/昨天；本周X/下周X 算出具体日期；只写“周三”取未来最近的周三；“月底”=本月最后一天，“三天后”=今天+3 天。`,
    '“下午三点”→15:00，“晚上八点”→20:00，“中午”→12:00，“早八点”→08:00；只说早上/上午/下午/傍晚/晚上/睡前又没给点数时省略 time。',
    '没给截止日期时plan省略date和time，允许未安排；没有截止时刻绝不填当前时刻。下班后/上班前等属于startDate/startTime，未知习惯时间不猜测。facts没给日期用今天，不填time。',
    '【示例】输入："明天下午三点交周报；中午和小李在楼下吃麻辣烫；以后每晚八点去健身房打卡"',
    `输出：{"drafts":[{"kind":"plan","content":"交周报","date":"${tomorrow}","time":"15:00","list":"工作","tags":["工作","周报"],"important":true,"priority":"high"},{"kind":"facts","content":"和小李在楼下吃麻辣烫","date":"${today}","entities":{"people":["小李"],"places":["楼下"],"foods":["麻辣烫"]},"tags":["美食","午餐"]},{"kind":"plan","content":"去健身房打卡","date":"${today}","time":"20:00","tags":["健身","习惯"],"repeat":{"type":"daily"},"checkinEnabled":true}]}`,
    '【铁律】不要把字段名（在哪/和谁/做了什么/吃了什么）当实体名；不要臆造原文没有的人物、地点；计划目标不能写成已发生事实；日期必须写真实日期，不要写占位符。',
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
      `已知标签（优先复用）：${JSON.stringify(known.tags.slice(0, 20))}。`,
      `已知实体（可复用，不要臆造）：${JSON.stringify(known.names.slice(0, 30))}。`,
      `已确认个人记忆（仅个人上下文，本次明确输入优先；习惯时间用于原定开始，不猜截止）：${JSON.stringify((known.memories||[]).filter(m=>m.enabled&&(m.kind==='fact'||[m.label,...m.aliases,...timeAnchors.filter(a=>a.key===m.key).map(a=>a.word)].some(word=>input.text.includes(word)))).map(m=>({kind:m.kind,key:m.key,name:m.label,value:m.value,weekdays:m.weekdays,date:m.date,aliases:m.aliases,tags:m.tags})))}。`,
    ].join('\n');
    let repair = '';
    for (let attempt = 1; attempt <= 2; attempt++) {
      let lastRaw = '';
      const attemptStart = Date.now();
      try {
        const messages = [
          { role: 'system', content: capturePrompt(today, time) },
          { role: 'system', content: context },
          ...(repair ? [
            { role: 'user', content: JSON.stringify({ text: input.text, completion: input.completion }) },
            { role: 'assistant', content: repair },
            { role: 'user', content: '上一条输出不是合法 JSON。请重新输出：只输出一个合法 JSON 对象 {"drafts":[...]}，每条必须有 kind 和 content，空字段省略，不要任何解释文字或代码块。' },
          ] : [
            { role: 'user', content: JSON.stringify({ text: input.text, completion: input.completion }) },
          ]),
        ];
        const response = await request(`${config.ai.url}/chat/completions`, {
          method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${config.ai.key}` },
          dispatcher: config.ai.proxy ? new ProxyAgent(config.ai.proxy) : undefined, signal: AbortSignal.timeout(config.ai.timeout),
          body: JSON.stringify({ model: config.ai.model, temperature: attempt === 1 ? .1 : 0, max_tokens: 1200, messages }),
        });
        if (response.statusCode >= 300) { await response.body.dump(); throw new Error(`AI 服务响应 ${response.statusCode}`); }
        const payload = await response.body.json() as { choices?: { message?: { content?: string } }[] };
        const text = payload.choices?.[0]?.message?.content || '';
        lastRaw = text;
        const raw = readJsonObject(text) as { drafts?: unknown[];memories?:Record<string,unknown>[] };
        if (!Array.isArray(raw.drafts) || !raw.drafts.length || raw.drafts.length > 30) throw new Error('草稿格式异常');
        const drafts = raw.drafts.map(item => {
          const normalized = item && typeof item === 'object' ? { ...(item as Record<string, unknown>), entities: normalizeEntities((item as Record<string, unknown>).entities) } : item;
          const draft = captureDraftSchema.parse({ ...sanitizeDraft(normalized as Record<string, unknown>), id: randomUUID() });
          if (!draft.date && draft.kind!=='plan') draft.date = input.completion?.date || today;
          if (!draft.time) draft.time = input.completion?.time || '';
          if(draft.repeat?.until)assertDate(draft.repeat.until);
          if(draft.category&&!categories.some(c=>c.id===draft.category))draft.category=null;
          if(draft.windowId&&!windows.some(w=>w.id===draft.windowId))draft.windowId=undefined;
          if (draft.date) assertDate(draft.date);
          if (draft.kind === 'plan' && !draft.repeat) draft.repeat = inferRepeatFromSource(input.text, draft.content);
          if (draft.repeat && /打卡|坚持|习惯/.test(draft.content)) draft.checkinEnabled = true;
          if(draft.kind==='plan'&&draft.date)draft.date=firstOccurrence(draft.date,draft.repeat);
          if (draft.startDate) assertDate(draft.startDate);
          if (!draft.tags.length) draft.tags = [draft.list || (draft.category ? categories.find(c=>c.id===draft.category)?.name || '' : '') || KIND_LABEL[draft.kind]];
          return draft;
        });
        return decorateMemories({ today, timezone: config.timezone, mode: 'ai' as const, drafts },input.text,known.memories||[],raw.memories,known.ignored);
      } catch (error) {
        if (lastRaw) repair = lastRaw;
        console.error(`[capture] AI 解析第 ${attempt} 次失败(耗时 ${Date.now() - attemptStart}ms):`, error instanceof Error ? error.message : error);
      }
    }
  }
  return decorateMemories({ today, timezone: config.timezone, mode: 'manual' as const, drafts: [captureDraftSchema.parse({
    id: randomUUID(), kind: /下班后|上班后|起床后|午休后/.test(input.text)&&!input.completion?'plan':'facts', date: /下班后|上班后|起床后|午休后/.test(input.text)&&!input.completion?'':input.completion?.date || today, time: /下班后|上班后|起床后|午休后/.test(input.text)&&!input.completion?'':input.completion?.time || time,
    content: input.text, needsReview: true, reviewReason: '当前为手动草稿，请选择用途并核对日期和内容。',
  })] },input.text,known.memories||[],[],known.ignored);
}

function decorateMemories<T extends {today:string;drafts:ReturnType<typeof captureDraftSchema.parse>[] }>(response:T,text:string,memories:PersonalMemory[],suggestions:Record<string,unknown>[]=[],ignored:string[]=[]){
 const memoryCandidates=extractExplicitMemories(text,{kind:'ai',date:response.today}).filter(c=>!memories.some(m=>m.kind===c.record.kind&&m.key===c.record.key&&m.value===c.record.value&&m.date===c.record.date&&JSON.stringify(m.weekdays)===JSON.stringify(c.record.weekdays)));
 for(const item of suggestions.slice(0,30))if(typeof item.evidence==='string'&&item.evidence&&text.includes(item.evidence))try{const candidate=candidateFor({...item,id:randomUUID(),date:item.kind==='time'&&/今天|今日|今晚|加班/.test(item.evidence)?response.today:undefined} as Partial<PersonalMemory>,item.evidence,{kind:'ai',date:response.today});if(!memoryCandidates.some(c=>c.fingerprint===candidate.fingerprint))memoryCandidates.push(candidate);}catch{}
 const memoryMatches:Record<string,{applied:AppliedMemory[];questions:string[]}>={};
 for(const draft of response.drafts){
  const source=response.drafts.length===1?text:draft.content;
  const relative=/后天/.test(source)?addDays(response.today,2):/明天/.test(source)?addDays(response.today,1):/昨天/.test(source)?addDays(response.today,-1):response.today;
  const targetDate=draft.startDate||draft.date||relative;
  const match=matchPersonalMemory(source,targetDate,memories);
  if(draft.kind==='plan'&&/下班后|下班之后|下班以后|起床后|午休后|上班后/.test(source)){
   if(match.startTime){draft.startDate=targetDate;draft.startTime=match.startTime;}
   const actionText=source.slice((source.search(/下班后|下班之后|下班以后|起床后|午休后|上班后/))+2);
   if(!/(?:截止|结束|完成于|(?:到|至).{0,8}(?:[点时]|\d[:：]\d{2}))/.test(actionText)){draft.date='';draft.time='';}else if(!draft.date)draft.date=targetDate;
  }
  for(const person of match.people){const profile=memories.find(m=>m.id===person.personId)!;draft.entities.people=draft.entities.people.filter(e=>![profile.label,...profile.aliases].includes(e.name));draft.entities.people.push({type:'person',...person});}
  for(const place of match.places)if(!draft.entities.places.some(e=>e.name===place.name))draft.entities.places.push({type:'place',...place});
  memoryMatches[draft.id]={applied:match.applied,questions:match.questions};
 }
 return {...response,memoryCandidates:memoryCandidates.filter(c=>!ignoredMemoryCandidate(ignored,c)),memoryMatches};
}
