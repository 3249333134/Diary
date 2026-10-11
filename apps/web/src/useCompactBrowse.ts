import { useEffect, useRef, useState, type RefObject } from 'react';

/** Collapse on browsing intent, rather than layout-generated scroll changes. */
export function useCompactBrowse(root: RefObject<HTMLElement | null>, enabled: boolean, workspace: string) {
  const [compact, setCompact] = useState(false);
  const hold = useRef(0);
  const expand = () => { hold.current = performance.now() + 450; setCompact(false); };
  const collapse = () => { setCompact(true); };
  useEffect(() => { hold.current = performance.now() + 450; }, [workspace, enabled]);
  useEffect(() => {
    const element = root.current;
    if (!element || !enabled) return;
    const media = matchMedia('(max-width:899px)');
    let touchY = 0, touchX = 0, startY = 0;
    const region = (target: EventTarget | null) => target instanceof Element && target.closest('.event-stack,.plan-board-scroll,.plan-list-view,.workspace-panel');
    const editing = (target: EventTarget | null) => target instanceof Element && !!target.closest('input,textarea,select,.plan-drag-handle,[role=dialog],dialog');
    const browse = (target: EventTarget | null, delta: number) => {
      // 禁用滑动/滚轮自动触发紧凑模式，仅通过全屏按钮控制
    };
    const wheel = () => {};
    const start = () => {};
    const move = () => {};
    const scroll = () => {
      // 禁用滚动自动触发紧凑模式，仅通过全屏按钮控制
    };
    const resize = () => { if(!media.matches)expand(); };
    element.addEventListener('wheel',wheel,{passive:true});element.addEventListener('touchstart',start,{passive:true});element.addEventListener('touchmove',move,{passive:true});element.addEventListener('scroll',scroll,true);media.addEventListener('change',resize);
    return()=>{element.removeEventListener('wheel',wheel);element.removeEventListener('touchstart',start);element.removeEventListener('touchmove',move);element.removeEventListener('scroll',scroll,true);media.removeEventListener('change',resize);};
  },[enabled,root]);
  return { compact: enabled && compact, expand, collapse };
}
