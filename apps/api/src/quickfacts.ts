import crypto from "node:crypto";
import { ProxyAgent, request } from "undici";
import type { DiaryDocument, DiaryEvent, PinQuickFactRequest, QuickFact, TaggedEntity } from "@diary/contracts";
import { config, vaultPaths } from "./config.js";
import { addDays, todayInTimezone } from "./date.js";
import { readJson, writeJson, withVaultLock, listDiaryDates, loadDiary } from "./vault.js";
import type { EntityIndex } from "./entities.js";

const STORE_PATH = `${vaultPaths.system}/quick-facts.json`;
const DEFAULT_RETENTION_DAYS = 14;

type ActivityEnt = { type: "activity"; name: string; tags: string[] };
type PlaceEnt = { type: "place"; name: string; tags: string[] };
type PersonEnt = { type: "person"; name: string; tags: string[] };
type FoodEnt = { type: "food"; name: string; tags: string[] };

type PinnedEntry = {
  id: string;
  label: string;
  shortLabel?: string;
  note: string;
  time: string;
  activities: ActivityEnt[];
  places: PlaceEnt[];
  people: PersonEnt[];
  foods: FoodEnt[];
  createdAt: string;
  lastUsedAt: string;
  useCount: number;
};

function daysBetween(a: string, b: string): number {
  const da = new Date(`${a}T00:00:00Z`).getTime();
  const db = new Date(`${b}T00:00:00Z`).getTime();
  return Math.round((db - da) / 86_400_000);
}

/** 调用 AI 生成 4-5 字缩略名；失败时回退到活动名截断 */
async function generateShortLabel(fact: { note: string; activities: ActivityEnt[]; places: PlaceEnt[]; people: PersonEnt[]; foods: FoodEnt[] }): Promise<string | undefined> {
  if (!config.ai.key) return undefined;
  const summary = [
    fact.note && `内容：${fact.note}`,
    fact.activities.length && `活动：${fact.activities.map(a => a.name).join("、")}`,
    fact.places.length && `地点：${fact.places.map(p => p.name).join("、")}`,
    fact.people.length && `人物：${fact.people.map(p => p.name).join("、")}`,
    fact.foods.length && `食物：${fact.foods.map(f => f.name).join("、")}`,
  ].filter(Boolean).join("\n");
  try {
    const body = JSON.stringify({
      model: config.ai.model,
      temperature: 0.3,
      max_tokens: 40,
      messages: [
        {
          role: "system",
          content: "你是日记快捷按钮命名助手。根据用户给出的事件内容，生成一个 4-6 个汉字的极简缩略名，让人一眼看懂这是干什么。只输出缩略名本身，不要引号、不要标点、不要解释、不要emoji。",
        },
        { role: "user", content: summary },
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
    if (response.statusCode < 200 || response.statusCode >= 300) { await response.body.dump(); return undefined; }
    const payload = await response.body.json() as { choices?: Array<{ message?: { content?: string } }> };
    const content = payload.choices?.[0]?.message?.content?.trim();
    if (!content) return undefined;
    // 取第一行，去标点引号，截断到 8 字
    const cleaned = content.split(/\n/)[0].replace(/["''""`~!@#$%^&*()+={}[\]|\\:;"'<>,.?/！？。，、；：""''（）《》…—\s]/g, "").trim();
    return cleaned ? cleaned.slice(0, 8) : undefined;
  } catch {
    return undefined;
  }
}

/** 自动发现：近 N 天按活动组合分组的高频事实 */
export async function discoverQuickFacts(index: EntityIndex, days: number, limit: number): Promise<QuickFact[]> {
  const today = todayInTimezone(config.timezone);
  const start = addDays(today, -(days - 1));
  const dates = await listDiaryDates(start, today);
  const docs = await Promise.all(dates.map(async (date) => ({ date, doc: (await loadDiary(date)).document })));

  // signature (sorted activity names) -> { events, days: Set<date> }
  const groups = new Map<string, { events: DiaryEvent[]; days: Set<string> }>();
  for (const { date, doc } of docs) {
    for (const ev of doc.facts.events) {
      if (ev.activities.length === 0) continue;
      const sig = [...ev.activities].map((a) => a.name).sort().join("、");
      const g = groups.get(sig) || { events: [], days: new Set() };
      g.events.push(ev);
      g.days.add(date);
      groups.set(sig, g);
    }
  }

  const known = index.list("", undefined, 500);
  const tagged = <T extends TaggedEntity["type"]>(type: T, name: string): { type: T; name: string; tags: string[] } => ({
    type,
    name,
    tags: known.find((e) => e.type === type && e.name === name)?.tags || [],
  });

  const patterns = [...groups.entries()]
    .filter(([, g]) => g.days.size >= 2)
    .sort((a, b) => b[1].days.size - a[1].days.size)
    .slice(0, limit);

  return patterns.map(([sig, g]) => {
    const activities = [...new Map(g.events.flatMap((e) => e.activities).map((a) => [a.name, a])).values()]
      .map((a) => tagged("activity", a.name));
    // pick a representative note (most common non-empty note, else the signature)
    const noteCounts = new Map<string, number>();
    for (const ev of g.events) {
      const n = ev.note.trim();
      if (n) noteCounts.set(n, (noteCounts.get(n) || 0) + 1);
    }
    const note = [...noteCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || sig;
    // pick most frequent place
    type PlaceEnt = { type: "place"; name: string; tags: string[] };
    const placeCounts = new Map<string, { entity: PlaceEnt; count: number }>();
    for (const ev of g.events) {
      for (const p of ev.places) {
        const k = p.name;
        const e = placeCounts.get(k);
        if (e) e.count++;
        else placeCounts.set(k, { entity: tagged("place", p.name), count: 1 });
      }
    }
    const places = [...placeCounts.values()].sort((a, b) => b.count - a.count).slice(0, 1).map((x) => x.entity);
    // pick most frequent time
    const timeCounts = new Map<string, number>();
    for (const ev of g.events) if (ev.time) timeCounts.set(ev.time, (timeCounts.get(ev.time) || 0) + 1);
    const time = [...timeCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || "";
    return {
      source: "auto",
      label: sig,
      count: g.days.size,
      note,
      time,
      activities,
      places,
      people: [],
      foods: [],
    };
  });
}

async function readStore(): Promise<PinnedEntry[]> {
  return readJson<PinnedEntry[]>(STORE_PATH, []);
}

async function writeStore(entries: PinnedEntry[]): Promise<void> {
  await writeJson(STORE_PATH, entries);
}

function toQuickFact(e: PinnedEntry): QuickFact {
  return {
    id: e.id,
    source: "pinned",
    label: e.label,
    shortLabel: e.shortLabel,
    count: e.useCount,
    note: e.note,
    time: e.time,
    activities: e.activities,
    places: e.places,
    people: e.people,
    foods: e.foods,
    lastUsedAt: e.lastUsedAt,
  };
}

/** 列出未过期的钉选事实（读时衰减过滤） */
export async function listPinnedQuickFacts(retentionDays = DEFAULT_RETENTION_DAYS): Promise<QuickFact[]> {
  const store = await readStore();
  const today = todayInTimezone(config.timezone);
  return store
    .filter((e) => daysBetween(e.lastUsedAt, today) <= retentionDays)
    .sort((a, b) => b.lastUsedAt.localeCompare(a.lastUsedAt))
    .map(toQuickFact);
}

/** 钉选一条事实为快捷按钮 */
export async function pinQuickFact(index: EntityIndex, input: PinQuickFactRequest): Promise<QuickFact> {
  return withVaultLock(async () => {
    const store = await readStore();
    const today = todayInTimezone(config.timezone);
    const known = index.list("", undefined, 500);
    const fillTags = <T extends TaggedEntity["type"]>(type: T, items: TaggedEntity[]): Array<{ type: T; name: string; tags: string[] }> =>
      items.map((it) => ({
        type,
        name: it.name,
        tags: known.find((e) => e.type === type && e.name === it.name)?.tags || it.tags || [],
      }));
    const entry: PinnedEntry = {
      id: crypto.randomUUID(),
      label: input.label,
      note: input.note || "",
      time: input.time || "",
      activities: fillTags("activity", input.activities),
      places: fillTags("place", input.places),
      people: fillTags("person", input.people),
      foods: fillTags("food", input.foods),
      createdAt: today,
      lastUsedAt: today,
      useCount: 1,
    };
    // AI 生成缩略名（失败回退到第一个活动名截断）
    const aiShort = await generateShortLabel(entry);
    entry.shortLabel = aiShort || entry.activities[0]?.name.slice(0, 6) || entry.label.slice(0, 6);
    // de-dup by activity signature: if same activities already pinned, just bump useCount
    const sig = [...input.activities].map((a) => a.name).sort().join("、");
    const existingIdx = store.findIndex((e) => [...e.activities].map((a) => a.name).sort().join("、") === sig);
    if (existingIdx >= 0) {
      store[existingIdx].lastUsedAt = today;
      store[existingIdx].useCount += 1;
      if (!store[existingIdx].shortLabel) store[existingIdx].shortLabel = entry.shortLabel;
      await writeStore(store);
      return toQuickFact(store[existingIdx]);
    }
    store.push(entry);
    // clean up expired entries while we're here
    const fresh = store.filter((e) => daysBetween(e.lastUsedAt, today) <= DEFAULT_RETENTION_DAYS);
    await writeStore(fresh);
    return toQuickFact(entry);
  });
}

/** 点击使用钉选事实 → 续命 */
export async function useQuickFact(id: string): Promise<QuickFact | null> {
  return withVaultLock(async () => {
    const store = await readStore();
    const entry = store.find((e) => e.id === id);
    if (!entry) return null;
    entry.lastUsedAt = todayInTimezone(config.timezone);
    entry.useCount += 1;
    await writeStore(store);
    return toQuickFact(entry);
  });
}

/** 取消钉选 */
export async function unpinQuickFact(id: string): Promise<boolean> {
  return withVaultLock(async () => {
    const store = await readStore();
    const next = store.filter((e) => e.id !== id);
    if (next.length === store.length) return false;
    await writeStore(next);
    return true;
  });
}

/** 合并 auto + pinned */
export async function getAllQuickFacts(index: EntityIndex, days: number, limit: number): Promise<QuickFact[]> {
  const [auto, pinned] = await Promise.all([
    discoverQuickFacts(index, days, limit),
    listPinnedQuickFacts(),
  ]);
  // pinned 置顶，auto 按 count 降序
  return [...pinned, ...auto].slice(0, Math.max(limit, pinned.length));
}
