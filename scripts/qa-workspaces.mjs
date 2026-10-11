import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { emptyDiary, todoSchema, captureDraftSchema, appendCapture } from '../packages/contracts/dist/index.js';

// Isolated browser fixtures: no requests or writes reach the user's vault or AI.
const root = path.resolve('apps/web/dist');
const server = createServer(async (req, res) => {
  try {
    const file = path.resolve(root, '.' + (req.url === '/' ? '/index.html' : req.url.split('?')[0]));
    if (!file.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
    const data = await readFile(file);
    res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html'); res.end(data);
  } catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const results = [];
await mkdir('qa/workspaces', { recursive: true });
try {
  for (const width of [375, 768, 1440]) for (const theme of ['light', 'dark']) for (const eventCount of (process.env.QA_GLASS ? (process.env.QA_GRAPH_FULL ? [5] : [0,1,5,30]) : [0])) {
    const page = await browser.newPage({ viewport: { width, height: 1000 } });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(theme => localStorage.setItem('diary.theme', theme), theme);
    const document = emptyDiary(today);
    if (process.env.QA_GLASS) document.facts.events = Array.from({length:eventCount},(_,i)=>({id:'qa-event-'+i,time:'08:30',note:'记录 '+(i+1)+'：整理资料并核对计划',remark:'',people:[],places:[],activities:[],foods:[],attachments:[]}));
    document.todos = [todoSchema.parse({ id: 'sample-plan', title: '整理访谈资料', dueDate: today, dueTime: '09:00', priority: 'high', list: '工作', description: '核对已记录的问题', tags: ['访谈'] })];
    const docs = new Map([[today, document]]);
    let calls = 0;
    let failWriteOnce = true;
    let failParse = false;
    await page.route('**/api/**', async route => {
      const req = route.request(); const url = new URL(req.url()); let body = {};
      if (url.pathname === '/api/actions') {
        if (req.method() === 'POST') {
          const input = req.postDataJSON(); const d = docs.get(input.date) || emptyDiary(input.date);
          if (!d.todos.some(t => t.id === input.task.id)) d.todos.push(input.task);
          if (input.mode === 'complete') {
            const task = d.todos.find(t => t.id === input.task.id); task.done = true; task.status = 'done';
            if (input.automaticRecord && !task.completion) {
              const record=captureDraftSchema.parse({id:crypto.randomUUID(),kind:'facts',date:today,time:'12:20',content:`完成计划：${task.title}`,description:`原计划说明：${task.description}`});
              d.facts.events.push(...appendCapture(emptyDiary(today),record,{date:d.date,kind:'todo',id:task.id,summary:task.title}).facts.events);
              task.completion={date:today,kind:'facts',id:record.id,summary:record.content};
            }
            if (input.completionRecord) {
              const record = input.completionRecord;
              const target = docs.get(record.date) || emptyDiary(record.date);
              docs.set(record.date, appendCapture(target, record, { date: d.date, kind: 'todo', id: task.id, summary: task.title }));
              task.completion = { date: record.date, kind: record.kind, id: record.id, summary: record.content };
            }
          }
          docs.set(input.date, d); body = { diary: { document: d, version: 'v1', exists: true } };
        } else body = { tasks: [...docs.values()].flatMap(d => d.todos.map(task => ({ date: d.date, version: 'v1', task, sourceExists: true, completionExists: !!task.completion }))), records: [] };
      } else if (url.pathname.startsWith('/api/diaries/')) {
        const date = url.pathname.split('/').pop();
        if (req.method() === 'PUT') {
          docs.set(date, req.postDataJSON());
          if (failWriteOnce && req.postDataJSON().entries?.learn?.length) { failWriteOnce = false; await route.fulfill({ status: 503, json: { error: '模拟写入成功但响应丢失' } }); return; }
        }
        body = { document: docs.get(date) || emptyDiary(date), version: 'v1', exists: true };
      } else if (url.pathname === '/api/capture/parse') {
        if (failParse) { await route.fulfill({ status: 503, json: { error: '模拟 AI 不可用' } }); return; }
        calls++;
        body = { today, timezone: 'Asia/Shanghai', drafts: [captureDraftSchema.parse({ id: crypto.randomUUID(), kind: 'plan', content: '约下一次讨论', date: '' }), captureDraftSchema.parse({ id: crypto.randomUUID(), kind: 'learn', content: '今天学到访谈要先问开放问题', date: today })] };
        if (req.postDataJSON().completion) body.drafts = [captureDraftSchema.parse({ id: crypto.randomUUID(), kind: 'idea', content: '整理时发现可以按主题建立索引', date: today })];
      } else if (url.pathname === '/api/entities') body = { entities: [] };
      else if (url.pathname === '/api/tags') body = { tags: { person: [], place: [], activity: [], food: [], thing: [] } };
      else if (url.pathname === '/api/tag-library') body = {tags:[]};
      else if (url.pathname === '/api/plan-views') body = {views:[]};
      else if (url.pathname === '/api/weeks') body = { start: today, end: today, entries: [] };
      else if (url.pathname === '/api/quick-facts') body = { facts: [] };
      else if (url.pathname === '/api/diaries') body = { dates: [] };
      await route.fulfill({ json: body });
    });
    await page.goto(`http://127.0.0.1:${server.address().port}/`, { waitUntil: 'networkidle' });
    const nav = page.locator(width < 900 ? '.mobile-workspace-switch' : '.date-rail .workspace-switch');
    const openCapture = async () => { if(width < 900 && !(await page.locator('#capture-panel').isVisible())) await page.getByRole('button',{name:/AI · 记一句话/}).click(); };
    const closeCapture = async () => { if(width < 900 && await page.locator('#capture-panel').isVisible()) await page.getByRole('button',{name:'收起',exact:true}).click(); };
    const switchWorkspace = async name => { await closeCapture(); await page.getByRole('button',{name,exact:true}).click(); };
    if (process.env.QA_GLASS) {
      assert.equal(await page.getByText('今天还没有事实记录',{exact:true}).count(),0);
      await page.getByRole('heading',{name: new RegExp('今日事实.*'+eventCount+' 条')}).waitFor();
      const geometry = await page.evaluate(() => ({body:document.documentElement.scrollHeight,viewport:innerHeight,list:document.querySelector('.event-stack')?.getBoundingClientRect().toJSON(),nav:document.querySelector('.section-nav')?.getBoundingClientRect().toJSON()}));
      if(width<900) {
        assert.ok(geometry.body <= geometry.viewport+1, JSON.stringify(geometry));
        if(eventCount) { assert.ok(geometry.list.height>60,JSON.stringify(geometry)); assert.ok(geometry.list.bottom<geometry.nav.top-40,JSON.stringify(geometry)); }
        await page.mouse.wheel(0,500); assert.equal(await page.evaluate(()=>window.scrollY),0);
      }
      if(eventCount) {
        await page.locator('.event-stack').evaluate(el=>el.scrollTop=el.scrollHeight);
        const last=await page.locator('.event-block').last().boundingBox();
        if(width<900) assert.ok(last.bottom === undefined ? last.y+last.height<=geometry.list.bottom+1 : true);
        await page.locator('.event-stack').evaluate(el=>el.scrollTop=0);
        await page.locator('.event-toggle').first().click();
        await page.locator('.event-block').first().locator('textarea').first().fill('编辑后仍保留');
        await page.locator('.event-toggle').first().click();
      }
      await page.getByRole('button',{name:'展开编辑',exact:true}).click();
      await page.locator('#expanded-day-note').fill('较长备注。'.repeat(80));
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('#compact-day-note').inputValue(),'较长备注。'.repeat(80));
      if(width<900 && eventCount===5) {
        for(const height of [812,640]) {
          await page.setViewportSize({width,height});
          await page.waitForTimeout(80);
          const bounds=await page.locator('.event-stack').boundingBox(); assert.ok(bounds.height>60,JSON.stringify(bounds));
          assert.ok(await page.evaluate(()=>document.documentElement.scrollHeight<=innerHeight+1));
        }
        await page.locator('.event-toggle').first().click();
        const field=page.locator('.event-block').first().locator('textarea').first(); await field.focus();
        await page.setViewportSize({width,height:450});
        await page.waitForTimeout(80);
        assert.ok((await page.locator('.event-stack').boundingBox()).height>100);
        await field.fill('短视口下继续编辑');
        await page.setViewportSize({width,height:1000});
        await page.locator('.event-toggle').first().click();
        const cdp=await page.context().newCDPSession(page);
        await cdp.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-transparency',value:'reduce'}]});
        assert.equal(await page.locator('.facts-panel').evaluate(el=>getComputedStyle(el).backdropFilter),'none');
        await cdp.send('Emulation.setEmulatedMedia',{features:[]}); await cdp.detach();
      }
      if(eventCount===5 && !process.env.QA_FUNCTIONAL_ONLY) await page.screenshot({path:`qa/workspaces/glass-${width}-${theme}.png`});
      await page.getByRole('tab',{name:'关联',exact:true}).click();
      assert.equal(await page.locator('#capture-panel').isVisible(),false);
      if(process.env.QA_GRAPH_FULL) {
        const frame=await page.locator('.graph-section').boundingBox();
        assert.ok(Math.abs(frame.x)<1 && Math.abs(frame.y)<1 && Math.abs(frame.width-width)<1,JSON.stringify(frame));
        assert.ok(frame.height>=930,JSON.stringify(frame));
        assert.equal(await page.locator('.topbar').isVisible(),false);
        await page.screenshot({path:`qa/workspaces/fullgraph-${width}-${theme}.png`});
        await page.getByRole('tab',{name:'事实',exact:true}).click();
        assert.equal(await page.locator('.topbar').isVisible(),true);
        await page.getByRole('tab',{name:'关联',exact:true}).click();
      }
      if(width<900) { const canvas=await page.locator('.graph-canvas-wrap').boundingBox(); assert.ok(canvas.height>150); }
      assert.deepEqual(errors,[]); results.push({width,theme,eventCount,geometry});
      await page.close(); continue;
    }
    if (process.env.QA_MOBILE_CAPTURE_ONLY) {
      const entry = page.getByRole('button', { name: /AI · 记一句话/ });
      if (width < 900) {
        assert.equal(await page.locator('#capture-panel').isVisible(), false);
        await entry.click(); await page.locator('#capture-text').fill('收起后继续写');
        await page.getByRole('button', {name:'收起',exact:true}).click();
        await entry.click(); assert.equal(await page.locator('#capture-text').inputValue(), '收起后继续写');
        await page.keyboard.press('Escape');
        assert.equal(await page.locator('#capture-panel').isVisible(), false);
        const triggerBox = await entry.boundingBox();
        const navBox = await page.getByRole('tablist', {name:'日记栏目'}).boundingBox();
        assert.ok(triggerBox.y + triggerBox.height <= navBox.y, 'AI bar does not overlap tabs');
      }
      await page.getByRole('tab', { name:'关联',exact:true }).click();
      assert.equal(await page.locator('#capture-panel').isVisible(), false);
      assert.equal(await entry.isVisible(), false);
      await page.getByRole('tab', { name:'事实',exact:true }).click();
      if(width < 900) assert.equal(await entry.isVisible(), true);
      await nav.getByRole('button', { name:'计划',exact:true }).click();
      if(width < 900) { const bounds=await entry.boundingBox(); assert.ok(bounds.y>900); }
      await page.screenshot({path: `qa/workspaces/capture-${width}-${theme}.png`,fullPage:false});
      assert.deepEqual(errors, []);
      results.push({width,theme,checks:['mobile collapsed bottom entry','draft retained on collapse','no AI in graph','plan bottom position','no page errors']});
      await page.close(); continue;
    }
    await openCapture();
    await page.locator('#capture-text').fill('今天学到访谈方法，安排下次讨论');
    await switchWorkspace('计划');
    assert.equal(await page.locator('#capture-text').inputValue(), '今天学到访谈方法，安排下次讨论');
    await openCapture();
    await page.getByRole('button', { name: '整理为草稿', exact: true }).click();
    await page.locator('.capture-draft').nth(1).waitFor();
    assert.equal(calls, 1);
    await switchWorkspace('日记');
    assert.equal(await page.locator('.capture-draft').count(), 2);
    await switchWorkspace('计划');
    await openCapture();
    await page.locator('.capture-draft').first().getByRole('button', { name: '确认保存此条' }).click();
    await page.locator('.capture-draft').first().getByText('已保存', { exact: true }).waitFor();
    await page.locator('.capture-draft').nth(1).getByRole('button', { name: '确认保存此条' }).click();
    await page.locator('.capture-draft').nth(1).getByRole('button', { name: '重试此条' }).click();
    await page.locator('.capture-draft').nth(1).getByText('已保存', { exact: true }).waitFor();
    assert.equal(docs.get(today).todos.length, 2);
    assert.equal(docs.get(today).entries.learn.length, 1);
    await closeCapture();
    await page.getByRole('button', { name: '筛选计划', exact: true }).click();
    await page.getByRole('navigation', { name: '计划范围' }).getByRole('button', { name: '全部', exact: true }).click();
    await page.getByRole('dialog', { name: '筛选计划', exact: true }).getByRole('button', { name: /显示 .* 项/ }).click();
    await page.locator('.todo-list').getByText('约下一次讨论', { exact: true }).waitFor();
    await page.getByRole('button', { name: '新增计划', exact: true }).click();
    await page.locator('.plan-edit-dialog[open]').waitFor();
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('.plan-edit-dialog[open]').count(), 0);
    await page.locator('.todo-list li').first().locator('.plan-card-summary').click();
    await page.locator('.todo-list li').first().getByRole('button', { name: '完成', exact: true }).click();
    await page.locator('.todo-list').getByRole('button', { name: '查看日记', exact: true }).waitFor();
    assert.equal(docs.get(today).facts.events.length, 1);
    await page.locator('.todo-list').getByRole('button', { name: '查看日记', exact: true }).click();
    await page.getByRole('tab', { name: '事实', exact: true, selected: true }).waitFor();
    await switchWorkspace('计划');
    if (!process.env.QA_FUNCTIONAL_ONLY) await page.screenshot({ path: `qa/workspaces/${width}-${theme}.png`, fullPage: true });
    failParse = true;
    await openCapture();
    await page.getByRole('button', { name: '整理为草稿', exact: true }).click();
    await page.locator('.capture-draft').getByText('AI 未能识别', { exact: false }).waitFor();
    assert.equal(await page.locator('.capture-draft').getByLabel('用途', { exact: true }).inputValue(), '');
    assert.equal(await page.locator('.capture-draft').getByRole('button', { name: '确认保存此条' }).isDisabled(), true);
    await page.locator('.capture-draft').getByLabel('用途', { exact: true }).selectOption('plan');
    assert.equal(await page.locator('.capture-draft').getByLabel('截止日期（可留空）', { exact: true }).inputValue(), '');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'horizontal overflow');
    assert.deepEqual(errors, []);
    results.push({ width, theme, checks: ['workspace switch retains capture', 'mixed draft per-item save', 'lost response retry without duplicates', 'AI failure requires explicit kind', 'undated plan in all', 'keyboard dialog dismiss', 'automatic fact and diary navigation', 'no page errors', 'no horizontal overflow'] });
    await page.close();
  }
  await writeFile(process.env.QA_GLASS ? 'qa/workspaces/glass-results.json' : 'qa/workspaces/results.json', JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results));
} finally { await browser.close(); server.close(); }
