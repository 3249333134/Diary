import { sentenceSplitResultSchema, type EntityRecord, type SentenceSplitResult, type TaggedEntity } from "@diary/contracts";
import { ProxyAgent, request } from "undici";
import { config } from "./config.js";
import { todayInTimezone } from "./date.js";

function unique(items: TaggedEntity[]): TaggedEntity[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = item.name.normalize("NFKC").trim().toLocaleLowerCase("zh-CN");
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function readJsonObject(content: string): unknown {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const source = (fenced || content).trim();
  const start = source.search(/[[{]/);
  if (start < 0) throw new Error("响应中未找到 JSON");
  const end = source[start] === "[" ? source.lastIndexOf("]") : source.lastIndexOf("}");
  if (end <= start) throw new Error("响应中 JSON 不完整");
  return JSON.parse(source.slice(start, end + 1));
}

export async function splitSentenceWithAi(sentence: string, known: EntityRecord[]): Promise<SentenceSplitResult & { category: string; time: string; tags: string[] }> {
  if (!config.ai.key) throw Object.assign(new Error("尚未配置 AI 拆分服务"), { statusCode: 503 });
  const body = JSON.stringify({
    model: config.ai.model,
    temperature: 0.1,
    max_tokens: 1200,
    messages: [
      {
        role: "system",
        content: [
          "你是中文日记事件结构化助手。直接以 { 开头输出纯 JSON 对象，禁止任何解释、前后缀文字或 Markdown 代码块标记。",
          "顶层字段：people、places、activities、foods 四个数组放对应类型的实体（每项 {name,tags}），以及 category、time、tags。严禁把地点/活动/食物放进 people，严禁把 category/time/tags 放进实体数组。",
          "category 选 facts（发生的事）、learn（学到的知识）、input（阅读观看摘录）、idea（想法灵感）。time 只提取明确时间为24小时HH:mm；未给出或只有模糊时段返回空字符串，不猜分钟。",
          "tags 是 2-5 个概括本条内容主题的简短标签（2-6字，名词短语），如：产品设计、AI、旅行、美食、心理学。",
          "识别整句话中所有明确或可由语境直接判断的人物、地点、活动和食物，不要把整段从句当作实体。",
          "人物不包含说话者‘我/自己’。活动应是简洁动作短语，食物与地点不要互相混淆。",
          "严禁把字段标签（如‘在哪’、‘做了什么’、‘和谁’、‘吃了什么’、‘人物’、‘地点’、‘活动’、‘食物’及其带符号变体如‘- 在哪：’）当作实体名称。如果某个实体名称看起来像字段标签，直接忽略它。",
          "这是一次全新的独立记录，只提取本次 sentence 的实体。不补充历史事件的人物、地点、活动或食物；缺失的类别返回空数组。为实体根据本句语境给 1-3 个简短标签。",
          '示例：输入“晚上和小李在海底捞吃了火锅”，输出 {"people":[{"name":"小李","tags":["朋友"]}],"places":[{"name":"海底捞","tags":["餐厅"]}],"activities":[{"name":"吃火锅","tags":["聚餐"]}],"foods":[{"name":"火锅","tags":["川味"]}],"category":"facts","time":"","tags":["美食","聚餐"]}',
        ].join("\n"),
      },
      { role: "user", content: JSON.stringify({ sentence }) },
    ],
  });
  const dispatcher = config.ai.proxy ? new ProxyAgent(config.ai.proxy) : undefined;
  let lastError: unknown;
  for (let attempt = 1; attempt <= 2; attempt++) {
    let content = "";
    try {
      const response = await request(`${config.ai.url}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${config.ai.key}` },
        body,
        dispatcher,
        signal: AbortSignal.timeout(25_000),
        headersTimeout: 25_000,
        bodyTimeout: 25_000,
      });
      if (response.statusCode < 200 || response.statusCode >= 300) {
        await response.body.dump();
        throw Object.assign(new Error(`AI 拆分服务响应 ${response.statusCode}`), { statusCode: 502 });
      }
      const payload = await response.body.json() as { choices?: Array<{ message?: { content?: string } }> };
      content = payload.choices?.[0]?.message?.content?.trim() || "";
      if (!content) throw new Error("AI 拆分服务未返回结果");
      const raw = readJsonObject(content) as Record<string, unknown>;
    const fieldLabels = new Set(["在哪", "做了什么", "和谁", "吃了什么", "人物", "地点", "活动", "食物", "去哪", "见谁", "描述", "一句话", "事件备注", "时间"]);
    const isFieldLabel = (name: string) => {
      const cleaned = name.replace(/^[-—·•\s]+|[:：\s]+$/g, "").trim();
      return fieldLabels.has(cleaned);
    };
    const typed = (key: string, type: TaggedEntity["type"]) => unique(((raw[key] as Array<{ name?: unknown; tags?: unknown }>) || []).map((item) => ({
      type,
      name: typeof item.name === "string" ? item.name.trim() : "",
      tags: Array.isArray(item.tags) ? item.tags.filter((tag): tag is string => typeof tag === "string").map((tag) => tag.trim()).filter(Boolean).slice(0, 3) : [],
    })).filter((item) => item.name && !isFieldLabel(item.name)));
    const result = {
      people: typed("people", "person"),
      places: typed("places", "place"),
      activities: typed("activities", "activity"),
      foods: typed("foods", "food"),
    };
    for (const group of Object.values(result)) for (const item of group) {
      const existing = known.find((entity) => entity.type === item.type && entity.name === item.name);
      if (existing) item.tags = existing.tags;
      else item.tags = (item.tags.length ? item.tags : [item.type === "person" ? "人物" : item.type === "place" ? "地点" : item.type === "activity" ? "活动" : "饮食"]).slice(0, 3);
    }
    const metadata = raw as unknown as { category?: string; time?: string; tags?: unknown };
    const tags = Array.isArray(metadata.tags)
      ? metadata.tags.filter((t): t is string => typeof t === "string").map((t) => t.trim()).filter(Boolean).slice(0, 6)
      : [];
    return { ...sentenceSplitResultSchema.parse(result), category: ["facts", "learn", "input", "idea"].includes(metadata.category || "") ? metadata.category! : "facts", time: /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(metadata.time || "") ? metadata.time! : "", tags };
    } catch (error) {
      lastError = error;
      console.error(`[split] AI 拆分第 ${attempt} 次失败:`, error instanceof Error ? error.message : error, content ? `内容片段: ${content.slice(0, 300)}` : "");
    }
  }
  console.error("[split] AI 拆分最终失败:", lastError instanceof Error ? lastError.message : lastError);
  throw Object.assign(new Error("AI 返回的拆分格式无法识别，请重试"), { statusCode: 502 });
}

/** AI 根据文本内容推荐标签 */
export async function suggestTags(text: string, kind: "idea" | "learn" | "input"): Promise<string[]> {
  if (!config.ai.key) throw Object.assign(new Error("尚未配置 AI 服务"), { statusCode: 503 });
  const kindLabel = kind === "idea" ? "灵感" : kind === "learn" ? "新知" : "输入";
  const body = JSON.stringify({
    model: config.ai.model,
    temperature: 0.2,
    max_tokens: 300,
    messages: [
      {
        role: "system",
        content: [
          `你是标签助手。根据用户提供的${kindLabel}内容，提取 2-5 个简短、有意义的标签。`,
          "要求：",
          "- 每个标签 2-6 个字，用名词或名词短语",
          "- 标签应能概括内容的主题、领域或关键词",
          "- 优先提取具体概念（如：产品设计、AI、心理学、旅行、美食），避免空泛词（如：重要、有趣）",
          "- 只输出 JSON 数组，不要 Markdown，不要解释",
          '示例输出：["产品设计","用户体验","AI"]',
        ].join("\n"),
      },
      { role: "user", content: text },
    ],
  });
  const dispatcher = config.ai.proxy ? new ProxyAgent(config.ai.proxy) : undefined;
  const response = await request(`${config.ai.url}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${config.ai.key}` },
    body,
    dispatcher,
    signal: AbortSignal.timeout(15_000),
    headersTimeout: 15_000,
    bodyTimeout: 15_000,
  });
  if (response.statusCode < 200 || response.statusCode >= 300) {
    await response.body.dump();
    throw Object.assign(new Error(`AI 服务响应 ${response.statusCode}`), { statusCode: 502 });
  }
  const payload = await response.body.json() as { choices?: Array<{ message?: { content?: string } }> };
  const content = payload.choices?.[0]?.message?.content?.trim();
  if (!content) return [];
  try {
    const raw = readJsonObject(content);
    if (Array.isArray(raw)) {
      return raw.filter((t): t is string => typeof t === "string").map(t => t.trim()).filter(Boolean).slice(0, 6);
    }
    console.error("[suggestTags] AI 返回非数组:", content.slice(0, 200));
    return [];
  } catch (error) {
    console.error("[suggestTags] AI 标签解析失败:", error instanceof Error ? error.message : error, content.slice(0, 200));
    return [];
  }
}

/** 从自然语言文本解析待办属性：标题、截止时间、优先级、清单、标签 */
export async function parseTodoFromText(text: string): Promise<{
  title: string;
  dueDate: string;
  dueTime: string;
  priority: string;
  list: string;
  tags: string[];
}> {
  if (!config.ai.key) throw Object.assign(new Error("尚未配置 AI 服务"), { statusCode: 503 });
  const today = todayInTimezone();
  const body = JSON.stringify({
    model: config.ai.model,
    temperature: 0.1,
    max_tokens: 800,
    messages: [
      {
        role: "system",
        content: [
          "你是待办任务解析助手。从用户输入的自然语言中提取待办属性，只输出一个 JSON 对象，不要 Markdown。",
          `当前日期是 ${today}。所有相对日期（今天、明天、后天、下周一等）都必须基于此日期计算。`,
          "字段说明：",
          "- title: 去掉时间、优先级等关键词后的纯任务标题",
          "- dueDate: 截止日期 YYYY-MM-DD，基于当前日期计算相对日期；无明确日期返回空字符串",
          "- dueTime: 截止时间 HH:mm（24小时制），无明确时间返回空字符串",
          "- priority: high / medium / low，用户说高优先级/紧急/重要→high，低优先级/不急→low，否则 medium",
          "- list: 所属清单/分类，从工作、生活、学习、健康、财务、其他中选择最匹配的，不确定返回空字符串",
          "- tags: 1-3 个简短标签数组，根据任务内容提取（如方案、外出、沟通、采购、写作等）",
        ].join("\n"),
      },
      { role: "user", content: text },
    ],
  });
  const dispatcher = config.ai.proxy ? new ProxyAgent(config.ai.proxy) : undefined;
  const response = await request(`${config.ai.url}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${config.ai.key}` },
    body,
    dispatcher,
    signal: AbortSignal.timeout(25_000),
    headersTimeout: 25_000,
    bodyTimeout: 25_000,
  });
  if (response.statusCode < 200 || response.statusCode >= 300) {
    await response.body.dump();
    throw Object.assign(new Error(`AI 服务响应 ${response.statusCode}`), { statusCode: 502 });
  }
  const payload = await response.body.json() as { choices?: Array<{ message?: { content?: string } }> };
  const content = payload.choices?.[0]?.message?.content?.trim();
  if (!content) throw Object.assign(new Error("AI 未返回结果"), { statusCode: 502 });
  try {
    const raw = readJsonObject(content) as Record<string, unknown>;
    const title = typeof raw.title === "string" ? raw.title.trim() : text;
    const dueDate = typeof raw.dueDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw.dueDate) ? raw.dueDate : "";
    const dueTime = typeof raw.dueTime === "string" && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(raw.dueTime) ? raw.dueTime : "";
    const priority = typeof raw.priority === "string" && ["high", "medium", "low"].includes(raw.priority) ? raw.priority : "medium";
    const list = typeof raw.list === "string" ? raw.list.trim() : "";
    const tags = Array.isArray(raw.tags) ? raw.tags.filter((t): t is string => typeof t === "string").map(t => t.trim()).filter(Boolean).slice(0, 5) : [];
    return { title, dueDate, dueTime, priority, list, tags };
  } catch {
    throw Object.assign(new Error("AI 返回格式无法识别"), { statusCode: 502 });
  }
}
