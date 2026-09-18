import chokidar, { type FSWatcher } from "chokidar";
import path from "node:path";
import { entityKey, entityTypes, type DiaryDocument, type EntityRecord, type EntityRelation, type EntityType, type TagStore, type TaggedEntity } from "@diary/contracts";
import { config, vaultPaths } from "./config.js";
import { listDiaryDates, loadDiary, readJson, writeJson, withVaultLock } from "./vault.js";

const SEED_TAGS: TagStore = {
  person: ["同事", "朋友", "客户", "家人", "合作伙伴"],
  place: ["公司", "家", "餐厅", "户外", "交通"],
  activity: ["工作", "生活", "运动", "学习", "创作", "休息"],
  food: ["中餐", "西餐", "外卖", "健康", "饮品"],
  thing: ["工具", "产品", "素材", "资源"],
};

type MutableEntity = {
  key: string; type: EntityType; name: string; tags: Set<string>; mentions: Set<string>;
  event: Map<string, Set<string>>; day: Map<string, Set<string>>;
};

function refsForDay(document: DiaryDocument): TaggedEntity[] {
  return [
    ...document.facts.events.flatMap((event) => [...event.people, ...event.places, ...event.activities, ...event.foods]),
    ...document.learn.sources,
    ...document.input.names,
    ...document.idea.tags.map((name) => ({ type: "thing" as const, name, tags: [] })),
  ];
}

function relation(key: string, mutable: Map<string, MutableEntity>, events: Set<string>): EntityRelation | null {
  const target = mutable.get(key);
  if (!target) return null;
  return { key, type: target.type, name: target.name, count: events.size, dates: [...new Set([...events].map(event => event.split("|")[1]))].sort() };
}

export class EntityIndex {
  private records = new Map<string, EntityRecord>();
  private tags: TagStore = structuredClone(SEED_TAGS);
  private watcher: FSWatcher | null = null;
  private rebuildTimer: NodeJS.Timeout | null = null;

  async rebuild(): Promise<void> {
    const parents = await readJson<Record<string, string>>(`${vaultPaths.system}/place-parents.json`, {});
    const occurrences = new Map<string, NonNullable<EntityRecord["occurrences"]>>();
    const mutable = new Map<string, MutableEntity>();
    const dates = await listDiaryDates();
    const documents = await Promise.all(dates.map(async (date) => (await loadDiary(date)).document));
    const ensure = (ref: TaggedEntity): MutableEntity => {
      const key = entityKey(ref.type, ref.name);
      let item = mutable.get(key);
      if (!item) {
        item = { key, type: ref.type, name: ref.name, tags: new Set(), mentions: new Set(), event: new Map(), day: new Map() };
        mutable.set(key, item);
      }
      ref.tags.forEach((tag) => item!.tags.add(tag));
      return item;
    };
    const link = (map: Map<string, Set<string>>, other: string, date: string) => {
      const values = map.get(other) || new Set<string>();
      values.add(date);
      map.set(other, values);
    };

    for (const document of documents) {
      const allRefs = refsForDay(document);
      const uniqueDay = new Map(allRefs.map((ref) => [entityKey(ref.type, ref.name), ref]));
      for (const ref of uniqueDay.values()) ensure(ref).mentions.add(document.date);
      for (const [eventIndex, event] of document.facts.events.entries()) {
        const refs = [...event.people, ...event.places, ...event.activities, ...event.foods];
        const unique = new Map(refs.map((ref) => [entityKey(ref.type, ref.name), ref]));
        for (const key of unique.keys()) {
          const list = occurrences.get(key) || [];
          list.push({ key: `event|${document.date}|${event.id}`, date: document.date, time: event.time || "", note: event.note || `事件 ${eventIndex + 1}`, index: eventIndex });
          occurrences.set(key, list);
        }
        for (const ref of unique.values()) ensure(ref).mentions.add(document.date);
        const keys = [...unique.keys()];
        for (let i = 0; i < keys.length; i++) for (let j = i + 1; j < keys.length; j++) {
          link(mutable.get(keys[i])!.event, keys[j], `event|${document.date}|${event.id}`);
          link(mutable.get(keys[j])!.event, keys[i], `event|${document.date}|${event.id}`);
        }
      }
      // Sharing a date is archival context, not evidence of an entity relationship.
    }

    const savedTags = await readJson<Partial<TagStore>>(`${vaultPaths.system}/tags.json`, {});
    this.tags = structuredClone(SEED_TAGS);
    for (const type of entityTypes) {
      const inferred = [...mutable.values()].filter((item) => item.type === type).flatMap((item) => [...item.tags]);
      this.tags[type] = [...new Set([...(savedTags[type] || []), ...this.tags[type], ...inferred])].sort((a, b) => a.localeCompare(b, "zh-CN"));
    }
    this.records = new Map([...mutable.values()].map((item) => [item.key, {
      key: item.key, type: item.type, name: item.name,
      ...(item.type === "place" && parents[item.key] ? { parentKey: parents[item.key] } : {}),
      occurrences: occurrences.get(item.key) || [],
      tags: [...item.tags].sort((a, b) => a.localeCompare(b, "zh-CN")),
      mentions: [...item.mentions].sort(),
      eventRelations: [...item.event.entries()].map(([key, values]) => relation(key, mutable, values)).filter((value): value is EntityRelation => Boolean(value)).sort((a, b) => b.count - a.count),
      dayRelations: [...item.day.entries()].map(([key, values]) => relation(key, mutable, values)).filter((value): value is EntityRelation => Boolean(value)).sort((a, b) => b.count - a.count),
    }]));
  }

  list(query = "", type?: EntityType, limit = 100): EntityRecord[] {
    const needle = query.normalize("NFKC").trim().toLocaleLowerCase("zh-CN");
    return [...this.records.values()].filter((item) => (!type || item.type === type) && (!needle || item.name.toLocaleLowerCase("zh-CN").includes(needle)))
      .sort((a, b) => b.mentions.length - a.mentions.length || a.name.localeCompare(b.name, "zh-CN")).slice(0, Math.min(Math.max(limit, 1), 500));
  }

  get(type: EntityType, name: string): EntityRecord | undefined { return this.records.get(entityKey(type, name)); }
  getTags(): TagStore { return structuredClone(this.tags); }

  async setPlaceParent(key: string, parentKey: string | null): Promise<void> {
    await withVaultLock(async () => {
      if (this.records.get(key)?.type !== "place" || (parentKey && this.records.get(parentKey)?.type !== "place")) {
        throw Object.assign(new Error("请选择已记录的地点"), { statusCode: 400 });
      }
      const parents = await readJson<Record<string, string>>(`${vaultPaths.system}/place-parents.json`, {});
      const visited = new Set([key]);
      let ancestor = parentKey;
      while (ancestor) {
        if (visited.has(ancestor)) throw Object.assign(new Error("地点不能属于自身或自己的下级地点"), { statusCode: 400 });
        visited.add(ancestor); ancestor = parents[ancestor] || null;
      }
      if (parentKey) parents[key] = parentKey;
      else delete parents[key];
      await writeJson(`${vaultPaths.system}/place-parents.json`, parents);
      await this.rebuild();
    });
  }

  async addTag(type: EntityType, name: string): Promise<TagStore> {
    const clean = name.trim();
    if (!this.tags[type].includes(clean)) this.tags[type] = [...this.tags[type], clean].sort((a, b) => a.localeCompare(b, "zh-CN"));
    await writeJson(`${vaultPaths.system}/tags.json`, this.tags);
    return this.getTags();
  }

  startWatching(): void {
    if (this.watcher) return;
    const directory = path.resolve(config.vaultRoot, vaultPaths.daily);
    this.watcher = chokidar.watch(path.join(directory, "*.md"), { ignoreInitial: true });
    this.watcher.on("all", () => {
      if (this.rebuildTimer) clearTimeout(this.rebuildTimer);
      this.rebuildTimer = setTimeout(() => void this.rebuild(), 300);
    });
  }

  async close(): Promise<void> { if (this.watcher) await this.watcher.close(); }
}
