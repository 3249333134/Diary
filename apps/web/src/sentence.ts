import type { EntityRecord, SentenceSplitResult, TaggedEntity } from "@diary/contracts";

export type SplitDraft = SentenceSplitResult;

const stop = new Set(["我", "自己", "一个人", "独自一人", "今天", "昨天", "刚才", "然后", "后来"]);
const placeSuffixes = ["咖啡店", "办公室", "公司", "餐厅", "商场", "学校", "公园", "车站", "家"];
const foodSuffixes = ["咖啡", "火锅", "烧烤", "米饭", "面", "饭", "菜", "茶", "酒"];

function unique(values: string[]): string[] { return [...new Set(values.map((value) => value.trim()).filter((value) => value && !stop.has(value)))]; }

export function splitSentence(sentence: string, entities: EntityRecord[]): SplitDraft {
  let remaining = sentence.trim();
  const names = { people: [] as string[], places: [] as string[], activities: [] as string[], foods: [] as string[] };
  const known = [...entities].sort((a, b) => b.name.length - a.name.length);
  for (const entity of known) {
    if (!remaining.includes(entity.name)) continue;
    if (entity.type === "person") names.people.push(entity.name);
    else if (entity.type === "place") names.places.push(entity.name);
    else if (entity.type === "food") names.foods.push(entity.name);
    else names.activities.push(entity.name);
    remaining = remaining.split(entity.name).join(" ");
  }
  const capture = (prefixes: string[], target: string[]) => {
    const pattern = new RegExp(`(?:${prefixes.join("|")})([^，。！？、,.!?；;：:\\s]{1,12})`, "g");
    for (const match of remaining.matchAll(pattern)) target.push(match[1].replace(/^了/, ""));
  };
  capture(["和", "与", "跟", "见", "陪"], names.people);
  capture(["在", "去", "到", "回"], names.places);
  capture(["吃", "喝"], names.foods);
  capture(["做", "写", "聊", "开", "看", "听", "学", "跑", "读"], names.activities);
  const words = remaining.split(/[，。！？、,.!?；;：:\s]+/).filter(Boolean);
  for (const word of words) {
    if (placeSuffixes.some((suffix) => word.endsWith(suffix))) names.places.push(word.replace(/^(?:在|去|到|回)/, ""));
    else if (foodSuffixes.some((suffix) => word.endsWith(suffix))) names.foods.push(word.replace(/^(?:吃|喝)/, ""));
  }
  names.people = unique(names.people);
  names.places = unique(names.places);
  names.activities = unique(names.activities);
  names.foods = unique(names.foods);
  if (![...names.people, ...names.places, ...names.activities, ...names.foods].length && sentence.trim()) names.activities = [sentence.trim()];
  return {
    people: tagged("person", names.people, entities),
    places: tagged("place", names.places, entities),
    activities: tagged("activity", names.activities, entities),
    foods: tagged("food", names.foods, entities),
  };
}

export function tagged<T extends TaggedEntity["type"]>(type: T, names: string[], entities: EntityRecord[]): Array<TaggedEntity & { type: T }> {
  return names.map((name) => ({ type, name, tags: entities.find((item) => item.type === type && item.name === name)?.tags || [] }));
}
