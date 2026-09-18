import { describe, expect, it } from 'vitest';
import { emptyDiary } from '@diary/contracts';
import { addedReceipts, receiptsFor } from './receipts';

describe('diary receipts', () => {
  it('skips empty entries and keeps event time and remarks', () => {
    const d = emptyDiary('2026-09-08');
    d.facts.events.push({ id: 'a', time: '09:30', note: '', remark: '', people: [], places: [], activities: [], foods: [] });
    expect(receiptsFor(d)).toEqual([]);
    d.facts.events[0].note = '散步'; d.facts.events[0].remark = '天气很好';
    expect(receiptsFor(d)[0]).toMatchObject({ time: '09:30', content: '散步', details: ['备注：天气很好'] });
  });
  it('groups all categories by date, preserves paragraphs, sorts timed entries', () => {
    const d = emptyDiary('2026-09-08');
    d.learn.content = '[12:00] 新知一\n\n[10:00] 新知二';
    d.input.excerpt = '阅读'; d.idea.content = '想法'; d.facts.note = '今天很开心';
    const receipts = receiptsFor(d);
    expect(receipts).toHaveLength(5);
    expect(receipts[0].content).toBe('新知二');
    expect(receipts.every(r => r.date === d.date)).toBe(true);
  });
  it('does not reprint edits or deletions, prints new saved entries', () => {
    const before = emptyDiary('2026-09-08'); before.idea.content = '原想法';
    const after = structuredClone(before); after.idea.content = '修改想法';
    expect(addedReceipts(before, after)).toEqual([]);
    after.idea.content += '\n\n新想法';
    expect(addedReceipts(before, after).map(r => r.content)).toEqual(['新想法']);
    expect(addedReceipts(after, before)).toEqual([]);
  });
});
