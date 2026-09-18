import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
const browser = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
try {
  for (const width of [1440, 768, 375]) {
    const page = await browser.newPage({ viewport: { width, height: 1000 }, recordVideo: { dir: 'qa/paint-videos', size: { width, height: 1000 } } });
    await page.route('**/api/**', route => route.request().method() === 'GET' ? route.continue() : route.abort());
    await page.goto('http://127.0.0.1:4173', { waitUntil: 'domcontentloaded' });
    await page.getByRole('tab', { name: '关联', exact: true }).click();
    await page.waitForSelector('.graph-canvas[data-ink-ready="true"]');
    await page.getByRole('button', { name: '适应画布' }).click();
    await page.locator('.graph-canvas').scrollIntoViewIfNeeded();
    const nodes = page.locator('.graph-node.node-person');
    if (!await nodes.count()) throw new Error('No actual entities to measure');
    const before = await page.locator('.graph-node').evaluateAll(els => Object.fromEntries(els.map(el => [el.dataset.nodeId, el.getAttribute('transform')])));
    await page.locator('.graph-section').screenshot({ path: `qa/territory-real-${width}-before.png` });
    let target = nodes.last();
    for (let i = await nodes.count() - 1; i >= 0; i--) if (await nodes.nth(i).evaluate(el => { const b = el.querySelector('circle:last-of-type').getBoundingClientRect(); return document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2)?.closest('.graph-node') === el; })) { target = nodes.nth(i); break; }
    const id = await target.getAttribute('data-node-id');
    await target.focus();
    await page.evaluate(() => { window.measure = { frames: [], worker: [], stop: false }; let last = performance.now(); const tick = now => { window.measure.frames.push(now-last); last=now; window.measure.worker.push(+document.querySelector('.graph-canvas').dataset.inkFrameMs); if (!window.measure.stop) requestAnimationFrame(tick); }; requestAnimationFrame(tick); });
    const b = await target.locator('circle').last().boundingBox();
    await page.mouse.move(b.x+b.width/2,b.y+b.height/2); await page.mouse.down();
    for (let i=1;i<=30;i++) { await page.mouse.move(b.x+b.width/2+(width===375 ? -50 : -180)*i/30,b.y+b.height/2-80*i/30); await page.waitForTimeout(16); }
    await page.mouse.up();
    await page.waitForSelector('.graph-canvas[data-ink-active="false"]');
    const after = await page.locator('.graph-node').evaluateAll(els => Object.fromEntries(els.map(el => [el.dataset.nodeId, el.getAttribute('transform')])));
    for (const key in before) if (key !== id) assert.equal(after[key], before[key], 'untouched nodes stay fixed');
    assert.notEqual(after[id],before[id]);
    const covered = await target.evaluate(el => { const m = el.transform.baseVal.consolidate().matrix; return [...document.querySelectorAll('.graph-ink')].some(path => path.isPointInFill(new DOMPoint(m.e,m.f))); });
    assert.ok(covered, `dragged member ${id} remains covered`);
    const timing = await page.evaluate(() => { window.measure.stop=true; const percentile=(a,p)=>a.slice(3).sort((a,b)=>a-b)[Math.floor((a.length-3)*p)]; return { nodes: document.querySelectorAll('.graph-node').length, frameMedian:percentile(window.measure.frames,.5), frameP95:percentile(window.measure.frames,.95), workerMedian:percentile(window.measure.worker,.5), workerP95:percentile(window.measure.worker,.95) }; });
    console.log(`Actual data ${width}px: ${JSON.stringify(timing)}`);
    await page.getByRole('button', { name: '适应画布' }).click(); await page.mouse.move(0,0); await page.waitForTimeout(220);
    await page.locator('.graph-section').screenshot({ path: `qa/territory-real-${width}-after.png` });
    // A separate fast stroke/reversal is recorded outside the performance sample.
    const box = await target.locator('circle').last().boundingBox();
    const sx=box.x+box.width/2, sy=box.y+box.height/2, delta=width===375 ? 40 : 100;
    await page.mouse.move(sx,sy); await page.mouse.down();
    await page.mouse.move(sx+delta,sy+25,{steps:3}); await page.waitForTimeout(40);
    await page.mouse.move(sx+delta*.35,sy-15,{steps:3}); await page.mouse.up();
    const moving = await page.locator('.graph-ink').evaluateAll(els=>els.map(el=>el.getAttribute('d')).join(''));
    await page.waitForTimeout(120);
    assert.notEqual(await page.locator('.graph-ink').evaluateAll(els=>els.map(el=>el.getAttribute('d')).join('')), moving, 'paint continues after release');
    await page.locator('.graph-section').screenshot({ path: `qa/paint-moving-${width}.png` });
    await page.waitForSelector('.graph-canvas[data-ink-active="false"]');
    const video = page.video(); await page.close(); await video.saveAs(`qa/paint-videos/actual-${width}.webm`);
  }
} finally { await browser.close(); }
