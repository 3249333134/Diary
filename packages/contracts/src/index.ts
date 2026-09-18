import { z } from "zod";

export const entityTypes = ["person", "place", "activity", "food", "thing"] as const;
export const entityTypeSchema = z.enum(entityTypes);
export type EntityType = z.infer<typeof entityTypeSchema>;

export const taggedEntitySchema = z.object({
  type: entityTypeSchema,
  name: z.string().trim().min(1).max(80),
  tags: z.array(z.string().trim().min(1).max(40)).max(30).default([]),
});
export type TaggedEntity = z.infer<typeof taggedEntitySchema>;

export const recordRefSchema = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), kind: z.enum(['facts', 'learn', 'input', 'idea', 'todo']), id: z.string().regex(/^[a-zA-Z0-9-]+$/).max(80), summary: z.string().max(2000) });
export type RecordRef = z.infer<typeof recordRefSchema>;

export const attachmentSchema = z.object({ path: z.string().max(500), name: z.string().max(200).default('') });
export type Attachment = z.infer<typeof attachmentSchema>;

export const textEntrySchema = z.object({ id: z.string().regex(/^[a-zA-Z0-9-]+$/).max(80), content: z.string().max(50000), time: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$|^$/).default(''), sources: z.array(taggedEntitySchema).default([]), tags: z.array(z.string()).default([]), attachments: z.array(attachmentSchema).max(20).default([]) });
export type TextEntry = z.infer<typeof textEntrySchema>;
export const todoSubtaskSchema = z.object({
  id: z.string().max(80),
  title: z.string().trim().min(1).max(500),
  done: z.boolean().default(false),
});
export type TodoSubtask = z.infer<typeof todoSubtaskSchema>;

export const todoRepeatSchema = z.object({
  type: z.enum(['none', 'daily', 'weekly', 'monthly', 'yearly', 'custom', 'after']),
  interval: z.number().int().positive().optional(),
  weekdays: z.array(z.number().int().min(0).max(6)).optional(),
  afterDays: z.number().int().nonnegative().optional(),
}).nullable();
export type TodoRepeat = z.infer<typeof todoRepeatSchema>;

export const todoAttachmentSchema = z.object({
  name: z.string().max(200),
  type: z.string().max(100).default(''),
  size: z.number().int().nonnegative().default(0),
});
export type TodoAttachment = z.infer<typeof todoAttachmentSchema>;

export const todoSchema = z.object({
  id: z.string().regex(/^[a-zA-Z0-9-]+$/).max(80), title: z.string().trim().min(1).max(2000).regex(/^[^\r\n]+$/), done: z.boolean().default(false), time: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$|^$/).default(''),
  plannedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$|^$/).optional(), source: recordRefSchema.optional(), completion: recordRefSchema.optional(), completedAt: z.string().optional(), operationId: z.string().optional(),
  // 阶段 1 扩展字段
  description: z.string().max(10000).default(''),
  subtasks: z.array(todoSubtaskSchema).max(100).default([]),
  priority: z.string().max(40).default('medium'), // high / medium / low / 自定义
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$|^$/).default(''),
  dueTime: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$|^$/).default(''),
  list: z.string().max(80).default(''), // 清单 ID
  tags: z.array(z.string().trim().min(1).max(40)).max(50).default([]),
  status: z.enum(['todo', 'doing', 'done', 'cancelled']).default('todo'),
  repeat: todoRepeatSchema.default(null),
  attachments: z.array(todoAttachmentSchema).max(20).default([]),
  createdAt: z.string().default(''),
  deletedAt: z.string().optional(), // 回收站标记
});
export type Todo = z.infer<typeof todoSchema>;

export const eventLocationSchema = z.object({
  name: z.string().max(200).default(""),
  lat: z.number().optional(),
  lng: z.number().optional(),
}).optional();
export type EventLocation = z.infer<typeof eventLocationSchema>;

export const diaryEventSchema = z.object({
  task: recordRefSchema.optional(),
  id: z.string().min(1).max(80),
  time: z.union([z.literal(""), z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/)]).default(""),
  note: z.string().max(10_000).default(""),
  remark: z.string().max(10_000).default(""),
  location: eventLocationSchema,
  people: z.array(taggedEntitySchema).max(100).default([]),
  places: z.array(taggedEntitySchema).max(100).default([]),
  activities: z.array(taggedEntitySchema).max(100).default([]),
  foods: z.array(taggedEntitySchema).max(100).default([]),
  attachments: z.array(attachmentSchema).max(20).default([]),
});
export type DiaryEvent = z.infer<typeof diaryEventSchema>;

export const unknownSectionSchema = z.object({
  heading: z.string().min(1).max(200),
  content: z.string().max(100_000),
});

export const diaryDocumentSchema = z.object({
  recordVersion: z.literal(2).optional(),
  entries: z.object({ learn: z.array(textEntrySchema), input: z.array(textEntrySchema), idea: z.array(textEntrySchema) }).optional(),
  todos: z.array(todoSchema).max(200).default([]),
  todosExtra: z.string().max(50000).default(''),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  weather: z.string().max(40).default(""),
  sleep: z.string().max(40).default(""),
  mood: z.string().max(40).default(""),
  facts: z.object({ events: z.array(diaryEventSchema).max(100), note: z.string().max(20_000).default("") }),
  learn: z.object({ sources: z.array(taggedEntitySchema).max(100), content: z.string().max(50_000) }),
  input: z.object({ kind: z.string().max(40), names: z.array(taggedEntitySchema).max(100), excerpt: z.string().max(50_000) }),
  idea: z.object({ tags: z.array(z.string().trim().min(1).max(40)).max(100), content: z.string().max(50_000) }),
  unknownFrontmatter: z.record(z.unknown()).default({}),
  unknownSections: z.array(unknownSectionSchema).default([]),
});
export type DiaryDocument = z.infer<typeof diaryDocumentSchema>;

export const textKinds = ['learn', 'input', 'idea'] as const;
export type TextKind = typeof textKinds[number];
export function entryText(entry: TextEntry): string { return `${entry.time ? `[${entry.time}] ` : ''}${entry.content}`; }
export function projectEntries(document: DiaryDocument): DiaryDocument {
  if (!document.entries) return document;
  return { ...document, recordVersion: 2, learn: { ...document.learn, content: document.entries.learn.map(entryText).join('\n\n') }, input: { ...document.input, excerpt: document.entries.input.map(entryText).join('\n\n') }, idea: { ...document.idea, content: document.entries.idea.map(entryText).join('\n\n') } };
}
export function resolveRecord(document: DiaryDocument, ref: RecordRef): string | undefined {
  if (ref.kind === 'facts') return document.facts.events.find(e => e.id === ref.id)?.note;
  if (ref.kind === 'todo') return document.todos.find(t => t.id === ref.id)?.title;
  return document.entries?.[ref.kind].find(e => e.id === ref.id)?.content;
}

export type DiaryResponse = { document: DiaryDocument; version: string; exists: boolean; savedAt?: string };

export type EntityRelation = { key: string; type: EntityType; name: string; count: number; dates: string[] };
export type EntityRecord = {
  parentKey?: string;
  occurrences?: Array<{ key: string; date: string; time: string; note: string; index: number }>;
  key: string;
  type: EntityType;
  name: string;
  tags: string[];
  mentions: string[];
  eventRelations: EntityRelation[];
  dayRelations: EntityRelation[];
};

export type TagStore = Record<EntityType, string[]>;
export const placeParentSchema = z.object({ key: z.string().startsWith("place|"), parentKey: z.string().startsWith("place|").nullable() });

export const tagCreateSchema = z.object({ type: entityTypeSchema, name: z.string().trim().min(1).max(40) });

export const weeklySummaryRequestSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  useAi: z.boolean().optional(),
});

export const sentenceSplitRequestSchema = z.object({
  sentence: z.string().trim().min(1).max(2_000),
});

export const sentenceSplitResultSchema = z.object({
  people: z.array(taggedEntitySchema.extend({ type: z.literal("person") })).max(30),
  places: z.array(taggedEntitySchema.extend({ type: z.literal("place") })).max(30),
  activities: z.array(taggedEntitySchema.extend({ type: z.literal("activity") })).max(30),
  foods: z.array(taggedEntitySchema.extend({ type: z.literal("food") })).max(30),
});
export type SentenceSplitResult = z.infer<typeof sentenceSplitResultSchema>;

export const quickFactSchema = z.object({
  id: z.string().max(80).optional(),
  source: z.enum(["auto", "pinned"]),
  label: z.string().max(200),
  shortLabel: z.string().max(20).optional(),
  count: z.number().int().nonnegative(),
  note: z.string().max(2000).default(""),
  time: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$|^$/).default(""),
  activities: z.array(taggedEntitySchema.extend({ type: z.literal("activity") })).max(30),
  places: z.array(taggedEntitySchema.extend({ type: z.literal("place") })).max(30).default([]),
  people: z.array(taggedEntitySchema.extend({ type: z.literal("person") })).max(30).default([]),
  foods: z.array(taggedEntitySchema.extend({ type: z.literal("food") })).max(30).default([]),
  lastUsedAt: z.string().optional(),
});
export type QuickFact = z.infer<typeof quickFactSchema>;

export const pinQuickFactRequestSchema = z.object({
  label: z.string().trim().min(1).max(200),
  note: z.string().max(2000).default(""),
  time: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$|^$/).default(""),
  activities: z.array(taggedEntitySchema.extend({ type: z.literal("activity") })).max(30).min(1),
  places: z.array(taggedEntitySchema.extend({ type: z.literal("place") })).max(30).default([]),
  people: z.array(taggedEntitySchema.extend({ type: z.literal("person") })).max(30).default([]),
  foods: z.array(taggedEntitySchema.extend({ type: z.literal("food") })).max(30).default([]),
});
export type PinQuickFactRequest = z.infer<typeof pinQuickFactRequestSchema>;

export function emptyDiary(date: string): DiaryDocument {
  return {
    todos: [],
    todosExtra: '',
    date,
    weather: "",
    sleep: "",
    mood: "",
    facts: { events: [], note: "" },
    learn: { sources: [], content: "" },
    input: { kind: "书", names: [], excerpt: "" },
    idea: { tags: [], content: "" },
    unknownFrontmatter: {},
    unknownSections: [],
  };
}

export function normalizeEntityName(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("zh-CN");
}

export function entityKey(type: EntityType, name: string): string {
  return `${type}|${normalizeEntityName(name)}`;
}
