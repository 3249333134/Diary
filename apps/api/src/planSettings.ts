import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { defaultPlanCategories, planCategorySchema, entityTypes, type PlanCategory, type TagStore } from '@diary/contracts';
import { listDiaryDates, loadDiary, readJson, writeJson, withVaultLock } from './vault.js';
import { vaultPaths } from './config.js';

export const sharedTagSchema = z.string().trim().min(1).max(40);
export const planViewSchema = z.object({ id: z.string().uuid(), name: z.string().trim().min(1).max(40), color: z.string().regex(/^#[0-9a-f]{6}$/i), tags: z.array(sharedTagSchema).min(1).max(30) });
export const planViewsSchema = z.array(planViewSchema).max(40);
export async function tagLibrary(typed: TagStore) {
  const saved = await readJson<string[]>(`${vaultPaths.system}/shared-tags.json`, []);
  const documents = await Promise.all((await listDiaryDates()).map(async date => (await loadDiary(date)).document));
  const tags = documents.flatMap(document => [
    ...document.todos.flatMap(task => task.tags), ...document.facts.events.flatMap(event => event.tags || []),
    ...Object.values(document.entries || {}).flatMap(entries => entries.flatMap(entry => [...entry.tags, ...entry.sources.flatMap(source => source.tags)])),
    ...document.facts.events.flatMap(event => [...event.people, ...event.places, ...event.activities, ...event.foods].flatMap(entity => entity.tags)),
  ]);
  return [...new Set([...saved, ...tags, ...entityTypes.flatMap(type => typed[type])])].sort((a, b) => a.localeCompare(b, 'zh-CN'));
}
export async function addSharedTag(tag: string) {
  await withVaultLock(async () => {
    const path = `${vaultPaths.system}/shared-tags.json`;
    const tags = await readJson<string[]>(path, []);
    await writeJson(path, [...new Set([...tags, sharedTagSchema.parse(tag)])]);
  });
}
export const getPlanViews = () => readJson<z.infer<typeof planViewsSchema>>(`${vaultPaths.system}/plan-views.json`, []);
export const savePlanViews = (views: unknown) => withVaultLock(() => writeJson(`${vaultPaths.system}/plan-views.json`, planViewsSchema.parse(views)));

export async function getPlanCategories(): Promise<PlanCategory[]> {
  const saved = z.array(planCategorySchema).parse(await readJson<unknown>(`${vaultPaths.system}/plan-categories.json`, []));
  return [...defaultPlanCategories, ...saved.filter(c=>!defaultPlanCategories.some(d=>d.id===c.id))];
}
export async function addPlanCategory(input: unknown) {
  const data = planCategorySchema.pick({name:true,color:true}).parse(input);
  return withVaultLock(async()=>{
    const categories = await getPlanCategories();
    const normalize = (name:string)=>name.normalize('NFKC').trim().toLocaleLowerCase();
    if(categories.some(c=>normalize(c.name)===normalize(data.name))) throw Object.assign(new Error('已有同名类别，请使用其他名称'),{statusCode:409});
    if(categories.length>=30) throw Object.assign(new Error('最多可设置 30 个计划类别'),{statusCode:400});
    const category = planCategorySchema.parse({id:'cat-'+randomUUID(),...data});
    await writeJson(`${vaultPaths.system}/plan-categories.json`, [...categories.filter(c=>!defaultPlanCategories.some(d=>d.id===c.id)),category]);
    return {category,categories:[...categories,category]};
  });
}
