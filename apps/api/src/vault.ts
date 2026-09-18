import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { diaryDocumentSchema, emptyDiary, type DiaryDocument, type DiaryResponse } from "@diary/contracts";
import { config, vaultPaths } from "./config.js";
import { assertDate } from "./date.js";
import { parseDiaryMarkdown, serializeDiaryMarkdown } from "./markdown.js";

function absoluteFor(relative: string): string {
  const absolute = path.resolve(config.vaultRoot, relative);
  const prefix = config.vaultRoot.endsWith(path.sep) ? config.vaultRoot : `${config.vaultRoot}${path.sep}`;
  if (absolute !== config.vaultRoot && !absolute.startsWith(prefix)) throw new Error("知识库路径越界");
  return absolute;
}

function versionOf(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

export async function atomicWrite(relative: string, content: string): Promise<void> {
  const absolute = absoluteFor(relative);
  await mkdir(path.dirname(absolute), { recursive: true });
  const temporary = `${absolute}.${randomUUID()}.tmp`;
  await writeFile(temporary, content, "utf8");
  await rename(temporary, absolute);
}

export async function loadDiary(date: string): Promise<DiaryResponse> {
  assertDate(date);
  const relative = `${vaultPaths.daily}/${date}.md`;
  try {
    const content = await readFile(absoluteFor(relative), "utf8");
    return { document: parseDiaryMarkdown(content, date), version: versionOf(content), exists: true };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { document: emptyDiary(date), version: "0", exists: false };
    throw error;
  }
}

// ponytail: one local writer queue; use per-vault queues if multi-user support is added.
let writes: Promise<unknown> = Promise.resolve();
export function withVaultLock<T>(work: () => Promise<T>): Promise<T> {
  const result = writes.then(work, work); writes = result.catch(() => {}); return result;
}
export function saveDiary(date: string, input: unknown, expectedVersion: string): Promise<DiaryResponse> {
  return withVaultLock(() => saveDiaryUnlocked(date, input, expectedVersion));
}
export async function saveDiaryUnlocked(date: string, input: unknown, expectedVersion: string): Promise<DiaryResponse> {
  assertDate(date);
  const document = diaryDocumentSchema.parse(input);
  if (document.date !== date) throw Object.assign(new Error("路径日期与日记日期不一致"), { statusCode: 400 });
  const current = await loadDiary(date);
  if (current.version !== expectedVersion) throw Object.assign(new Error("日记已在其他位置修改"), { statusCode: 409, code: "VERSION_CONFLICT", current });
  const content = serializeDiaryMarkdown(document);
  await atomicWrite(`${vaultPaths.daily}/${date}.md`, content);
  const saved = await loadDiary(date);
  return { ...saved, savedAt: new Date().toISOString() };
}

export async function listDiaryDates(from?: string, to?: string): Promise<string[]> {
  if (from) assertDate(from);
  if (to) assertDate(to);
  try {
    const entries = await readdir(absoluteFor(vaultPaths.daily), { withFileTypes: true });
    return entries.filter((entry) => entry.isFile() && /^\d{4}-\d{2}-\d{2}\.md$/.test(entry.name))
      .map((entry) => entry.name.slice(0, 10)).filter((date) => (!from || date >= from) && (!to || date <= to)).sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

export async function readJson<T>(relative: string, fallback: T): Promise<T> {
  try { return JSON.parse(await readFile(absoluteFor(relative), "utf8")) as T; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT" || error instanceof SyntaxError) return fallback; throw error; }
}

export async function writeJson(relative: string, value: unknown): Promise<void> {
  await atomicWrite(relative, `${JSON.stringify(value, null, 2)}\n`);
}
