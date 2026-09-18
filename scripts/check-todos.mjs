import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { mkdir } from 'node:fs/promises';
await mkdir('qa', { recursive: true });
const browser = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
try {
  for (const width of [375, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: 1000 } });
    let saved = { date: '2026-09-09', todos: [], todosExtra: '', weather: '', sleep: '', mood: '', facts: { events: [], note: '' }, learn: { sources: [], content: '' }, input: { kind: '书', names: [], excerpt: '' }, idea: { tags: [], content: '' }, unknownFrontmatter: {}, unknownSections: [] };
    await page.route('**/api/**', route => {
      const path = new URL(route.request().url()).pathname;
      if (/\/diaries\/\d{4}-\d{2}-\d{2}$/.test(path)) {
        if (route.request().method() === 'PUT') saved = route.request().postDataJSON();
        saved.date = path.split('/').at(-1);
        return route.fulfill({ json: { document: saved, version: 'test', exists: true } });
      }
      if (path === '/api/entities') return route.fulfill({ json: { entities: [] } });
      if (path === '/api/tags') return route.fulfill({ json: { tags: { person: [], place: [], activity: [], food: [], thing: [] } } });
      if (path === '/api/weeks') return route.fulfill({ json: { start: saved.date, end: saved.date, entries: [] } });
      return route.abort();
    });
    await page.goto('http://127.0.0.1:5173', { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: /待办 ·/ }).click();
    await page.getByLabel('准备做什么').fill('整理今天的会议笔记');
    await page.getByLabel('计划时间（可选）', { exact: true }).fill('14:30');
    await page.getByRole('button', { name: '添加待办', exact: true }).click();
    await page.getByRole('button', { name: '立即保存' }).click();
    await page.waitForTimeout(500);
    assert.equal(saved.todos[0].time, '14:30');
    await page.getByRole('checkbox', { name: '完成：整理今天的会议笔记' }).check();
    await page.getByRole('button', { name: '立即保存' }).click();
    await page.waitForTimeout(500);
    assert.equal(saved.todos[0].done, true);
    await page.getByRole('button', { name: '整理今天的会议笔记', exact: true }).click();
    await page.getByLabel('修改待办内容').fill('整理会议笔记并发送');
    await page.getByRole('button', { name: '确定', exact: true }).click();
    await page.getByRole('button', { name: '立即保存' }).click();
    await page.waitForTimeout(500);
    assert.equal(saved.todos[0].title, '整理会议笔记并发送');
    if (await page.getByRole('button', { name: '关闭小票提示' }).count()) await page.getByRole('button', { name: '关闭小票提示' }).click();
    await page.screenshot({ path: `qa/todos-${width}.png` });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.reload({ waitUntil: 'networkidle' });
    await page.getByRole('button', { name: /待办 ·/ }).click();
    assert.equal(await page.getByRole('checkbox').isChecked(), true);
    await page.getByRole('checkbox').uncheck();
    page.on('dialog', dialog => dialog.accept());
    await page.getByRole('button', { name: '删除待办：整理会议笔记并发送' }).click();
    await page.getByRole('button', { name: '立即保存' }).click();
    await page.waitForTimeout(500);
    assert.equal(saved.todos.length, 0);
    await page.close();
  }
  console.log('PASS: add, time, complete, edit, reload, restore, delete and responsive layout. Mock data only.');
} finally { await browser.close(); }
