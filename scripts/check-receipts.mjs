import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright-core';
await mkdir('qa', { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.EDGE_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
try {
  for (const width of [375, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: 1000 } });
    let saved = { date: '2026-09-08', weather: '', sleep: '', mood: '', facts: { events: [{ id: 'receipt-test', time: '18:30', note: '和朋友在街角吃了一顿烧烤，聊起今年想去的地方。', remark: '风很舒服，慢慢走回家。', people: [], places: [], activities: [], foods: [] }], note: '' }, learn: { sources: [], content: '[09:20] 今天学到：给自己留一点不被安排的时间。' }, input: { kind: '书', names: [], excerpt: '' }, idea: { tags: [], content: '' }, unknownFrontmatter: {}, unknownSections: [] };
    await page.route('**/api/**', async route => {
      const url = new URL(route.request().url());
      if (/\/api\/diaries\/\d{4}-\d{2}-\d{2}$/.test(url.pathname)) {
        if (route.request().method() === 'PUT') saved = route.request().postDataJSON();
        saved.date = url.pathname.split('/').at(-1);
        return route.fulfill({ json: { document: saved, version: 'test-version', exists: true } });
      }
      if (url.pathname === '/api/entities') return route.fulfill({ json: { entities: [] } });
      if (url.pathname === '/api/tags') return route.fulfill({ json: { tags: { person: [], place: [], activity: [], food: [], thing: [] } } });
      if (url.pathname === '/api/weeks') return route.fulfill({ json: { start: saved.date, end: saved.date, entries: [] } });
      return route.abort();
    });
    await page.goto('http://127.0.0.1:5173', { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: '每日小票 · 查看收藏' }).click();
    assert.equal(await page.locator('.receipt-paper').count(), 2);
    assert.equal(await page.locator('.receipt-notice').count(), 0, 'initial load should not print');
    await page.screenshot({ path: `qa/receipts-${width}.png` });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'no horizontal overflow');
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: '导出整日长图' }).click();
    const file = await download; await file.saveAs(`qa/receipt-export-${width}.png`);
    assert.ok(file.suggestedFilename().endsWith('.png'));
    await page.getByRole('button', { name: '返回记录', exact: true }).click();
    await page.getByRole('button', { name: '添加事件', exact: true }).click();
    await page.getByPlaceholder('用一句话描述整件事').fill('浏览器测试：记录今天的一件小事');
    await page.getByRole('button', { name: '立即保存' }).click();
    await page.locator('.receipt-notice').waitFor();
    assert.equal(saved.facts.events.length, 2, 'mock received saved new entry');
    await page.locator('.receipt-notice-paper').click();
    assert.equal(await page.locator('.receipt-paper').count(), 3);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.getByRole('button', { name: '重播出纸' }).click();
    assert.equal(await page.locator('.receipt-feed').evaluate(el => getComputedStyle(el).animationName), 'none');
    await page.close();
  }
  console.log('PASS: daily collection, local PNG export, new saved entry prints, no initial reprint, reduced motion, mobile/desktop overflow. All diary traffic mocked.');
} finally { await browser.close(); }
