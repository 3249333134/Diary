import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright-core';
import { emptyDiary, entityKey } from '../packages/contracts/dist/index.js';

const entities = new Map();
const add = (index, refs) => {
  for (const [type, name] of refs) {
    const key = entityKey(type, name);
    const entity = entities.get(key) || { key, type, name, tags: [], mentions: ['2026-09-14'], occurrences: [], eventRelations: [], dayRelations: [] };
    entity.occurrences.push({ key: `event|2026-09-14|${index}`, date: '2026-09-14', time: '12:00', note: `测试事件 ${index}`, index });
    entities.set(key, entity);
  }
};
for (let i = 0; i < 8; i++) add(i, [['place', '公司'], ['person', '张三'], ['activity', '讨论方案']]);
for (let i = 8; i < 11; i++) add(i, [['place', '家'], ['person', '张三'], ['activity', '做饭'], ['food', '米饭']]);
add(11, [['place', '河边公园'], ['person', '小李'], ['activity', '散步']]);
add(12, [['person', '老朋友'], ['activity', '电话聊天']]);

await mkdir('qa', { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.EDGE_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
try {
  for (const width of [1440, 768, 375]) for (const theme of ['light', 'dark']) {
    const page = await browser.newPage({ viewport: { width, height: 1000 }, colorScheme: theme });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(theme => localStorage.setItem('diary.theme', theme), theme);
    // Entire API is mocked: visual and interaction checks never touch the user's vault.
    await page.route('**/api/**', route => {
      const url = new URL(route.request().url());
      if (route.request().method() !== 'GET') return route.abort();
      let data = {};
      if (url.pathname === '/api/entities') data = { entities: [...entities.values()] };
      else if (url.pathname === '/api/quick-facts') data = { facts: [] };
      else if (url.pathname === '/api/tags') data = { tags: { person: [], place: [], activity: [], food: [], thing: [] } };
      else if (url.pathname === '/api/actions') data = { tasks: [], records: [] };
      else if (url.pathname === '/api/weeks') data = { start: '2026-09-14', end: '2026-09-20', entries: [] };
      else if (url.pathname.startsWith('/api/diaries/')) data = { document: emptyDiary(url.pathname.split('/').pop()), version: '0', exists: false };
      else if (url.pathname === '/api/diaries') data = { dates: [] };
      return route.fulfill({ json: data });
    });
    await page.goto(process.env.QA_URL || 'http://127.0.0.1:4173', { waitUntil: 'domcontentloaded' });
    await page.getByRole('tab', { name: '关联', exact: true }).click();
    const canvas = page.locator('.graph-canvas');
    await canvas.scrollIntoViewIfNeeded();
    await page.locator('.graph-region').first().waitFor();
    await page.waitForSelector('.graph-canvas[data-ink-ready="true"]');
    assert.equal(await page.locator('.node-event.graph-node').count(), 0);
    assert.equal(await page.locator('.node-place.graph-node circle').count(), 0);
    assert.equal(await page.locator('.graph-region').count(), 4);
    const once = page.locator('.graph-node[aria-label^="小李，"]');
    assert.equal(await once.locator('text').count(), 0);
    await once.focus();
    assert.equal(await once.locator('text').count(), 1);
    await page.keyboard.press('Enter');
    assert.equal(await once.getAttribute('aria-pressed'), 'true');
    const dimmedOpacity = await page.locator('.graph-edge.dimmed').first().evaluate(el => getComputedStyle(el).opacity);
    await page.waitForTimeout(220);
    assert.ok(Number(await page.locator('.graph-edge.dimmed').first().evaluate(el => getComputedStyle(el).opacity)) < .1, dimmedOpacity);
    await page.getByRole('button', { name: '关闭节点详情' }).click();
    await canvas.focus();
    const transform = () => canvas.locator(':scope > g').getAttribute('transform');
    const before = await transform();
    await page.keyboard.press('+');
    assert.notEqual(await transform(), before);
    await page.getByRole('button', { name: '适应画布' }).click();
    await page.getByRole('button', { name: '筛选图谱' }).click();
    const areas = await page.locator('.graph-ink').evaluateAll(elements => elements.map(el => el.getAttribute('transform')));
    await page.getByRole('button', { name: '人物', exact: true }).click();
    assert.deepEqual(await page.locator('.graph-ink').evaluateAll(elements => elements.map(el => el.getAttribute('transform'))), areas);
    await page.getByRole('button', { name: '人物', exact: true }).click();
    await page.getByRole('button', { name: '显示事件节点', exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll('.node-event.graph-node').length === 13);
    assert.equal(await page.locator('.node-event.graph-node').count(), 13);
    await page.getByRole('button', { name: '显示事件节点', exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll('.node-event.graph-node').length === 0);
    await page.getByRole('button', { name: '筛选图谱' }).click();
    if (width === 1440 && theme === 'light') {
      const search = page.getByRole('textbox', { name: '搜索图谱节点' });
      await search.fill('小李');
      assert.equal(await once.locator('text').count(), 1);
      await page.getByRole('button', { name: '小李人物', exact: true }).click();
      assert.equal(await once.getAttribute('aria-pressed'), 'true');
      await page.getByRole('button', { name: '关闭节点详情' }).click();
      await page.getByRole('button', { name: '适应画布' }).click();
      const place = page.locator('.graph-node[aria-label^="公司，"]');
      const placeBefore = await place.getAttribute('transform');
      const inkBefore = await page.locator('.graph-ink').first().getAttribute('d');
      const box = await place.locator('rect').boundingBox();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width / 2 + 25, box.y + box.height / 2 + 20, { steps: 5 });
      await page.mouse.up();
      assert.notEqual(await place.getAttribute('transform'), placeBefore);
      await page.waitForFunction(before => document.querySelector('.graph-ink')?.getAttribute('d') !== before, inkBefore);
      assert.equal(await page.getByRole('tab', { name: '关联', exact: true }).getAttribute('aria-selected'), 'true');
      await page.getByRole('button', { name: '适应画布' }).click();
      await canvas.focus();
      const panBefore = await transform();
      await page.keyboard.press('ArrowRight');
      assert.notEqual(await transform(), panBefore);
      const canvasBox = await canvas.boundingBox();
      await page.mouse.move(canvasBox.x + canvasBox.width / 2, canvasBox.y + canvasBox.height * .85);
      const wheelBefore = await transform();
      await page.mouse.wheel(0, -100);
      await page.waitForTimeout(200);
      assert.notEqual(await transform(), wheelBefore);
    }
    await page.getByRole('button', { name: '适应画布' }).click();
    await page.mouse.move(0, 0);
    await page.waitForTimeout(240);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    assert.deepEqual(errors, []);
    await page.locator('.graph-section').screenshot({ path: `qa/ink-${width}-${theme}.png` });
    console.log(`PASS ${width}px ${theme}: labels, keyboard, opacity, filters, event toggle, overflow`);
    await page.close();
  }
} finally { await browser.close(); }
