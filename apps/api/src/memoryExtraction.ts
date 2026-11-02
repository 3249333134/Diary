import {createHash,randomUUID} from 'node:crypto';
import {personalMemorySchema,timeAnchors,explicitAnchorTime,chineseClock,type PersonalMemory,type MemoryCandidate,type MemorySource} from '@diary/contracts';
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function candidateFor(record: Partial<PersonalMemory>, evidence: string, source: MemorySource): MemoryCandidate {
  const parsed = personalMemorySchema.parse({ id: randomUUID(), ...record, source, updatedAt: new Date().toISOString() });
  const fingerprint = hash([parsed.kind, parsed.key, parsed.value, [...parsed.weekdays].sort(), parsed.date, [...parsed.aliases].sort(), [...parsed.tags].sort()]);
  return { id: fingerprint, fingerprint, record: parsed, evidence: evidence.slice(0, 1000) };
}
export function extractExplicitMemories(text: string, source: MemorySource): MemoryCandidate[] {
  const result: MemoryCandidate[] = [];
  for (const clause of text.split(/[，,。；;\n]/)) {
    const temporary = /今天|今日|今晚|这天|加班/.test(clause);
    for (const anchor of timeAnchors) {
      const value = explicitAnchorTime(clause, anchor.word)||(anchor.key==='offWork'&&/今天.{0,12}加班到/.test(clause)?chineseClock(clause.match(/加班到([^，,。；;]+)/)?.[1]||''):undefined);
      if (!value || !/^(?:\s*)(?:我|本人|我的|平时|通常|每天|工作日|周末|每周|周[一二三四五六日天]|今天|今日|[上下]班时间|起床时间|睡觉时间|午休时间|(?:下午|上午|晚上|早上)?[零一二三四五六七八九十两\d])/.test(clause)) continue;
      if (temporary && !source.date) continue;
      const weekdays = /工作日|周一到周五|周一至周五/.test(clause) ? [1, 2, 3, 4, 5] : /周末/.test(clause) ? [0, 6] : [...clause.matchAll(/(?:周|星期)([一二三四五六日天])/g)].map(m => ({ 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 0, 天: 0 }[m[1]]!));
      result.push(candidateFor({ kind: 'time', key: anchor.key, label: anchor.label, value, weekdays, date: temporary ? source.date : undefined }, clause, source));
    }
    const person = /([^，,。；;\s]{1,12})(?:是我的|是我)(朋友|同事|同学|家人|伴侣|领导|客户)/.exec(clause);
    if (person) result.push(candidateFor({ kind: 'person', key: person[1], label: person[1], value: person[2], tags: [person[2]] }, clause, source));
    const place = /我(?:经常|通常|常去)(?:去|在)?([^，,。；;]{2,30})/.exec(clause);
    if (place) result.push(candidateFor({ kind: 'place', key: place[1], label: place[1], value: place[1] }, clause, source));
  }
  return [...new Map(result.map(c => [c.fingerprint, c])).values()];
}

export const onceMemoryKey=(candidate:MemoryCandidate)=>'once:'+hash([candidate.fingerprint,candidate.record.source.date,candidate.evidence]);
export const ignoredMemoryCandidate=(ignored:string[],candidate:MemoryCandidate)=>ignored.includes(candidate.fingerprint)||ignored.includes(onceMemoryKey(candidate));
