import type { DiaryResponse, RecordRef, Todo } from '@diary/contracts';
import { vaultPaths } from './config.js';
import { autoJournalPath } from './autoCompletion.js';
import { loadDiary, readJson, saveDiaryUnlocked, writeJson } from './vault.js';

type RestoreJournal = { phase: 'prepared' | 'complete'; operationId: string; fact: RecordRef };
export const restoreJournalPath = (date: string, id: string) => `${vaultPaths.system}/actions/restore-${date}-${id}.json`;
export const readRestoreJournal = (date: string, id: string) => readJson<RestoreJournal | null>(restoreJournalPath(date,id),null);

/** Under the vault lock: delete only the linked completion fact, then clear its plan snapshot. */
export async function restoreCompletion(current: DiaryResponse, task: Todo, operationId: string, nextStatus: 'todo' | 'doing' = 'todo') {
  const path = restoreJournalPath(current.document.date,task.id);
  const pending = await readRestoreJournal(current.document.date,task.id);
  const fact = pending?.phase === 'prepared' ? pending.fact : task.completion;
  if (!fact || fact.kind !== 'facts') throw new Error('没有可撤销的完成事实');
  const journal: RestoreJournal = { phase:'prepared', operationId, fact };
  await writeJson(path,journal);
  try {
    const target = fact.date === current.document.date ? current : await loadDiary(fact.date);
    const event = target.document.facts.events.find(event=>event.id===fact.id);
    if (event && (event.task?.id !== task.id || event.task.date !== current.document.date)) throw new Error('完成事实关联不一致，未删除记录');
    if (event) {
      target.document.facts.events = target.document.facts.events.filter(event=>event.id!==fact.id);
      if (fact.date !== current.document.date) await saveDiaryUnlocked(fact.date,target.document,target.version);
    }
    Object.assign(task,{done:false,status:nextStatus,deletedAt:undefined,completedAt:undefined,completion:undefined,operationId:undefined});
    const diary = await saveDiaryUnlocked(current.document.date,current.document,current.version);
    // A later completion starts a new cycle rather than replaying the removed fact.
    await writeJson(autoJournalPath(current.document.date,task.id),null);
    await writeJson(path,{...journal,phase:'complete'});
    return { diary };
  } catch (error) {
    throw Object.assign(new Error(`恢复计划待重试：${error instanceof Error ? error.message : '保存失败'}。请刷新后再次恢复，系统不会删除其他事实。`),{statusCode:409});
  }
}
