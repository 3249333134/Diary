import { describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('undici', () => ({ request: mocks.request, ProxyAgent: class {} }));
vi.mock('./config.js', () => ({ config: { ai: { key: 'test-only', url: 'http://example.invalid', model: 'test', proxy: '' } } }));
import { splitSentenceWithAi } from './split.js';

describe('independent sentence extraction', () => {
  it('sends only the current sentence and fills tags locally after extraction', async () => {
    mocks.request.mockResolvedValue({ statusCode: 200, body: { json: async () => ({ choices: [{ message: { content: JSON.stringify({ people: [], places: [{ name: '公司', tags: ['地点'] }], activities: [{ name: '编写代码', tags: ['工作'] }], foods: [], category: 'facts', time: '' }) } }] }) } });
    const known = [
      { key: 'food|烧烤', type: 'food' as const, name: '烧烤', tags: ['夜宵'], mentions: [], eventRelations: [], dayRelations: [] },
      { key: 'place|公司', type: 'place' as const, name: '公司', tags: ['办公'], mentions: [], eventRelations: [], dayRelations: [] },
    ];
    const result = await splitSentenceWithAi('在公司编写代码', known);
    const body = JSON.parse(mocks.request.mock.calls[0][1].body);
    expect(JSON.parse(body.messages[1].content)).toEqual({ sentence: '在公司编写代码' });
    expect(body.messages[1].content).not.toContain('烧烤');
    expect(result.foods).toEqual([]);
    expect(result.places[0].tags).toEqual(['办公']);
  });
});
