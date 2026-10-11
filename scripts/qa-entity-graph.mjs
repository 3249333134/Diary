import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { emptyDiary, entityKey } from '../packages/contracts/dist/index.js';

// Read live entities once; all browser API requests are isolated and never write to the vault.
const live = await fetch('http://127.0.0.1:4319/api/entities').then(r => r.json()).then(r => r.entities);
const date = '2026-10-07';
const event = i => ({ key: `event|${date}|${i}`, date, time: '12:00', note: `测试事件 ${i}`, index: i });
const entity = (type, name, ids) => ({ key: entityKey(type, name), type, name, tags: [], mentions: [date], occurrences: ids.map(event), eventRelations: [], dayRelations: [] });
const fixture = [entity('place', '测试地点', [0,1,2,3]), entity('person', '共同成员', [0,1,2,3]), entity('food', '单次食物', [0]), entity('activity', '常见活动', [0,1,2,3]), entity('thing', '默认隐藏', [0])];
const dense = [...fixture, ...Array.from({length: 495}, (_, i) => entity('person', `成员${i}`, [i % 100]))];
const hierarchy = [entity('place', '园区', [0]), { ...entity('place', '南院', [1]), parentKey: 'place|园区' }, { ...entity('place', '书房', [2]), parentKey: 'place|南院' }, entity('person', '成员', [0,1,2])];
const root = path.resolve('apps/web/dist');
const server = createServer(async (req, res) => {
  try {
    const file = path.resolve(root, '.' + (req.url === '/' ? '/index.html' : req.url.split('?')[0]));
    if (!file.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
    res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html');
    res.end(await readFile(file));
  } catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
const output = 'qa/entity-graph';
await mkdir(output, { recursive: true });
const results = [];
try {
  for (const width of [375,768,1440]) for (const theme of ['light','dark']) for (const [name, entities] of [['empty',[]],['hierarchy',hierarchy],['fixture',fixture],['actual',live],['dense',dense]]) {
    if (process.env.QA_INK_CHECKS && (theme !== 'light' || width === 768 || !['fixture','actual','dense'].includes(name))) continue;
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const errors = []; page.on('pageerror', e => { errors.push(e.message); console.error(e.message); });
    page.on('requestfailed', request => console.error(request.url(), request.failure()));
    await page.addInitScript(theme => localStorage.setItem('diary.theme', theme), theme);
    if (process.env.QA_INK_CHECKS) await page.addInitScript(() => {
      window.inkDraws = [];
      const original = WebGLRenderingContext.prototype.drawArrays;
      WebGLRenderingContext.prototype.drawArrays = function(...args) {
        window.inkDraws.push(performance.now()); return original.apply(this,args);
      };
    });
    await page.route('**/api/**', async route => {
      const url = new URL(route.request().url());
      assert.equal(route.request().method(), 'GET', 'No vault writes allowed');
      let body = {};
      if (url.pathname === '/api/entities') body = { entities };
      else if (url.pathname === '/api/actions') body = { tasks: [], records: [] };
      else if (url.pathname.startsWith('/api/diaries/')) body = { document: emptyDiary(url.pathname.split('/').pop()), exists: false, version: 'qa' };
      else if (url.pathname === '/api/diaries') body = { dates: [] };
      else if (url.pathname === '/api/tags') body = { tags: { person: [], place: [], activity: [], food: [], thing: [] } };
      else if (url.pathname === '/api/weeks') body = { start: date, end: date, entries: [] };
      else if (url.pathname === '/api/quick-facts') body = { facts: [] };
      await route.fulfill({ json: body });
    });
    await page.goto(`http://127.0.0.1:${server.address().port}`, { waitUntil: 'domcontentloaded' });
    console.log('Checking', name, width, theme);
    await page.locator('.section-nav').getByRole('tab', { name: '关联', exact: true }).click();
    if (entities.length) await page.waitForFunction(() => [...document.querySelectorAll('.graph-ink')].some(p => p.getAttribute('d')));
    else await page.locator('.graph-empty').waitFor();
    await page.locator('.ink-ocean-ready').waitFor();
    assert.equal(await page.locator('.graph-node.node-event,.graph-node.node-date,.graph-node.node-thing').count(), 0);
    assert.equal(await page.locator('.node-place circle').count(), 0);
    const bounds = await page.locator('.graph-canvas').boundingBox();
    assert.equal(Math.round(bounds.width), width); assert.equal(Math.round(bounds.y), 0);
    const nodeCount = await page.locator('.graph-node').count();
    if (name === 'fixture') {
      await page.getByRole('button', { name: '地图配色', exact: true }).click();
      await page.getByLabel('背景颜色', { exact: true }).fill('#123abc');
      await page.getByLabel('测试地点颜色', { exact: true }).fill('#e945bc');
      assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('diary.ink-colors.v2')).sea), '#123abc');
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.locator('.section-nav').getByRole('tab', { name: '关联', exact: true }).click();
      await page.getByRole('button', { name: '地图配色', exact: true }).click();
      assert.equal(await page.getByLabel('背景颜色', { exact: true }).inputValue(), '#123abc');
      assert.equal(await page.getByLabel('测试地点颜色', { exact: true }).inputValue(), '#e945bc');
      await page.getByRole('button', { name: '恢复默认配色', exact: true }).click();
      await page.getByRole('button', { name: '关闭配色', exact: true }).click();
      const node = page.locator('[data-node-id="food|单次食物"]');
      assert.equal(await node.locator('text').count(), 0);
      await node.focus(); assert.equal(await node.locator('text').textContent(), '单次食物');
      await node.press('Enter');
      await page.getByRole('button', { name: '关闭节点详情' }).click();
      await page.getByRole('textbox', { name: '搜索图谱节点' }).fill('单次食物');
      assert.equal(await node.locator('text').textContent(), '单次食物');
      await page.getByRole('button', { name: '清除搜索' }).click();
      const styles = () => page.locator('.graph-edge-event').evaluateAll(lines => lines.map(line => ({ stroke: getComputedStyle(line).stroke, width: getComputedStyle(line).strokeWidth, opacity: getComputedStyle(line).opacity })));
      const before = await styles();
      assert(new Set(before.map(s => s.stroke)).size > 1);
      await page.locator('[data-node-id="person|共同成员"]').focus();
      const active = await styles();
      assert.equal(new Set(active.map(s => s.stroke)).size, new Set(before.map(s => s.stroke)).size);
      await page.getByRole('button', { name: '筛选图谱' }).click();
      await page.getByRole('button', { name: '显示事件节点', exact: true }).click();
      assert.equal(await page.locator('.graph-node.node-event').count(), 4);
      assert.deepEqual((await styles()).map(s => [s.stroke,s.width]), before.map(s => [s.stroke,s.width]));
      await page.getByRole('button', { name: '显示事件节点', exact: true }).click();
      await page.getByRole('button', { name: '筛选图谱' }).click();
      await page.mouse.move(1, 1);
      const initial = await node.getAttribute('transform');
      const other = await page.locator('[data-node-id="person|共同成员"]').getAttribute('transform');
      const box = await node.locator('circle').last().boundingBox();
      const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      await page.mouse.move(center.x, center.y); await page.mouse.down();
      await page.mouse.move(center.x + 30, center.y + 20, { steps: 8 }); await page.mouse.up();
      assert.notEqual(await node.getAttribute('transform'), initial);
      assert.equal(await page.locator('[data-node-id="person|共同成员"]').getAttribute('transform'), other);
      assert.equal(await page.locator('.graph-inspector').count(), 0);
    }
    await page.getByRole('button', { name: '适应画布' }).click();
    await page.getByRole('button', { name: '放大图谱' }).click();
    await page.getByRole('button', { name: '缩小图谱' }).click();
    if (!process.env.QA_INK_CHECKS && (name === 'actual' || name === 'dense')) await page.screenshot({ path: `${output}/${name}-${width}-${theme}.png` });
    let inkTiming;
    if (process.env.QA_INK_CHECKS) {
      inkTiming = await page.evaluate(async () => {
        window.inkDraws = []; await new Promise(resolve => setTimeout(resolve,1500));
        const times = window.inkDraws, gaps = times.slice(1).map((time,i)=>time-times[i]).sort((a,b)=>a-b);
        return { samples:times.length, medianMs:gaps[Math.floor(gaps.length*.5)], p95Ms:gaps[Math.floor(gaps.length*.95)] };
      });
      assert(inkTiming.samples > 2);
      await page.emulateMedia({reducedMotion:'reduce'});
      await page.waitForFunction(() => document.querySelector('.graph-canvas').dataset.inkActive !== 'true');
      const reducedFrames = await page.evaluate(async () => {
        await new Promise(resolve => requestAnimationFrame(()=>requestAnimationFrame(resolve)));
        window.inkDraws = []; await new Promise(resolve=>setTimeout(resolve,300)); return window.inkDraws.length;
      });
      assert.equal(reducedFrames,0,'Reduced motion must stop material animation');
      const canLose = await page.evaluate(() => {
        const extension = document.querySelector('.ink-ocean').getContext('webgl').getExtension('WEBGL_lose_context');
        if (extension) extension.loseContext(); return !!extension;
      });
      if(canLose) {
        await page.waitForFunction(()=>!document.querySelector('.ink-ocean-ready'));
        await page.locator('.ink-bloom-fallback').waitFor({state:'visible'});
        assert(await page.locator('.ink-bloom-fallback ellipse').count()>0);
      }
    }
    if (name === 'hierarchy') {
      const location = page.locator('[data-node-id="place|书房"]');
      assert.equal(await location.locator('.graph-hit-area').getAttribute('height'), '44');
      await location.focus(); await location.press('Enter');
      await page.locator('.graph-inspector').waitFor();
      await page.locator('.graph-detail-group').first().getByRole('button').first().click();
      await page.waitForFunction(() => document.querySelector('.main-content')?.getAttribute('data-workspace') !== 'lookup');
    }
    assert.deepEqual(errors, []);
    results.push({ width, theme, dataset: name, entities: entities.length, nodes: nodeCount, passed: true, inkTiming });
    await page.close();
  }
  await writeFile(`${output}/${process.env.QA_INK_CHECKS ? 'ink-checks' : 'results'}.json`, JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results));
} finally { await browser.close(); server.close(); }
