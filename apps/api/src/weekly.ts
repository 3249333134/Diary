import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { ProxyAgent, request } from "undici";
import type { DiaryDocument } from "@diary/contracts";
import { config, vaultPaths } from "./config.js";
import { addDays, todayInTimezone, weekLabel, weekStart, zonedClock } from "./date.js";
import { atomicWrite, loadDiary } from "./vault.js";

type SummaryResult = { ok: true; mode: "ai" | "rule"; week: string; count: number; summaryPath: string; materialPath?: string } | { ok: false; skipped: true; reason: string };

function readable(document: DiaryDocument): string {
  const fact = document.facts.events.map((event) => `- ${event.time ? `[${event.time}] ` : ""}${event.note || [...event.people, ...event.places, ...event.activities, ...event.foods].map((item) => item.name).join("、")}${event.remark ? `\n  - 事件备注：${event.remark}` : ""}`).join("\n");
  return [`### ${document.date}`, "#### 今日事实", fact || "（无）", "#### 今日新知", document.learn.content || "（无）", "#### 输入记录", document.input.excerpt || "（无）", "#### 灵感碎片", document.idea.content || "（无）"].join("\n");
}

async function callAi(source: string): Promise<string> {
  const endpoint = `${config.ai.url}/chat/completions`;
  const body = JSON.stringify({
    model: config.ai.model,
    temperature: 0.35,
    max_tokens: 1800,
    messages: [
      { role: "system", content: "你是私人日记整理助手。只根据提供的事实总结，不虚构。输出中文 Markdown，包含本周脉络、值得记住的事、学到的内容、可继续行动四部分。" },
      { role: "user", content: source.slice(0, 8000) },
    ],
  });
  let lastError: unknown;
  const dispatcher = config.ai.proxy ? new ProxyAgent(config.ai.proxy) : undefined;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await request(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${config.ai.key}` },
        body,
        dispatcher,
        signal: AbortSignal.timeout(25_000),
        headersTimeout: 25_000,
        bodyTimeout: 25_000,
      });
      if (response.statusCode < 200 || response.statusCode >= 300) throw new Error(`AI 服务响应 ${response.statusCode}`);
      const result = await response.body.json() as { choices?: Array<{ message?: { content?: string } }> };
      const content = result.choices?.[0]?.message?.content?.trim();
      if (!content) throw new Error("AI 服务未返回内容");
      return content;
    } catch (error) { lastError = error; }
  }
  throw lastError instanceof Error ? lastError : new Error("AI 服务调用失败");
}

function ruleSummary(documents: DiaryDocument[], source: string): string {
  const facts = documents.reduce((sum, item) => sum + item.facts.events.length, 0);
  const learned = documents.filter((item) => item.learn.content.trim()).length;
  const ideas = documents.filter((item) => item.idea.content.trim()).length;
  return [`> 本摘要由本地规则生成，未向外部服务发送日记。`, "", "## 本周概览", `- 记录 ${documents.length} 天，共 ${facts} 个事实事件。`, `- ${learned} 天记录了新知，${ideas} 天留下了灵感。`, "", "## 每日记录", source].join("\n");
}

export async function generateWeeklySummary(date = todayInTimezone(config.timezone), options: { useAi?: boolean } = {}): Promise<SummaryResult> {
  const start = weekStart(date);
  const documents: DiaryDocument[] = [];
  for (let offset = 0; offset < 7; offset++) {
    const entry = await loadDiary(addDays(start, offset));
    if (entry.exists) documents.push(entry.document);
  }
  if (!documents.length) return { ok: false, skipped: true, reason: "本周暂无日记" };
  const source = documents.map(readable).join("\n\n");
  const useAi = options.useAi === true && Boolean(config.ai.key);
  const content = useAi ? await callAi(source) : ruleSummary(documents, source);
  const week = weekLabel(start);
  const summaryRelative = `${vaultPaths.weekly}/${week}.md`;
  const summary = [`---`, `type: weekly-summary`, `week: ${week}`, `start: ${start}`, `end: ${addDays(start, 6)}`, `diaryCount: ${documents.length}`, `mode: ${useAi ? "ai" : "rule"}`, `tags: [周复盘, 独立日记]`, `---`, "", `# 周复盘 ${week}`, "", content, "", "## 原始日记", ...documents.map((item) => `- [[${vaultPaths.daily}/${item.date}|${item.date}]]`), ""].join("\n");
  await atomicWrite(summaryRelative, summary);

  const learned = documents.filter((item) => item.learn.content.trim()).map((item) => `## ${item.date}\n${item.learn.content}`).join("\n\n");
  let materialPath: string | undefined;
  if (learned) {
    materialPath = `${vaultPaths.material}/${week}-素材.md`;
    await atomicWrite(materialPath, [`---`, `type: material`, `week: ${week}`, `tags: [素材库, 独立日记]`, `---`, "", `# 本周新知素材 ${week}`, "", learned, ""].join("\n"));
  }
  return { ok: true, mode: useAi ? "ai" : "rule", week, count: documents.length, summaryPath: summaryRelative, materialPath };
}

type SchedulerState = { lastWeek?: string; completedAt?: string; mode?: string };

export function isAfterWeeklyRunTime(clock: { weekday: number; hour: number }): boolean {
  return clock.weekday === 0 || clock.weekday > 1 || (clock.weekday === 1 && clock.hour >= 8);
}

export function startWeeklyScheduler(): NodeJS.Timeout {
  const statePath = path.join(config.dataDir, "scheduler-state.json");
  let running = false;
  const tick = async () => {
    if (running) return;
    const clock = zonedClock(config.timezone);
    const afterMondayEight = isAfterWeeklyRunTime(clock);
    if (!afterMondayEight) return;
    const targetWeek = weekLabel(clock.date);
    let state: SchedulerState = {};
    try { state = JSON.parse(await readFile(statePath, "utf8")) as SchedulerState; } catch { /* first run */ }
    if (state.lastWeek === targetWeek) return;
    running = true;
    try {
      const result = await generateWeeklySummary(clock.date, { useAi: config.ai.automatic });
      if (result.ok) {
        await mkdir(config.dataDir, { recursive: true });
        await writeFile(statePath, `${JSON.stringify({ lastWeek: targetWeek, completedAt: new Date().toISOString(), mode: result.mode }, null, 2)}\n`, "utf8");
      }
    } finally { running = false; }
  };
  void tick();
  return setInterval(() => void tick(), 60_000);
}
