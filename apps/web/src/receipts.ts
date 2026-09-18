import type { DiaryDocument, DiaryEvent } from '@diary/contracts';

export type Receipt = {
  id: string;
  date: string;
  kind: string;
  time: string;
  content: string;
  details: string[];
  remark: string;   // 这张小票的专属一句话
};

/* ═══════════════════════════════════════════════════════════
 * Rule-based 生成每张纸的 remark
 * 不用 AI 也能有温度的话；有 AI key 时会被覆盖
 *
 * 设计原则：
 *  - 按 kind 分模板池
 *  - 根据实体标签选更贴切的（有 "朋友" 标签就不输出"独处"类）
 *  - 用确定性哈希从池里挑一句（不是随机，避免刷新就变）
 * ═══════════════════════════════════════════════════════════ */

const FACT_REMARKS_BY_SIGNAL: Array<{ match: (e: DiaryEvent) => boolean; pool: string[] }> = [
  {
    match: (e) => e.people.some(p => p.tags.some(t => /朋友|熟人|同事|同学|家人/.test(t))) || e.people.length >= 2,
    pool: [
      '和大家在一起的时光，值得被记住。',
      '有人陪着，平凡的事也会亮一点。',
      '与人相处的片段，是生活最软的部分。',
      '相聚的时刻，再多也不嫌多。',
    ],
  },
  {
    match: (e) => e.activities.some(a => /工作|开发|编程|写|设计|项目/.test(a.name + a.tags.join(''))) || !!e.remark,
    pool: [
      '认真投入的时刻，正在让你变得更稳。',
      '一件一件做完，就是了不起的一天。',
      '坚持本身，就是最好的证明。',
      '每一份认真，都会在某处产生回响。',
    ],
  },
  {
    match: (e) => e.foods.length > 0 || e.activities.some(a => /吃|喝|聚餐|饭|烧烤|面|coffee|咖啡/.test(a.name)),
    pool: [
      '吃饱喝足，就是最简单的满足。',
      '能一起吃饭的人，都值得珍惜。',
      '美食会让人短暂地忘掉其他事。',
      '一顿好饭，值得一张小票。',
    ],
  },
  {
    match: (e) => e.activities.some(a => /散步|走|运动|跑|锻炼|健身/.test(a.name)),
    pool: [
      '身体动起来的时候，心也跟着轻了。',
      '每一步都算数，包括走出的那几步。',
    ],
  },
  {
    match: () => true, // 默认兜底
    pool: [
      '这一刻，留在纸上。',
      '平凡的事，认真地记下。',
      '一天的碎片里，藏着完整的你。',
      '不特别的日子，也值得被看见。',
      '以后想起，会感激现在的自己。',
    ],
  },
];

const LEARN_POOL = [
  '又解锁了一个新认知。',
  '新知识正在悄悄重塑你的理解。',
  '每一次恍然大悟，都值得留个印记。',
  '知道了以前不知道的事，挺好。',
];

const INPUT_POOL = [
  '继续在自己的节奏里积累。',
  '这些输入，以后都会变成你的营养。',
  '安静地吸收，也是一种前进。',
  '读过的、看过的，都在悄悄改变你。',
];

const IDEA_POOL = [
  '抓住了转瞬即逝的光。',
  '灵感最可贵的地方，就是它不打招呼就来。',
  '写下来的那一刻，想法就有了形状。',
  '灵光一闪的瞬间，别让它跑了。',
];

const MEMO_POOL = [
  '你写备注的样子，已经在认真生活了。',
  '多给自己一句解释，挺好的。',
  '写下来的情绪，会慢慢放轻。',
];

function hashPick<T>(pool: T[], seed: string): T {
  // 简单的字符串哈希，确定性地挑一句
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) { h ^= seed.charCodeAt(i); h = Math.imul(h, 16777619); }
  return pool[Math.abs(h) % pool.length];
}

export function remarkForReceipt(kind: string, content: string, event?: DiaryEvent): string {
  const seed = `${kind}:${content.slice(0, 20)}`;
  if (kind === '事实' && event) {
    for (const signal of FACT_REMARKS_BY_SIGNAL) {
      if (signal.match(event)) return hashPick(signal.pool, seed);
    }
  }
  if (kind === '新知') return hashPick(LEARN_POOL, seed);
  if (kind === '输入') return hashPick(INPUT_POOL, seed);
  if (kind === '灵感') return hashPick(IDEA_POOL, seed);
  if (kind === '今日备注') return hashPick(MEMO_POOL, seed);
  return hashPick(FACT_REMARKS_BY_SIGNAL.at(-1)!.pool, seed);
}

/* ═══════════════════════════════════════════════════════════
 * 纸尾总结（day-end）
 * 根据当天所有 receipts 的整体特征合成
 * ═══════════════════════════════════════════════════════════ */
export function summarizeDay(receipts: Receipt[]): string {
  if (!receipts.length) return '';
  const kinds = new Set(receipts.map(r => r.kind));
  const facts = receipts.filter(r => r.kind === '事实');
  const hasPeople = facts.some(r => r.details.some(d => d.startsWith('和谁：')));
  const hasWork = facts.some(r => /开发|写代码|工作|项目|编程/.test(r.content));
  const hasFood = facts.some(r => r.details.some(d => d.startsWith('吃了什么：')) || /吃|饭|咖啡/.test(r.content));
  const hasSocial = hasPeople && hasFood;

  const parts: string[] = [];
  const dateWord = new Date().getHours() < 14 ? '上午' : new Date().getHours() < 18 ? '下午' : '晚上';

  if (kinds.has('灵感') || kinds.has('新知')) parts.push('今天有新东西在脑子里开花');
  if (hasSocial) parts.push({ 2: '和人在一起吃饭，是很实在的快乐' }[2] || '有朋友、有饭');
  if (hasWork && kinds.size === 1) parts.push('认真产出的一天');
  if (facts.length >= 3 && kinds.size >= 2) parts.push('充实的一天');

  if (!parts.length) {
    // 根据当天 receipt 数量来选
    const seed = receipts.map(r => r.id).join('|');
    return hashPick([
      '平凡的一天，值得认真记住。',
      '没什么特别，但这就是生活本身。',
      '不慌不忙地过了一天。',
      '今天就这样，也挺好的。',
      '记住这一天，以后会想起的。',
    ], seed);
  }
  return parts.join(' · ') + ` · ${dateWord}`;
}

/* ═══════════════════════════════════════════════════════════
 * Receipt 生成入口
 * ═══════════════════════════════════════════════════════════ */
export function receiptsFor(diary: DiaryDocument): Receipt[] {
  const result: Receipt[] = diary.facts.events
    .filter(e => e.note.trim() || e.remark.trim() || [...e.people, ...e.places, ...e.activities, ...e.foods].length)
    .map(e => ({
      id: `facts:${e.id}`,
      date: diary.date,
      kind: '事实',
      time: e.time,
      content: e.note || '一次值得留下的记录',
      details: (() => {
        const fieldLabels = ["在哪", "做了什么", "和谁", "吃了什么", "人物", "地点", "活动", "食物", "去哪", "见谁"];
        // 名称包含字段标签词（如"- 在哪：十所"）的视为脏数据，过滤掉
        const isFieldLabel = (name: string) => fieldLabels.some(label => name.includes(label));
        const cleanNames = (items: { name: string }[]) => items.map(i => i.name.trim()).filter(n => n && !isFieldLabel(n));
        const people = cleanNames(e.people);
        const places = cleanNames(e.places);
        const foods = cleanNames(e.foods);
        // 活动中"吃XX"且食物已包含XX的，跳过避免重复
        const activities = cleanNames(e.activities).filter(a => {
          if (/^吃/.test(a)) {
            const foodName = a.replace(/^吃/, "").trim();
            return !foods.some(f => f.includes(foodName) || foodName.includes(f));
          }
          return true;
        });
        return [
          people.length ? `和谁：${people.join('、')}` : '',
          places.length ? `地点：${places.join('、')}` : '',
          ...activities.map(a => a),  // 活动直接显示内容，不加"做了什么"前缀
          foods.length ? `吃了什么：${foods.join('、')}` : '',
          e.remark?.trim() ? `备注：${e.remark.trim()}` : '',
        ].filter(Boolean);
      })(),
      remark: remarkForReceipt('事实', e.note || '', e),
    }));

  const append = (kind: string, content: string, details: string[]) => {
    content.split(/\n\s*\n/).map(x => x.trim()).filter(Boolean).forEach((text, index) => {
      const match = text.match(/^\[((?:[01]\d|2[0-3]):[0-5]\d)\]\s*/);
      const clean = match ? text.slice(match[0].length) : text;
      result.push({
        id: `${kind}:${index}`,
        date: diary.date,
        kind,
        time: match?.[1] || '',
        content: clean,
        details,
        remark: remarkForReceipt(kind, clean),
      });
    });
  };
  if (diary.entries) {
    for (const [key, kind] of [['learn', '新知'], ['input', '输入'], ['idea', '灵感']] as const) for (const e of diary.entries[key]) result.push({ id: `${key}:${e.id}`, date: diary.date, kind, time: e.time, content: e.content, details: [...e.sources.map(s => `来源：${s.name}`), ...e.tags.map(t => `标签：${t}`)], remark: remarkForReceipt(kind, e.content) });
  } else {
    append('新知', diary.learn.content, diary.learn.sources.length ? [`来源：${diary.learn.sources.map(x => x.name).join('、')}`] : []);
    append('输入', diary.input.excerpt, [diary.input.kind, ...diary.input.names.map(x => x.name)].filter(Boolean));
    append('灵感', diary.idea.content, diary.idea.tags.length ? [`标签：${diary.idea.tags.join(' · ')}`] : []);
  }
  // 日记级元信息（天气、睡眠、心情）合并到今日备注小票
  const metaDetails = [
    diary.weather ? `天气：${diary.weather}` : '',
    diary.sleep ? `睡眠：${diary.sleep}` : '',
    diary.mood ? `心情：${diary.mood}` : '',
  ].filter(Boolean);
  append('今日备注', diary.facts.note, metaDetails);
  for (const task of diary.todos || []) result.push({ id: `todo:${task.id}`, date: diary.date, kind: '待办', time: task.time, content: task.title, details: [task.done ? '状态：已完成' : '状态：未完成'], remark: task.done ? '完成一件事，向前一步。' : '写下安排，慢慢完成。' });

  return result.sort((a, b) => (a.time || '99:99').localeCompare(b.time || '99:99'));
}

export function addedReceipts(previous: DiaryDocument, next: DiaryDocument): Receipt[] {
  const ids = new Set(receiptsFor(previous).map(r => r.id));
  return receiptsFor(next).filter(r => !ids.has(r.id));
}

/* ═══════════════════════════════════════════════════════════
 * AI 增强版本（有 AI key 时覆盖本地）
 * 导出为 async 函数，前端调 /api/receipts/remarks
 * ═══════════════════════════════════════════════════════════ */
export async function enrichRemarksWithAi(
  receipts: Receipt[],
  fetchFn: (body: unknown) => Promise<{ remarks: Record<string, string>; daySummary: string }>,
): Promise<Receipt[]> {
  try {
    const result = await fetchFn({
      receipts: receipts.map(r => ({ id: r.id, kind: r.kind, content: r.content, details: r.details })),
      date: receipts[0]?.date,
    });
    for (const r of receipts) {
      const aiRemark = result.remarks[r.id];
      if (aiRemark && aiRemark.trim()) r.remark = aiRemark.trim();
    }
  } catch {
    // AI 挂了就用本地 rule-based，不报错给用户
  }
  return receipts;
}

/* ── Canvas 导出（保留原签名但用新字段） ── */
export async function downloadReceipts(receipts: Receipt[], date: string, daySummary?: string) {
  await document.fonts.ready;
  const canvas = document.createElement('canvas');
  canvas.width = 900;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('浏览器不支持图片导出，请尝试其他浏览器。');
  type Line = { text: string; size: number; bold: boolean };
  const lines: Line[] = [];
  const add = (text: string, size = 26, bold = false) => {
    ctx.font = `${bold ? '700' : '400'} ${size}px "Microsoft YaHei", sans-serif`;
    for (const paragraph of text.split('\n')) {
      let line = '';
      for (const char of paragraph) {
        if (line && ctx.measureText(line + char).width > 772) { lines.push({ text: line, size, bold }); line = ''; }
        line += char;
      }
      lines.push({ text: line, size, bold });
    }
  };
  add('独立日记 · 生活留存凭证', 28, true);
  add(date.replaceAll('-', '.'), 54, true);
  add(`共 ${receipts.length} 张小票 · 本地生成`, 24);
  for (const [index, receipt] of receipts.entries()) {
    add('──────────────────────────', 24);
    add(`${String(index + 1).padStart(2, '0')}  ${receipt.kind}  /  ${receipt.time || '未设时间'}`, 26, true);
    add(receipt.content, 30, true);
    receipt.details.forEach(x => add(x));
    if (receipt.remark) add('「 ' + receipt.remark + ' 」', 22, false);
  }
  add('──────────────────────────', 24);
  add(daySummary || summarizeDay(receipts), 26, true);
  const pages: Line[][] = [[]]; let height = 128;
  for (const line of lines) {
    if (height + line.size * 1.7 > 12000) { pages.push([]); height = 128; }
    pages.at(-1)!.push(line); height += line.size * 1.7;
  }
  for (const [index, page] of pages.entries()) {
    canvas.height = Math.ceil(128 + page.reduce((sum, line) => sum + line.size * 1.7, 0));
    ctx.fillStyle = '#faf9f5'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    let y = 64;
    for (const line of page) {
      ctx.font = `${line.bold ? '700' : '400'} ${line.size}px "Microsoft YaHei", sans-serif`;
      ctx.fillStyle = '#252329'; ctx.textBaseline = 'top'; ctx.fillText(line.text, 64, y); y += line.size * 1.7;
    }
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('图片生成失败，请重试。');
    const url = URL.createObjectURL(blob); const link = document.createElement('a');
    link.href = url; link.download = `独立日记-${date}${pages.length > 1 ? `-${index + 1}` : ''}.png`; link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 10000);
  }
}
