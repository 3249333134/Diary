import { useEffect, useMemo, useRef, useState, type ReactNode, type PointerEvent } from 'react';
import { GripVertical, Plus,Users } from 'lucide-react';
import { api, type ActionRow } from './api';
import type { PlanCategory,SharedWindow } from '@diary/contracts';
import type { Classification } from './PlanFields';
import { createFrameTask } from './frameTask';
import { GlassSelect } from './GlassSelect';

type DropResult = { windowId: string; insertBefore: HTMLElement | null };

type DragState = {
  row: ActionRow;
  x: number;
  y: number;
  active: boolean;
  pointer: number;
  cardEl: HTMLElement;
  placeholder: HTMLElement;
  startX: number;
  startY: number;
  dropPlaceholder: HTMLElement | null;
  dropWindowId: string | null;
};

type WinDragState = {
  id: string;
  name: string;
  x: number;
  y: number;
  active: boolean;
  pointer: number;
  winEl: HTMLElement;
  placeholder: HTMLElement;
  startX: number;
  startY: number;
};

/**
 * 窗口模式：按计划类别（category）分列展示的看板。
 * - 代办可拖到其他窗口的任意位置，上下卡片自动撑开。
 * - 窗口可通过标题栏拖拽重新排序。
 */
export function PlanWindows({
  rows,
  categories,
  busy,
  render,
  onMove,
  onCreate,
  onAddCategory,
  sharedWindows=[],onAddShared,onManageShared,scopeLabel,onShowAll,
}: {
  rows: ActionRow[];
  categories: PlanCategory[];
  busy: boolean;
  render: (row: ActionRow, handle?: ReactNode) => ReactNode;
  onMove: (row: ActionRow, patch: Classification) => void;
  onCreate: (categoryId: string) => void;
  onAddCategory: () => void;
  sharedWindows?:SharedWindow[];onAddShared?:()=>void;onManageShared?:(window:SharedWindow)=>void;
  scopeLabel?:string;onShowAll?:()=>void;
}) {
  const [dragTarget, setDragTarget] = useState<string>();
  const press = useRef<DragState | undefined>(undefined);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const [winTarget, setWinTarget] = useState<{ id: string; position: 'before' | 'after' }>();
  const winPress = useRef<WinDragState | undefined>(undefined);
  const winTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [draggingWinId, setDraggingWinId] = useState<string>();

  // 窗口顺序保存在服务端，跨设备保持一致
  const [windowOrder, setWindowOrder] = useState<string[]>([]);
  useEffect(() => {
    let alive = true;
    api.planWindowOrder().then(r => { if (alive) setWindowOrder(r.ids); }).catch(() => {});
    return () => { alive = false; };
  }, []);
  const keysRef = useRef<string[]>([]);

  const scroll = useRef<HTMLDivElement>(null);
  const finish = useRef(onMove);
  finish.current = onMove;

  // ── 检测鼠标在哪个窗口的哪个位置 ──
  const findDrop = (x: number, y: number): DropResult | null => {
    const winEl = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-plan-drop]');
    if (!winEl) return null;
    const windowId = winEl.dataset.planDrop;
    if (!windowId?.startsWith('category:')) return null;
    // 找到窗口内的卡片列表
    const list = winEl.querySelector<HTMLElement>('.plan-window-list');
    if (!list) return { windowId, insertBefore: null };
    // 找到鼠标下方的卡片（排除正在拖拽的卡片，它 position:fixed 跟随鼠标，会干扰位置计算）
    const cards = Array.from(list.querySelectorAll<HTMLElement>('li.plan-card:not(.plan-card-dragging)'));
    let insertBefore: HTMLElement | null = null;
    for (const card of cards) {
      const rect = card.getBoundingClientRect();
      if (y < rect.top + rect.height / 2) {
        insertBefore = card;
        break;
      }
    }
    return { windowId, insertBefore };
  };

  // 在目标窗口插入占位符
  const setDropPlaceholder = (p: DragState, drop: DropResult | null) => {
    if (p.dropWindowId === drop?.windowId && p.dropPlaceholder?.parentNode) {
      // 同一窗口，只移动位置
      if (drop) {
        const list = document.querySelector<HTMLElement>(`[data-plan-drop="${drop.windowId}"] .plan-window-list`);
        if (list && p.dropPlaceholder.parentNode !== list) {
          list.insertBefore(p.dropPlaceholder, drop.insertBefore);
        } else if (p.dropPlaceholder.nextSibling !== drop.insertBefore) {
          list?.insertBefore(p.dropPlaceholder, drop.insertBefore);
        }
      }
      return;
    }
    // 移除旧占位符
    p.dropPlaceholder?.remove();
    p.dropPlaceholder = null;
    p.dropWindowId = null;
    if (!drop) return;
    // 创建新占位符
    const list = document.querySelector<HTMLElement>(`[data-plan-drop="${drop.windowId}"] .plan-window-list`);
    if (!list) return;
    const ph = document.createElement('li');
    ph.className = 'plan-card-placeholder';
    ph.style.height = `${p.cardEl.offsetHeight}px`;
    list.insertBefore(ph, drop.insertBefore);
    // 触发展开动画
    requestAnimationFrame(() => ph.classList.add('show'));
    p.dropPlaceholder = ph;
    p.dropWindowId = drop.windowId;
  };

  // ── 代办拖拽逻辑 ──
  useEffect(() => {
    const motion = createFrameTask(() => {
      const p = press.current; if (!p?.active) return;
      const drop = findDrop(p.x, p.y);
      p.cardEl.style.transform = `translate3d(${p.x-p.startX}px,${p.y-p.startY}px,0)`;
      setDropPlaceholder(p, drop);
      setDragTarget(drop?.windowId);
    });
    const move = (e: globalThis.PointerEvent) => {
      const p = press.current;
      if (!p || p.pointer !== e.pointerId) return;
      if (!p.active) {
        if (Math.hypot(e.clientX - p.x, e.clientY - p.y) > 8) {
          clearTimeout(timer.current);
          cleanupDrag(p);
          press.current = undefined;
        }
        return;
      }
      e.preventDefault();
      p.x = e.clientX;
      p.y = e.clientY;
      motion.schedule();
    };

    const end = (e: globalThis.PointerEvent) => {
      const p = press.current;
      if (!p || p.pointer !== e.pointerId) return;
      motion.cancel();
      clearTimeout(timer.current);
      const wasActive = p.active;
      const row = p.row;
      const drop = wasActive ? findDrop(e.clientX, e.clientY) : null;
      // 恢复 DOM
      p.dropPlaceholder?.remove();
      cleanupDrag(p);
      press.current = undefined;
      setDragTarget(undefined);
      if (!wasActive || e.type === 'pointercancel') return;
      if (drop?.windowId.startsWith('category:')) {
        const catId = drop.windowId.slice(9);
        finish.current(row, { category: catId === '__unclassified__' ? null : catId });
      }
    };

    const cancel = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && press.current) {
        motion.cancel();
        clearTimeout(timer.current);
        press.current.dropPlaceholder?.remove();
        cleanupDrag(press.current);
        press.current = undefined;
        setDragTarget(undefined);
      }
    };

    document.addEventListener('pointermove', move, { passive: false });
    document.addEventListener('pointerup', end);
    document.addEventListener('pointercancel', end);
    document.addEventListener('keydown', cancel);
    return () => {
      motion.cancel();
      if (press.current) { press.current.dropPlaceholder?.remove(); cleanupDrag(press.current); press.current = undefined; }
      clearTimeout(timer.current);
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', end);
      document.removeEventListener('pointercancel', end);
      document.removeEventListener('keydown', cancel);
    };
  }, []);

  // ── 窗口排序拖拽逻辑 ──
  useEffect(() => {
    const findWindow = (x: number, y: number): { id: string; position: 'before' | 'after' } | null => {
      const el = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-window-id]');
      if (!el) return null;
      const id = el.dataset.windowId;
      if (!id) return null;
      const rect = el.getBoundingClientRect();
      const position: 'before' | 'after' = x < rect.left + rect.width / 2 ? 'before' : 'after';
      return { id, position };
    };
    const motion = createFrameTask(() => {
      const p = winPress.current; if (!p?.active) return;
      const hit = findWindow(p.x, p.y);
      p.winEl.style.transform = `translate3d(${p.x-p.startX}px,${p.y-p.startY}px,0)`;
      setWinTarget(old => old?.id === hit?.id && old?.position === hit?.position ? old : hit ?? undefined);
    });

    const move = (e: globalThis.PointerEvent) => {
      const p = winPress.current;
      if (!p || p.pointer !== e.pointerId) return;
      if (!p.active) {
        if (Math.hypot(e.clientX - p.x, e.clientY - p.y) > 8) {
          clearTimeout(winTimer.current);
          cleanupWinDrag(p);
          winPress.current = undefined;
          setDraggingWinId(undefined);
        }
        return;
      }
      e.preventDefault();
      p.x = e.clientX;
      p.y = e.clientY;
      motion.schedule();
    };

    const end = (e: globalThis.PointerEvent) => {
      const p = winPress.current;
      if (!p || p.pointer !== e.pointerId) return;
      motion.cancel();
      clearTimeout(winTimer.current);
      const wasActive = p.active;
      const draggedId = p.id;
      const hit = wasActive ? findWindow(e.clientX, e.clientY) : null;
      cleanupWinDrag(p);
      winPress.current = undefined;
      setWinTarget(undefined);
      setDraggingWinId(undefined);
      if (!wasActive || e.type === 'pointercancel') return;
      if (hit && hit.id !== draggedId) {
        const keys = keysRef.current.filter((id) => id !== draggedId);
        const insertIdx = keys.indexOf(hit.id);
        if (insertIdx >= 0) {
          keys.splice(hit.position === 'before' ? insertIdx : insertIdx + 1, 0, draggedId);
          setWindowOrder(keys);
          void api.savePlanWindowOrder(keys).then(r => setWindowOrder(r.ids)).catch(() => {});
        }
      }
    };

    const cancel = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && winPress.current) {
        motion.cancel();
        clearTimeout(winTimer.current);
        cleanupWinDrag(winPress.current);
        winPress.current = undefined;
        setWinTarget(undefined);
        setDraggingWinId(undefined);
      }
    };

    document.addEventListener('pointermove', move, { passive: false });
    document.addEventListener('pointerup', end);
    document.addEventListener('pointercancel', end);
    document.addEventListener('keydown', cancel);
    return () => {
      motion.cancel();
      if (winPress.current) { cleanupWinDrag(winPress.current); winPress.current = undefined; }
      clearTimeout(winTimer.current);
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', end);
      document.removeEventListener('pointercancel', end);
      document.removeEventListener('keydown', cancel);
    };
  }, []);

  // 拖动激活后阻止页面滚动，未激活时横向滑动仍用于切换窗口
  useEffect(() => {
    const block = (e: globalThis.TouchEvent) => {
      if (press.current?.active || winPress.current?.active) e.preventDefault();
    };
    document.addEventListener('touchmove', block, { passive: false });
    return () => document.removeEventListener('touchmove', block);
  }, []);

  // 自动横向 + 纵向滚动
  useEffect(() => {
    if (!dragTarget && !winTarget) return;
    let frame = 0;
    const auto = () => {
      const p = press.current || winPress.current;
      const el = scroll.current;
      if (p?.active && el) {
        const r = el.getBoundingClientRect();
        const px = p.x;
        const speedX = px < r.left + 60 ? -14 : px > r.right - 60 ? 14 : 0;
        if (speedX) el.scrollLeft += speedX;
      }
      // 窗口内纵向滚动
      if (press.current?.active) {
        const list = document.querySelector<HTMLElement>(`[data-plan-drop="${press.current.dropWindowId}"] .plan-window-list`);
        if (list) {
          const r = list.getBoundingClientRect();
          const py = press.current.y;
          const speedY = py < r.top + 40 ? -10 : py > r.bottom - 40 ? 10 : 0;
          if (speedY) list.scrollTop += speedY;
        }
      }
      frame = requestAnimationFrame(auto);
    };
    frame = requestAnimationFrame(auto);
    return () => cancelAnimationFrame(frame);
  }, [!!dragTarget, !!winTarget]);

  const begin = (e: PointerEvent<HTMLButtonElement>, row: ActionRow) => {
    if (busy || row.task.deletedAt || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    const cardEl = e.currentTarget.closest('li.plan-card') as HTMLElement | null;
    if (!cardEl) return;
    const rect = cardEl.getBoundingClientRect();
    // 原位置占位符
    const placeholder = document.createElement('li');
    placeholder.style.height = `${rect.height}px`;
    placeholder.className = 'plan-card-placeholder';
    cardEl.parentNode?.insertBefore(placeholder, cardEl);
    // 卡片脱离文档流
    cardEl.classList.add('plan-card-dragging');
    cardEl.style.position = 'fixed';
    cardEl.style.left = `${rect.left}px`;
    cardEl.style.top = `${rect.top}px`;
    cardEl.style.width = `${rect.width}px`;
    cardEl.style.zIndex = '1000';
    cardEl.style.pointerEvents = 'none';

    const p: DragState = {
      row,
      x: e.clientX,
      y: e.clientY,
      active: false,
      pointer: e.pointerId,
      cardEl,
      placeholder,
      startX: e.clientX,
      startY: e.clientY,
      dropPlaceholder: null,
      dropWindowId: null,
    };
    press.current = p;
    const activate = () => {
      if (press.current === p) p.active = true;
    };
    if (e.pointerType === 'touch') timer.current = setTimeout(activate, 350);
    else activate();
  };

  const beginWindow = (e: PointerEvent<HTMLElement>, id: string, name: string) => {
    if (busy || e.button !== 0) return;
    // 标题栏内的按钮（如共享窗口的成员入口）保持原有点击行为
    if ((e.target as HTMLElement).closest('button')) return;
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    const winEl = e.currentTarget.closest('.plan-window') as HTMLElement | null;
    if (!winEl) return;
    const rect = winEl.getBoundingClientRect();
    const placeholder = document.createElement('div');
    placeholder.style.width = `${rect.width}px`;
    placeholder.style.minWidth = `${rect.width}px`;
    placeholder.style.flex = `0 0 ${rect.width}px`;
    placeholder.className = 'plan-window-placeholder';
    winEl.parentNode?.insertBefore(placeholder, winEl);
    winEl.classList.add('plan-window-dragging');
    winEl.style.position = 'fixed';
    winEl.style.left = `${rect.left}px`;
    winEl.style.top = `${rect.top}px`;
    winEl.style.width = `${rect.width}px`;
    winEl.style.zIndex = '1000';
    winEl.style.pointerEvents = 'none';

    const p: WinDragState = {
      id,
      name,
      x: e.clientX,
      y: e.clientY,
      active: false,
      pointer: e.pointerId,
      winEl,
      placeholder,
      startX: e.clientX,
      startY: e.clientY,
    };
    winPress.current = p;
    setDraggingWinId(id);
    const activate = () => {
      if (winPress.current === p) p.active = true;
    };
    if (e.pointerType === 'touch') winTimer.current = setTimeout(activate, 350);
    else activate();
  };

  // 构建窗口列表：私人类别在前、待分类固定最后，再套用用户保存的窗口顺序
  const windows = useMemo(() => {
    const base: { id: string; name: string; color: string; items: ActionRow[];shared?:SharedWindow }[] = [
      ...categories.map((c) => ({
        id: c.id,
        name: c.name,
        color: c.color,
        items: rows.filter((r) => !r.windowId&&r.task.category === c.id),
      })),
      ...(categories.length||rows.some(r=>!r.windowId)?[{
        id: '__unclassified__',
        name: '待分类',
        color: '#9296a3',
        items: rows.filter((r) => !r.windowId&&!r.task.category),
      }]:[]),
      ...sharedWindows.map(w=>({id:'shared:'+w.id,name:w.name,color:w.color,items:rows.filter(r=>r.windowId===w.id),shared:w})),
    ];
    const rank = new Map(windowOrder.map((key, i) => [key, i]));
    return base.sort((a, b) => {
      if (a.id === '__unclassified__') return 1;
      if (b.id === '__unclassified__') return -1;
      const ra = rank.get(a.id), rb = rank.get(b.id);
      if (ra === undefined && rb === undefined) return 0;
      if (ra === undefined) return 1;
      if (rb === undefined) return -1;
      return ra - rb;
    });
  }, [categories, rows, sharedWindows, windowOrder]);
  keysRef.current = windows.filter(w => w.id !== '__unclassified__').map(w => w.id);

  const jumpTo=(id:string)=>{
    const area=scroll.current,target=Array.from(area?.querySelectorAll<HTMLElement>('.plan-window')||[]).find(el=>el.dataset.windowKey===id);
    if(area&&target)area.scrollTo({left:area.scrollLeft+target.getBoundingClientRect().left-area.getBoundingClientRect().left,behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});
  };

  return (
    <div className="plan-windows">
      <div className="plan-windows-controls">{scopeLabel?<div className="plan-window-scope"><span title={scopeLabel}>仅显示：{scopeLabel}</span><button type="button" onClick={onShowAll} disabled={busy}>显示全部窗口</button></div>:<nav className="plan-window-jumps" aria-label="快速定位窗口">{windows.map(w=><button key={w.id} type="button" title={w.name} aria-label={`定位${w.name}窗口`} onClick={()=>jumpTo(w.id)}><i style={{background:w.color}}/><span>{w.name}</span><small>{w.items.length}</small></button>)}</nav>}<div className="plan-window-create"><GlassSelect action label="添加窗口" placeholder="添加窗口" disabled={busy} value="" options={[{value:'private',label:'私人窗口',group:'窗口类型'},{value:'shared',label:'共享窗口',group:'窗口类型',disabled:!onAddShared}]} onChange={kind=>kind==='shared'?onAddShared?.():onAddCategory()}/></div></div>
      <div ref={scroll} className="plan-windows-scroll" role="region" aria-label="窗口模式看板">
      <div className="plan-windows-track">
        {windows.map((w) => {
          const isUnclassified = w.id === '__unclassified__';
          const isWinDropBefore = winTarget?.id === w.id && winTarget.position === 'before' && draggingWinId !== w.id;
          const isWinDropAfter = winTarget?.id === w.id && winTarget.position === 'after' && draggingWinId !== w.id;
          return (
            <section
              key={w.id}
              data-window-key={w.id}
              className={`plan-window${dragTarget === `category:${w.id}` ? ' drop-active' : ''}${isWinDropBefore ? ' drop-target-before' : ''}${isWinDropAfter ? ' drop-target-after' : ''}`}
              data-plan-drop={w.shared?undefined:`category:${w.id}`}
              data-window-id={isUnclassified ? undefined : w.id}
              aria-label={`${w.name} 窗口，共 ${w.items.length} 项`}
            >
              <header
                className="plan-window-header"
                style={{ borderTopColor: w.color, background: `color-mix(in srgb, ${w.color} 12%, transparent)` }}
                onPointerDown={isUnclassified ? undefined : (e) => beginWindow(e, w.id, w.name)}
                role={isUnclassified ? undefined : 'button'}
                aria-label={isUnclassified ? undefined : `拖动排序：${w.name}`}
              >
                {!isUnclassified && <GripVertical size={16} className="plan-window-reorder-handle" />}
                <span className="plan-window-dot" style={{ background: w.color }} />
                <h3 className="plan-window-name">{w.name}</h3>
                <span className="plan-window-count">
                  {w.items.length} 项
                </span>
                {w.shared&&<button className="quiet-button" aria-label={`${w.name}成员管理`} onClick={()=>onManageShared?.(w.shared!)}><Users size={15}/>{w.shared.members.filter(m=>m.status==='active').length}</button>}
              </header>
              <ul className="todo-list plan-window-list">
                {w.items.map((row) =>
                  render(
                    row,
                    w.shared?undefined:<button
                      className="plan-drag-handle"
                      disabled={busy || !!row.task.deletedAt}
                      aria-label={`拖动到其他窗口：${row.task.title}`}
                      onPointerDown={(e) => begin(e, row)}
                    >
                      <GripVertical size={18} />
                    </button>
                  )
                )}
                {w.items.length === 0 && <li className="plan-window-empty">暂无代办，拖入或添加</li>}
              </ul>
              <button
                className="plan-window-add"
                disabled={busy||w.shared?.role==='viewer'}
                onClick={() => onCreate(isUnclassified ? '' : w.id)}
              >
                <Plus size={16} />添加待办
              </button>
            </section>
          );
        })}
      </div>
      </div>
    </div>
  );
}

function cleanupDrag(p: DragState) {
  const { cardEl, placeholder } = p;
  cardEl.classList.remove('plan-card-dragging');
  cardEl.style.position = '';
  cardEl.style.left = '';
  cardEl.style.top = '';
  cardEl.style.width = '';
  cardEl.style.zIndex = '';
  cardEl.style.pointerEvents = '';
  cardEl.style.transform = '';
  placeholder.remove();
}

function cleanupWinDrag(p: WinDragState) {
  const { winEl, placeholder } = p;
  winEl.classList.remove('plan-window-dragging');
  winEl.style.position = '';
  winEl.style.left = '';
  winEl.style.top = '';
  winEl.style.width = '';
  winEl.style.zIndex = '';
  winEl.style.pointerEvents = '';
  winEl.style.transform = '';
  placeholder.remove();
}
