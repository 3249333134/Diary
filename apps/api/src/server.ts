import Fastify from "fastify";
import { captureRequestSchema } from '@diary/contracts';
import { parseCapture } from './capture.js';
import cors from "@fastify/cors";
import { ProxyAgent, request as undiciRequest } from "undici";
import { placeParentSchema, entityTypeSchema, pinQuickFactRequestSchema, sentenceSplitRequestSchema, tagCreateSchema, weeklySummaryRequestSchema } from "@diary/contracts";
import { ZodError } from "zod";
import { config, vaultPaths } from "./config.js";
import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { assertDate, addDays, todayInTimezone, weekStart } from "./date.js";
import { EntityIndex } from "./entities.js";
import { listDiaryDates, loadDiary, saveDiary } from "./vault.js";
import { generateWeeklySummary } from "./weekly.js";
import { splitSentenceWithAi, parseTodoFromText, suggestTags } from "./split.js";
import { listActions, changeAction, actionRequestSchema } from './actions.js';
import { getAllQuickFacts, pinQuickFact, useQuickFact, unpinQuickFact } from "./quickfacts.js";

// ── SPA 静态文件服务：原生 fs ──
const distPath = path.resolve(fileURLToPath(new URL("../../web/dist", import.meta.url)));
const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".ico": "image/x-icon",
  ".map": "application/json",
};

import { addSharedTag, tagLibrary, getPlanCategories, addPlanCategory, getPlanViews, savePlanViews } from './planSettings.js';

function safeJoin(root: string, ...parts: string[]) {
  const joined = path.join(root, ...parts);
  if (!joined.startsWith(path.resolve(root))) throw new Error("path traversal blocked");
  return joined;
}

export async function buildServer(index = new EntityIndex()) {
  const app = Fastify({ logger: { redact: ["req.headers.authorization", "req.body", "res.body"] }, bodyLimit: 10_485_760 });

  // CORS — 放开 remote 代理和本地
  await app.register(cors, { origin: true, credentials: true });

  await index.rebuild();
  index.startWatching();
  app.addHook("onClose", async () => index.close());

  /* ── 健康检查 ── */
  app.get("/api/health", async () => ({ ok: true, localOnly: config.host === "127.0.0.1", timezone: config.timezone }));
  app.get<{ Params: { date: string } }>("/api/obsidian/:date", async (request, reply) => {
    const date = assertDate(request.params.date);
    if (!(await loadDiary(date)).exists) return reply.code(404).send({ error: "请先保存这一天的日记" });
    return { uri: `obsidian://open?path=${encodeURIComponent(path.join(config.vaultRoot, vaultPaths.daily, `${date}.md`))}` };
  });
  app.get<{ Params: { date: string } }>("/api/diaries/:date", async (request) => loadDiary(assertDate(request.params.date)));
  app.put<{ Params: { date: string } }>("/api/diaries/:date", async (request, reply) => {
    if (request.headers['x-diary-record-version'] !== '2') return reply.code(428).send({ error: '日记结构已升级，请刷新页面后再保存，避免丢失关联。' });
    const expected = String(request.headers["if-match"] || "").replace(/^W\//, "").replace(/^"|"$/g, "");
    if (!expected) return reply.code(428).send({ error: "保存前需要日记版本" });
    const result = await saveDiary(assertDate(request.params.date), request.body, expected);
    await index.rebuild();
    return result;
  });
  app.get<{ Querystring: { from?: string; to?: string } }>("/api/diaries", async (request) => ({ dates: await listDiaryDates(request.query.from, request.query.to) }));
  app.get('/api/actions', async () => listActions());
  app.post('/api/actions', async request => { const result = await changeAction(actionRequestSchema.parse(request.body)); await index.rebuild(); return result; });
  app.get<{ Querystring: { date?: string } }>("/api/weeks", async (request) => {
    const date = assertDate(request.query.date || todayInTimezone(config.timezone));
    const start = weekStart(date);
    const dates = await listDiaryDates(start, addDays(start, 6));
    return { start, end: addDays(start, 6), entries: await Promise.all(dates.map(async (item) => ({ date: item, document: (await loadDiary(item)).document }))) };
  });
  app.get<{ Querystring: { q?: string; type?: string; limit?: string } }>("/api/entities", async (request) => {
    const type = request.query.type ? entityTypeSchema.parse(request.query.type) : undefined;
    return { entities: index.list(request.query.q, type, Number(request.query.limit || 100)) };
  });
  app.get<{ Params: { type: string; name: string } }>("/api/entities/:type/:name", async (request, reply) => {
    const type = entityTypeSchema.parse(request.params.type);
    const entity = index.get(type, request.params.name);
    return entity || reply.code(404).send({ error: "未找到该实体" });
  });
  app.put("/api/place-parent", async request => {
    const { key, parentKey } = placeParentSchema.parse(request.body);
    await index.setPlaceParent(key, parentKey);
    return { entities: index.list("", undefined, 500) };
  });
  app.get("/api/tags", async () => {
    const typed = index.getTags(), shared = await tagLibrary(typed);
    return { tags: Object.fromEntries(Object.keys(typed).map(type => [type, [...new Set([...typed[type as keyof typeof typed], ...shared])]])), sharedTags: shared };
  });
  app.get('/api/tag-library', async () => ({ tags: await tagLibrary(index.getTags()) }));
  app.post<{ Body: { tag: string } }>('/api/tag-library', async request => { await addSharedTag(request.body.tag); return { tags: await tagLibrary(index.getTags()) }; });
  app.get('/api/plan-categories', async () => ({categories: await getPlanCategories()}));
  app.post('/api/plan-categories', async request => addPlanCategory(request.body));
  app.get('/api/plan-views', async () => ({ views: await getPlanViews() }));
  app.put<{ Body: { views: unknown } }>('/api/plan-views', async request => { await savePlanViews(request.body.views); return { views: await getPlanViews() }; });
  app.post("/api/tags", async (request) => {
    const input = tagCreateSchema.parse(request.body);
    const typed = await index.addTag(input.type, input.name), shared = await tagLibrary(typed);
    return { tags: Object.fromEntries(Object.keys(typed).map(type => [type, [...new Set([...typed[type as keyof typeof typed], ...shared])]])) };
  });
  app.post('/api/capture/parse', async (request) => parseCapture(captureRequestSchema.parse(request.body), { names: index.list('', undefined, 500).map(entity => entity.name), tags: await tagLibrary(index.getTags()) }));
  app.post("/api/split-sentence", async (request) => {
    const input = sentenceSplitRequestSchema.parse(request.body);
    return { result: await splitSentenceWithAi(input.sentence, index.list("", undefined, 500)), mode: "ai" as const };
  });

  /* ── 快捷事实（Quick Facts）：自动发现 + 钉选衰减 ── */
  app.get<{ Querystring: { days?: string; limit?: string } }>("/api/quick-facts", async (request) => {
    const days = Math.min(Math.max(Number(request.query.days || 30), 7), 90);
    const limit = Math.min(Math.max(Number(request.query.limit || 15), 1), 40);
    return { facts: await getAllQuickFacts(index, days, limit) };
  });
  app.post("/api/quick-facts/pin", async (request) => {
    const input = pinQuickFactRequestSchema.parse(request.body);
    return await pinQuickFact(index, input);
  });
  app.post<{ Params: { id: string } }>("/api/quick-facts/:id/use", async (request, reply) => {
    const result = await useQuickFact(request.params.id);
    return result || reply.code(404).send({ error: "未找到该快捷事实" });
  });
  app.delete<{ Params: { id: string } }>("/api/quick-facts/:id", async (request, reply) => {
    const ok = await unpinQuickFact(request.params.id);
    return ok ? { ok: true } : reply.code(404).send({ error: "未找到该快捷事实" });
  });

  /** AI 解析待办文本 → 提取标题/截止时间/优先级/清单/标签 */
  app.post<{ Body: { text: string } }>("/api/parse-todo", async (request) => {
    const text = typeof request.body?.text === "string" ? request.body.text.trim() : "";
    if (!text) return { title: "", dueDate: "", dueTime: "", priority: "medium", list: "", tags: [] };
    return await parseTodoFromText(text);
  });

  /** AI 根据内容推荐标签 */
  app.post<{ Body: { text: string; kind: "idea" | "learn" | "input" } }>("/api/suggest-tags", async (request) => {
    const text = typeof request.body?.text === "string" ? request.body.text.trim() : "";
    const kind = request.body?.kind === "learn" || request.body?.kind === "input" ? request.body.kind : "idea";
    if (!text) return [];
    return await suggestTags(text, kind);
  });

  /** 逆向地理编码：经纬度 → 地点名 */
  app.get<{ Querystring: { lat: string; lng: string } }>("/api/reverse-geocode", async (request, reply) => {
    const lat = parseFloat(request.query.lat);
    const lng = parseFloat(request.query.lng);
    if (isNaN(lat) || isNaN(lng)) return reply.code(400).send({ error: "无效的经纬度" });
    try {
      const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=14&accept-language=zh-CN`;
      const dispatcher = config.ai.proxy ? new ProxyAgent(config.ai.proxy) : undefined;
      const response = await undiciRequest(url, {
        method: "GET",
        headers: { "User-Agent": "DiaryApp/1.0" },
        dispatcher,
        signal: AbortSignal.timeout(10_000),
        headersTimeout: 10_000,
        bodyTimeout: 10_000,
      });
      if (response.statusCode < 200 || response.statusCode >= 300) {
        await response.body.dump();
        return reply.code(502).send({ error: `地理编码服务响应 ${response.statusCode}` });
      }
      const data = await response.body.json() as { address?: Record<string, string>; display_name?: string };
      const addr = data.address || {};
      // 优先返回有意义的中文地名
      const name = addr.suburb || addr.neighbourhood || addr.road || addr.city || addr.town || addr.village || addr.county || addr.state || "";
      return { name: name || data.display_name?.split(",")[0] || `${lat.toFixed(4)}, ${lng.toFixed(4)}`, address: data.display_name || "", lat, lng };
    } catch {
      return reply.code(502).send({ error: "地理编码服务不可用" });
    }
  });

  /** AI 为小票生成个性化 remark + 日总结 */
  app.post<{ Body: { receipts: Array<{ id: string; kind: string; content: string; details?: string[] }>; date?: string } }>(
    "/api/receipts/remarks",
    async (request, reply) => {
      if (!config.ai.key) return reply.code(503).send({ error: "尚未配置 AI 服务" });
      const items = request.body.receipts.slice(0, 40);
      const body = JSON.stringify({
        model: config.ai.model,
        temperature: 0.9,
        max_tokens: 1500,
        messages: [
          {
            role: "system",
            content: [
              "你是中文日记小票润色助手。只输出一个 JSON 对象，不要 Markdown。",
              "对象包含 remarks（{小票id: 一句话}）和 daySummary（字符串）。",
              "每张小票的一句话要温暖、具体、不空洞，12-22 字之间。根据 kind 和内容选不同语气：事实偏治愈、新知偏欣喜、输入偏沉静、灵感偏明亮。",
              "daySummary 是对全天 2-3 句的整体感受，要真诚，不要套话。",
              "保持克制，不要用感叹号堆砌，不要说'真棒''加油'这类空洞鼓励。",
            ].join("\n"),
          },
          { role: "user", content: JSON.stringify({ date: request.body.date, items }) },
        ],
      });
      const dispatcher = config.ai.proxy ? new ProxyAgent(config.ai.proxy) : undefined;
      const response = await undiciRequest(`${config.ai.url}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${config.ai.key}` },
        body, dispatcher,
        signal: AbortSignal.timeout(20_000),
        headersTimeout: 20_000, bodyTimeout: 20_000,
      });
      if (response.statusCode < 200 || response.statusCode >= 300) { await response.body.dump(); return reply.code(502).send({ error: "AI 响应异常" }); }
      const payload = await response.body.json() as { choices?: Array<{ message?: { content?: string } }> };
      const text = payload.choices?.[0]?.message?.content?.trim();
      if (!text) return reply.code(502).send({ error: "AI 未返回内容" });
      try {
        const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
        const raw = JSON.parse(fenced || text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
        const remarks: Record<string, string> = {};
        for (const [k, v] of Object.entries(raw.remarks || {})) {
          if (typeof v === "string" && v.trim()) remarks[k] = v.trim().slice(0, 60);
        }
        const daySummary = typeof raw.daySummary === "string" ? raw.daySummary.trim().slice(0, 80) : "";
        return { remarks, daySummary };
      } catch { return reply.code(502).send({ error: "AI 返回格式异常" }); }
    },
  );

  app.post("/api/weekly-summaries", async (request) => {
    const input = weeklySummaryRequestSchema.parse(request.body || {});
    return generateWeeklySummary(input.date || todayInTimezone(config.timezone), { useAi: input.useAi ?? Boolean(config.ai.key) });
  });

  // Custom parser: save raw multipart body into request.body so handler can parse it manually
  app.addContentTypeParser("multipart/form-data", function (_, payload, done) {
    const chunks: Buffer[] = [];
    payload.on("data", (chunk: Buffer) => chunks.push(chunk));
    payload.on("end", () => { done(null, Buffer.concat(chunks)); });
    payload.on("error", () => { done(null, Buffer.alloc(0)); });
  });

  app.post("/api/upload", async (request, reply) => {
    const boundaryMatch = (request.headers["content-type"] || "").match(/boundary=(?:"([^"]+)"|([^;]+))/i);
    if (!boundaryMatch) return reply.code(400).send({ error: "缺少 boundary" });
    const boundary = (boundaryMatch[1] || boundaryMatch[2]!).trim();
    const body = request.body as Buffer;
    if (!body || !body.length) return reply.code(400).send({ error: "请求体为空" });
    const delimiter = Buffer.from(`--${boundary}`);
    const closing = Buffer.from(`--${boundary}--`);
    const nameMatch = /name="([^"]+)"(?:;\s*filename="([^"]+)")?/;
    let offset = 0;
    let filename = "";
    let fileBuf: Buffer | null = null;
    while (offset < body.length) {
      const endDelim = body.indexOf(delimiter, offset);
      if (endDelim < 0) break;
      if (body.subarray(endDelim, endDelim + closing.length).equals(closing)) break;
      const headerEnd = body.indexOf(Buffer.from("\r\n\r\n"), endDelim);
      if (headerEnd < 0) break;
      const headerText = body.subarray(endDelim + delimiter.length + 2, headerEnd).toString("utf8");
      const valueStart = headerEnd + 4;
      const nextDelim = body.indexOf(delimiter, valueStart);
      if (nextDelim < 0) break;
      const value = body.subarray(valueStart, nextDelim - 2);
      const m = nameMatch.exec(headerText);
      if (m && m[2]) { filename = m[2]; fileBuf = value; }
      offset = nextDelim;
    }
    if (!fileBuf || fileBuf.length === 0) return reply.code(400).send({ error: "未收到文件" });
    const sizeLimit = 8 * 1024 * 1024;
    if (fileBuf.length > sizeLimit) return reply.code(413).send({ error: "文件超过 8MB" });
    const dateParam = (request.query as { date?: string }).date || todayInTimezone(config.timezone);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateParam)) return reply.code(400).send({ error: "日期格式不正确" });
    const ext = path.extname(filename || "").toLowerCase() || ".png";
    const allowed = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".pdf", ".txt"]);
    if (!allowed.has(ext)) return reply.code(400).send({ error: "不支持的文件类型" });
    const yearMonth = dateParam.slice(0, 7);
    const assetsDir = path.resolve(config.vaultRoot, "assets", yearMonth);
    fs.mkdirSync(assetsDir, { recursive: true });
    const baseName = crypto.randomUUID().replace(/-/g, "");
    const fileName = `${baseName}${ext}`;
    const targetPath = path.join(assetsDir, fileName);
    fs.writeFileSync(targetPath, fileBuf);
    const relPath = `assets/${yearMonth}/${fileName}`;
    return { path: relPath, name: filename || fileName, size: fileBuf.length };
  });

  /* ── Vault assets static serving (images etc.) ── */
  app.get("/assets/:yearMonth/:file", async (request, reply) => {
    const { yearMonth, file } = request.params as { yearMonth: string; file: string };
    if (!/^\d{4}-\d{2}$/.test(yearMonth)) return reply.code(400).send("bad");
    if (/[\/\\]/.test(file)) return reply.code(400).send("bad");
    const filePath = safeJoin(path.resolve(config.vaultRoot, "assets"), yearMonth, file);
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return reply.code(404).send();
    const ext = path.extname(file).toLowerCase();
    reply.header("Content-Type", MIME[ext] || "application/octet-stream");
    reply.header("Cache-Control", "public, max-age=2592000");
    reply.send(fs.readFileSync(filePath));
  });

  /* ── SPA fallback + 原生静态文件服务 ── */
  app.get("/*", async (request, reply) => {
    const raw = String((request.params as Record<string, string>)["*"] || "");
    // 安全校验（path traversal）
    const safeRaw = raw.startsWith("/") ? raw.slice(1) : raw;

    // 如果有扩展名 → 尝试当静态文件
    const ext = path.extname(safeRaw).toLowerCase();
    if (ext && MIME[ext]) {
      try {
        const filePath = safeJoin(distPath, safeRaw);
        if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
          const buf = fs.readFileSync(filePath);
          reply.header("Content-Type", MIME[ext]);
          reply.header("Cache-Control", "public, max-age=86400, immutable");
          reply.send(buf);
          return;
        }
      } catch { /* traversal 或文件不存在 → fallback 到 index.html */ }
    }

    // 否则 fallback → index.html（SPA 路由）
    const indexPath = safeJoin(distPath, "index.html");
    if (fs.existsSync(indexPath)) {
      reply.header("Content-Type", "text/html; charset=utf-8");
      reply.header("Cache-Control", "no-cache");
      reply.send(fs.readFileSync(indexPath));
      return;
    }
    reply.code(404).send("前端未构建，请先运行 npm run build");
  });

  app.setErrorHandler((error, _request, reply) => {
    const detail = error as Error & { statusCode?: number; code?: string; current?: unknown };
    if (detail.statusCode === 409) return reply.code(409).send({ error: detail.message, code: detail.code, current: detail.current });
    if (error instanceof ZodError) return reply.code(400).send({ error: "请求内容不符合日记数据格式", issues: error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })) });
    const status = detail.statusCode && detail.statusCode >= 400 && detail.statusCode <= 599 ? detail.statusCode : 500;
    if (status >= 500) app.log.error({ err: error }, "request failed");
    return reply.code(status).send({ error: status >= 500 ? "服务暂时无法完成请求" : detail.message });
  });
  return app;
}
