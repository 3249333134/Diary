import { it, expect, vi } from 'vitest';
vi.mock('./config.js', () => ({ config: { timezone: 'Asia/Shanghai', ai: { key: '', url: '', model: '', proxy: '' } } }));
vi.mock('./config.js', () => ({ config: { timezone: 'Asia/Shanghai', ai: { key: '', url: '', model: '', proxy: '' } } }));
import { parseCapture } from './capture.js';
import { captureDraftSchema } from '@diary/contracts';

it('manual fallback preserves original text and requires confirmation, using real Shanghai date', async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-30T16:02:00Z'));
  try {
    const response = await parseCapture({ text: '明天下午开会，今天读了资料' });
    expect(response.today).toBe('2026-10-01');
    expect(response.timezone).toBe('Asia/Shanghai');
    expect(response.drafts[0]).toMatchObject({ content: '明天下午开会，今天读了资料', needsReview: true, time: '00:02' });
    expect(captureDraftSchema.safeParse(response.drafts[0]).success).toBe(true);
  } finally { vi.useRealTimers(); }
});
