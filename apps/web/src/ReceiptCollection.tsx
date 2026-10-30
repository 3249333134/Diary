import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Download, Printer, RotateCcw, X } from 'lucide-react';
import type { DiaryDocument } from '@diary/contracts';
import { downloadReceipts, receiptsFor, summarizeDay, type Receipt } from './receipts';
import './receipts.css';

/* ── 皮肤定义 ── */
type Skin = 'classic' | 'kraft' | 'clean' | 'pink';
const SKINS: { id: Skin; name: string; swatch: [string, string] }[] = [
  { id: 'classic', name: '经典米白', swatch: ['#faf6ee', '#c9c2b2'] },
  { id: 'kraft',   name: '复古牛皮', swatch: ['#e6dcc4', '#8f8165'] },
  { id: 'clean',   name: '现代纯白', swatch: ['#ffffff', '#7a7a82'] },
  { id: 'pink',    name: '粉色少女', swatch: ['#fff5f7', '#d4386a'] },
];
const SKIN_STORAGE_KEY = 'diary.receipt-skin';

const KIND_LABEL: Record<string, string> = {
  '事实': '事实', '新知': '新知', '输入': '输入', '灵感': '灵感', '今日备注': '备注', '待办': '待办', '日程': '日程',
};

/* ── 带吐纸动画的单张纸 wrapper ── */
function PaperWrapper({
  receipt, index, total, replayKey, duration,
}: { receipt: Receipt; index: number; total: number; replayKey: number; duration: number }) {
  const innerRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(0);
  const [mountedKey, setMountedKey] = useState(-1);

  // 测量真实高度（包含撕齿和下载按钮的整块）
  useLayoutEffect(() => {
    if (!innerRef.current) return;
    // 用 requestAnimationFrame 确保布局完成后再测
    const raf = requestAnimationFrame(() => {
      const el = innerRef.current;
      if (el) {
        // 测整个 item 的高度（含 padding-bottom 和下载按钮）
        const item = el.parentElement;
        if (item) setHeight(item.getBoundingClientRect().height + 2); // +2 给撕齿下边留缝隙
        else setHeight(el.getBoundingClientRect().height + 30);
      }
    });
    return () => cancelAnimationFrame(raf);
  }, [receipt.id, replayKey]);

  // replayKey 变化时，重新挂载 wrapper 触发动画
  useEffect(() => {
    // 先卸载（key 变化触发）
    setMountedKey(replayKey * 1000 + index);
  }, [replayKey, index]);

  const tilt = receipt.kind === '事实' ? '-0.4deg'
              : receipt.kind === '新知' ? '0.3deg'
              : receipt.kind === '输入' ? '-0.2deg'
              : receipt.kind === '灵感' ? '0.5deg'
              : '0deg';

  return (
    <div
      key={`${receipt.id}:${mountedKey}`}
      className="receipt-wrapper is-exiting"
      style={{
        ...(height > 0 ? { '--paper-height': `${height}px` } : {}),
        '--feed-delay': `${index * 160}ms`,
        '--feed-duration': `${duration}ms`,
        '--paper-tilt': tilt,
      } as React.CSSProperties}
    >
      <div className="receipt-item">
        <div
          ref={innerRef}
          className="receipt-paper-inner"
        >
          <article className="receipt-paper" data-kind={receipt.kind}>
            <header>
              <span>独立日记 · {KIND_LABEL[receipt.kind] || receipt.kind}</span>
              <span className="receipt-number">NO. {String(index + 1).padStart(3, '0')} / {String(total).padStart(3, '0')}</span>
            </header>
            <div className="receipt-date">
              <span>{receipt.date.replaceAll('-', '.')}</span>
              <span>{receipt.time || '未设时间'}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 4 }}>
              <span className="receipt-kind-stamp">{KIND_LABEL[receipt.kind] || receipt.kind}</span>
            </div>
            <p className="receipt-content">{receipt.content}</p>
            {receipt.details.length > 0 && (
              <div className="receipt-details">
                {receipt.details.map((text, i) => <p key={i}>{text}</p>)}
              </div>
            )}
            <footer>
              <span>{receipt.remark}</span>
              <span>{KIND_LABEL[receipt.kind] || receipt.kind}</span>
            </footer>
          </article>
        </div>
        {/* 下载按钮（放在 receipt-item 内部，所以测高度时包含） */}
        <button
          className="receipt-download"
          data-download-only
          aria-label={`保存第 ${index + 1} 张小票图片`}
        >
          <Download size={16} />保存这张
        </button>
      </div>
    </div>
  );
}

/* ── 皮肤选择器 — 常显色块组 ── */
function SkinSwitch({ value, onChange }: { value: Skin; onChange: (s: Skin) => void }) {
  return (
    <div className="receipt-skin-switch" role="radiogroup" aria-label="小票样式">
      <span className="skin-label">样式</span>
      {SKINS.map(s => (
        <button
          key={s.id}
          className={`skin-swatch${value === s.id ? ' active' : ''}`}
          role="radio"
          aria-checked={value === s.id}
          aria-label={`切换到 ${s.name}`}
          title={s.name}
          onClick={() => onChange(s.id)}
          style={{
            background: `linear-gradient(135deg, ${s.swatch[0]} 50%, ${s.swatch[1]} 50%)`,
          }}
        />
      ))}
    </div>
  );
}

/** 收集面板。传 receipts 时渲染外部聚合的小票夹，否则渲染单日日记小票 */
export function ReceiptCollection({ diary, saved, onClose, onWrite, receipts: given, heading = '每日小票', days, day, onDay, total }: { diary: DiaryDocument; saved: boolean; onClose: () => void; onWrite: () => void; receipts?: Receipt[]; heading?: string; days?: string[]; day?: string; onDay?: (day: string) => void; total?: number }) {
  const receipts = given ?? receiptsFor(diary);
  const vault = !!given;
  // 小票夹按日期翻页：days 从新到旧排列
  const dayIndex = days && day ? days.indexOf(day) : -1;
  const stepDay = (delta: number) => {
    if (!days || dayIndex < 0 || !onDay) return;
    const next = days[dayIndex + delta];
    if (next) onDay(next);
  };
  const swipe = useRef<{ x: number; y: number } | null>(null);
  const [replayKey, setReplayKey] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');
  const [isPrinting, setIsPrinting] = useState(false);
  const [skin, setSkin] = useState<Skin>(() => {
    const stored = typeof localStorage !== 'undefined' ? localStorage.getItem(SKIN_STORAGE_KEY) as Skin | null : null;
    return SKINS.some(s => s.id === stored) ? stored! : 'classic';
  });

  // 切换皮肤时，设置 data-skin 属性到容器
  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute('data-skin', skin);
    if (typeof localStorage !== 'undefined') localStorage.setItem(SKIN_STORAGE_KEY, skin);
  }, [skin]);

  const exportImage = async (items: Receipt[]) => {
    setExporting(true); setError('');
    try { await downloadReceipts(items, receipts[0]?.date || diary.date); }
    catch (e) { setError(e instanceof Error ? e.message : '导出失败，请重试。'); }
    finally { setExporting(false); }
  };

  const triggerReplay = () => {
    setIsPrinting(true);
    setReplayKey(k => k + 1);
    // 等待最后一张纸完成入场动画
    const lastDelay = receipts.length * 160; // 每张 160ms 间隔
    const animDuration = 1400;
    window.setTimeout(() => setIsPrinting(false), lastDelay + animDuration + 200);
  };

  // 将点击事件委托给真正的 download 按钮（因为 wrapper 包住了 receipt-item）
  const feedRef = useRef<HTMLDivElement>(null);
  const handleFeedClick = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    const btn = target.closest('[data-download-only]') as HTMLButtonElement | null;
    if (btn) {
      const paperEl = btn.closest('.receipt-item');
      if (!paperEl) return;
      const wrapper = paperEl.closest('.receipt-wrapper');
      const itemIndex = wrapper
        ? Array.from(wrapper.parentElement?.querySelectorAll('.receipt-wrapper') || []).indexOf(wrapper as Element)
        : -1;
      if (itemIndex >= 0) {
        void exportImage([receipts[itemIndex]]);
      }
    }
  };

  const feedTotalDuration = receipts.length * 160 + 1400;

  return (
    <section
      className="receipt-collection"
      aria-labelledby="receipt-heading"
      data-skin={skin}
      onTouchStart={e => { const touch = e.touches[0]; swipe.current = { x: touch.clientX, y: touch.clientY }; }}
      onTouchEnd={e => {
        const start = swipe.current; swipe.current = null;
        if (!start) return;
        const touch = e.changedTouches[0];
        const dx = touch.clientX - start.x, dy = touch.clientY - start.y;
        if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
        // 左滑看更早一天，右滑看更新一天
        stepDay(dx < 0 ? 1 : -1);
      }}
    >
      <div className="receipt-collection-heading">
        <div>
          <h2 id="receipt-heading">{heading}</h2>
          <p>{vault
            ? (days && day ? `${day.replaceAll('-', '.')} · ${receipts.length} 张 / 共 ${total ?? receipts.length} 张` : `全部日期 · ${receipts.length} 张`)
            : `${diary.date} · ${receipts.length} 张${!saved ? ' · 未保存预览' : ' · 已随日记收藏'}`}</p>
        </div>
        <button className="quiet-button" onClick={onClose}><X size={18} />返回记录</button>
      </div>

      {days && day && (
        <div className="receipt-day-nav" role="group" aria-label="切换小票日期">
          <button className="quiet-button" type="button" onClick={() => stepDay(-1)} disabled={dayIndex <= 0} aria-label="更新一天">
            <ChevronLeft size={18} />
          </button>
          <div>
            <strong>{day.replaceAll('-', '.')}</strong>
            <span>{dayIndex + 1} / {days.length} 天 · 左右滑动切换</span>
          </div>
          <button className="quiet-button" type="button" onClick={() => stepDay(1)} disabled={dayIndex >= days.length - 1} aria-label="更早一天">
            <ChevronRight size={18} />
          </button>
        </div>
      )}

      <div className="receipt-controls">
        <button className="quiet-button" disabled={!receipts.length || exporting || (!vault && !saved)}
          onClick={() => void exportImage(receipts)}>
          <Download size={18} />{exporting ? '正在生成图片' : '导出长图'}
        </button>
        <button className="quiet-button" disabled={!receipts.length} onClick={triggerReplay}>
          <RotateCcw size={18} />重播出纸
        </button>
        {/* 皮肤切换 — 放在 controls 右侧 */}
        <SkinSwitch value={skin} onChange={setSkin} />
      </div>

      {error && <p role="alert">{error}</p>}

      <div className={`receipt-printer${isPrinting ? ' is-printing' : ''}`}>
        <Printer size={22} />
        <strong>独立日记</strong>
        <span><i />{vault ? '小票夹收藏' : saved ? '今日已归档' : '等待写入'}</span>
        <div className="receipt-slot" />
      </div>

      {!receipts.length ? (
        <div className="receipt-empty">
          <Printer size={32} />
          <h3>{vault ? '小票夹还是空的' : '这一天的纸还是空白的'}</h3>
          <p>{vault ? '完成一件日程或保存一条记录，小票就会收进这里。' : '写下并保存一条记录，小票就会从这里打印出来。'}</p>
          <button className="quiet-button" onClick={onWrite}>{vault ? '去完成一件日程' : '去写一条'}</button>
        </div>
      ) : (
        <div className="receipt-roll" key={`${vault ? `vault:${day || ''}` : diary.date}:${replayKey}`}>
          <div
            ref={feedRef}
            className="receipt-feed"
            onClick={handleFeedClick}
          >
            {/* 日期标题栏 — 不动画，稳定显示 */}
            <div className="receipt-day-heading">
              <strong>{vault ? (day ? day.replaceAll('-', '.') : '我的小票夹') : diary.date.replaceAll('-', '.')}</strong>
              <span>生活留存凭证 · 共 {receipts.length} 张</span>
            </div>
            {/* 逐张吐纸 — replayKey 变化会重新挂载所有 wrapper */}
            {receipts.map((receipt, index) => (
              <PaperWrapper
                key={receipt.id}
                receipt={receipt}
                index={index}
                total={receipts.length}
                replayKey={replayKey}
                duration={1400}
              />
            ))}
            {/* 纸尾 — 根据当天内容动态总结 */}
            <div className="receipt-day-end">
              {summarizeDay(receipts) || '记住平凡的一天。'}
              <small>于本机生成 · 独立日记</small>
            </div>
          </div>
        </div>
      )}

      <p className="receipt-explanation">
        每天的小票跟着日期收在一起。修改或删除记录，小票同步更新；图片只在本地生成。
        {feedTotalDuration > 0 && false}
      </p>
    </section>
  );
}

/** 右下角新小票出纸通知 */
export function ReceiptNotice({ receipts, onOpen, onClose }: { receipts: Receipt[]; onOpen: () => void; onClose: () => void }) {
  const [bottom,setBottom]=useState(16),close=useRef(onClose);close.current=onClose;
  // 已完成日程的小票属于小票夹，不在某一天的日记里
  const vaulted = receipts[0]?.kind === '日程';
  useEffect(() => {
    const timer = window.setTimeout(()=>close.current(), 6500);
    return () => window.clearTimeout(timer);
  }, [receipts]);
  useEffect(()=>{
    const footer=document.querySelector('.workspace-footer');
    const update=()=>{if(footer){const box=footer.getBoundingClientRect();setBottom(box.height?Math.max(16,window.innerHeight-box.top+8):16);}};
    const observer=new ResizeObserver(update);if(footer)observer.observe(footer);update();
    window.addEventListener('resize',update);window.visualViewport?.addEventListener('resize',update);window.visualViewport?.addEventListener('scroll',update);
    return()=>{observer.disconnect();window.removeEventListener('resize',update);window.visualViewport?.removeEventListener('resize',update);window.visualViewport?.removeEventListener('scroll',update);};
  },[]);

  return (
    <aside className="receipt-notice" style={{bottom}} aria-label="新小票已生成">
      <div className="receipt-printer is-printing">
        <Printer size={18} />
        <strong>打印完成 · {receipts.length} 张</strong>
        <button onClick={onClose} aria-label="关闭小票提示"><X size={18} /></button>
        <div className="receipt-slot" />
      </div>
      <div className="receipt-notice-clip">
        <button className="receipt-notice-paper" onClick={onOpen} aria-label={vaulted ? '打开小票夹' : '查看今日小票'}>
          <span role="status">{vaulted ? '已完成 · 已收进小票夹' : `已写入 · 已收进 ${receipts[0].date} 的小票`}</span>
          <strong>{receipts[0].content}</strong>
          <span>{vaulted ? '打开小票夹 →' : '查看今日小票 →'}</span>
        </button>
      </div>
    </aside>
  );
}
