import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { emptyDiary, entityKey } from '../packages/contracts/dist/index.js';

const small = new Map();
function add(index, refs) {
  for (const [type, name] of refs) {
    const key = entityKey(type, name);
    const entity = small.get(key) || { key, type, name, tags: [], mentions: ['2026-09-15'], occurrences: [], eventRelations: [], dayRelations: [] };
    entity.occurrences.push({ key: `event|2026-09-15|${index}`, date: '2026-09-15', time: '12:00', note: `测试事件${index}`, index }); small.set(key, entity);
  }
}
add(0, [['place', '十所']]);
for (let i = 1; i < 4; i++) add(i, [['place', '十所南院'], ['person', '南院成员'], ['activity', '南院活动'], ['person', '跨地点人物']]);
add(4, [['place', '十所门口'], ['person', '门口成员']]);
add(5, [['place', '家'], ['person', '家中成员'], ['person', '跨地点人物']]);
for (const name of ['十所南院', '十所门口']) small.get(entityKey('place', name)).parentKey = entityKey('place', '十所');
const large = [];
for (let p = 0; p < 10; p++) {
  const place = { key: `place|地点${p}`, type: 'place', name: `地点${p}`, mentions: ['2026-09-15'], tags: [], occurrences: [], eventRelations: [], dayRelations: [] };
  for (let i = 0; i < 49; i++) {
    const occurrence = { key: `event|2026-09-15|${p}-${i}`, date: '2026-09-15', time: '12:00', note: '性能测试', index: i };
    place.occurrences.push(occurrence);
    large.push({ key: `person|成员${p}-${i}`, type: 'person', name: `成员${p}-${i}`, mentions: ['2026-09-15'], tags: [], occurrences: [occurrence], eventRelations: [], dayRelations: [] });
  }
  large.push(place);
}
await mkdir('qa', { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.EDGE_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
try {
  for (const width of [1440, 768, 375]) for (const theme of ['light', 'dark']) {
    const page = await browser.newPage({ viewport: { width, height: 1000 }, recordVideo: process.env.QA_RECORD === '0' ? undefined : { dir: 'qa/paint-videos', size: { width, height: 1000 } } });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(theme => localStorage.setItem('diary.theme', theme), theme);
    let data = [...small.values()];
    await page.route('**/api/**', route => {
      if (route.request().method() !== 'GET') return route.abort();
      const url = new URL(route.request().url()); let json = {};
      if (url.pathname === '/api/entities') json = { entities: data };
      else if (url.pathname === '/api/quick-facts') json = { facts: [] };
      else if (url.pathname.startsWith('/api/diaries/')) json = { document: emptyDiary(url.pathname.split('/').pop()), version: '0', exists: false };
      else if (url.pathname === '/api/diaries') json = { dates: [] };
      else if (url.pathname === '/api/actions') json = { tasks: [], records: [] };
      else if (url.pathname === '/api/tags') json = { tags: { person: [], place: [], activity: [], food: [], thing: [] } };
      else if (url.pathname === '/api/weeks') json = { start: '2026-09-15', end: '2026-09-21', entries: [] };
      return route.fulfill({ json });
    });
    const ready = async () => {
      await page.goto(process.env.QA_URL || 'http://127.0.0.1:4173', { waitUntil: 'domcontentloaded' });
      await page.getByRole('tab', { name: '关联', exact: true }).click();
      await page.waitForFunction(() => document.querySelector('.graph-canvas')?.dataset.inkReady === 'true');
      await page.getByRole('button', { name: '适应画布' }).click();
      await page.locator('.graph-canvas').scrollIntoViewIfNeeded();
    };
    const settled = () => page.waitForFunction(() => document.querySelector('.graph-canvas')?.dataset.inkActive === 'false');
    const drag = async (node, dx, dy) => {
      await node.focus();
      const b = await node.locator('circle').last().boundingBox();
      await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await page.mouse.down();
      for (let i = 1; i <= 30; i++) { await page.mouse.move(b.x + b.width / 2 + dx * i / 30, b.y + b.height / 2 + dy * i / 30); await page.waitForTimeout(16); }
      await page.mouse.up(); await settled();
    };
    await ready();
    const node = page.locator('.graph-node[data-node-id="person|南院成员"]');
    const before = await page.locator('.graph-ink[data-ink-region="place|十所南院"]').getAttribute('d');
    await drag(node, width === 375 ? 65 : 220, 115);
    const after = await page.locator('.graph-ink[data-ink-region="place|十所南院"]').getAttribute('d');
    assert.notEqual(before, after);
    const covered = await page.evaluate(() => {
      const node = document.querySelector('.graph-node[data-node-id="person|南院成员"]');
      const matrix = node.transform.baseVal.consolidate().matrix;
      const point = new DOMPoint(matrix.e, matrix.f);
      return ['十所南院', '十所'].map(name => document.querySelector(`.graph-ink[data-ink-region="place|${name}"]`).isPointInFill(point));
    });
    assert.deepEqual(covered, [true, true], 'child and parent both contain the moved member');
    await page.getByRole('button', { name: '适应画布' }).click();
    assert.equal(await page.locator('.graph-ink[data-ink-region="place|十所南院"]').getAttribute('d'), after);
    await page.mouse.move(0, 0); await page.waitForTimeout(220);
    await page.locator('.graph-section').screenshot({ path: `qa/member-ink-${width}-${theme}.png` });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await drag(node, -35, -25);
    assert.equal(await page.locator('.graph-canvas').getAttribute('data-ink-active'), 'false');
    assert.equal(await page.getByRole('tab', { name: '关联', exact: true }).getAttribute('aria-selected'), 'true');
    assert.deepEqual(errors, []);
    console.log(`PASS ${width}px ${theme}: correct ownership, parent expansion, retained shape, reduced motion`);
    if (theme === 'light') {
      data = large; await page.emulateMedia({ reducedMotion: 'no-preference' }); await ready();
      let target = page.locator('.graph-node.node-person').last();
      const candidates = page.locator('.graph-node.node-person');
      for (let i = await candidates.count() - 1; i >= 0; i--) {
        if (await candidates.nth(i).evaluate(el => { const b = el.querySelector('circle:last-of-type').getBoundingClientRect(); return document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2)?.closest('.graph-node') === el; })) { target = candidates.nth(i); break; }
      }
      await page.evaluate(() => {
        window.inkTiming = { frames: [], work: [], stop: false }; let last = performance.now();
        const tick = now => { window.inkTiming.frames.push(now - last); last = now; window.inkTiming.work.push(Number(document.querySelector('.graph-canvas').dataset.inkFrameMs || 0)); if (!window.inkTiming.stop) requestAnimationFrame(tick); }; requestAnimationFrame(tick);
      });
      await drag(target, width === 375 ? -30 : -100, -30);
      const metrics = await page.evaluate(() => { const s = window.inkTiming; s.stop = true; const sorted = s.frames.slice(3).sort((a,b) => a-b), work = s.work.slice(3).sort((a,b) => a-b); return { frameMedian: sorted[Math.floor(sorted.length / 2)], frameP95: sorted[Math.floor(sorted.length * .95)], workerMedian: work[Math.floor(work.length*.5)], workerP95: work[Math.floor(work.length*.95)], workerMax: Math.max(...s.work), cell: document.querySelector('.graph-canvas').dataset.inkCell, quality: document.querySelector('.graph-canvas').dataset.inkQuality }; });
      console.log(`500-node ${width}px performance ${JSON.stringify(metrics)}`);
      if (width !== 375 && metrics.frameMedian > 20) console.warn('Desktop 60fps target not reached on this browser; measured result retained above.');
      assert.ok(metrics.frameMedian <= 34, 'dragging retains at least 30fps median cadence');
    }
    const video = page.video(); await page.close(); if (video) await video.saveAs(`qa/paint-videos/fixture-${width}-${theme}.webm`);
  }
} finally { await browser.close(); }
