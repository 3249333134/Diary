import { randomUUID } from 'node:crypto';
import { captureDraftSchema, captureRequestSchema } from '@diary/contracts';
import type { z } from 'zod';
import { todayInTimezone, assertDate } from './date.js';
import { config } from './config.js';
import { request, ProxyAgent } from 'undici';

/** Configured AI parsing with an explicitly unconfirmed manual fallback. */
export async function parseCapture(input: z.infer<typeof captureRequestSchema>, known: { names: string[]; tags: string[] } = { names: [], tags: [] }) {
  const today = todayInTimezone(config.timezone);
  if (config.ai.key) {
    try {
      const response = await request(`${config.ai.url}/chat/completions`, {
        method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${config.ai.key}` },
        dispatcher: config.ai.proxy ? new ProxyAgent(config.ai.proxy) : undefined, signal: AbortSignal.timeout(25_000),
        body: JSON.stringify({ model: config.ai.model, temperature: .1, messages: [
          { role: 'system', content: `你是日记与计划录入助手。只返回 JSON {drafts:[]}，混合输入拆成独立条目。每条 kind 为 plan/facts/learn/input/idea，content 为原意正文，description 为说明，date 为 YYYY-MM-DD 或空，time 为明确 HH:mm 或空，tags 为标签数组，entities 为 people/places/activities/foods 数组，每个实体 {type,name,tags}。未来安排用 plan，已发生用 facts。现实今天是 ${today}，时区 ${config.timezone}；相对日期据此计算，不根据浏览日期。无日期日记用今天，无日期计划留空，不猜分钟。计划 startDate/startTime 表示原定开始，date/time 表示截止；只有开始安排时不要当作截止。category 为 work/personal/null，important/urgent 为 boolean/null，仅有明确依据才设置。priority 为 high/medium/low，list 为清单字符串。含糊日期返回 needsReview:true,reviewReason。不猜人物、地点、成果或感受，不把计划目标当作已发生事实。沿用已知名称和标签，但不得补入无关实体。` },
          { role: 'user', content: JSON.stringify({ text: input.text, completion: input.completion, known }) },
        ] }),
      });
      if (response.statusCode >= 300) { await response.body.dump(); throw new Error('AI 服务响应异常'); }
      const payload = await response.body.json() as { choices?: { message?: { content?: string } }[] };
      const text = payload.choices?.[0]?.message?.content || '';
      const raw = JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, '')) as { drafts?: unknown[] };
      if (!Array.isArray(raw.drafts) || !raw.drafts.length || raw.drafts.length > 30) throw new Error('草稿格式异常');
      const drafts = raw.drafts.map(item => {
        const draft = captureDraftSchema.parse({ ...(item as object), id: randomUUID() });
        if (draft.kind !== 'plan' && !draft.date) draft.date = today;
        if (draft.date) assertDate(draft.date);
        if (draft.startDate) assertDate(draft.startDate);
        return draft;
      });
      return { today, timezone: config.timezone, mode: 'ai', drafts };
    } catch { /* Preserve original text for manual confirmation. */ }
  }
  return { today, timezone: config.timezone, mode: 'manual', drafts: [captureDraftSchema.parse({
    id: randomUUID(), kind: 'facts', date: input.completion?.date || today, time: input.completion?.time || '',
    content: input.text, needsReview: true, reviewReason: '当前为手动草稿，请选择用途并核对日期和内容。',
  })] };
}
