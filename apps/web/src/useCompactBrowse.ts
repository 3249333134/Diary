import { useEffect, useRef, useState, type RefObject } from 'react';

/** Collapse on browsing intent, rather than layout-generated scroll changes. */
export function useCompactBrowse(root: RefObject<HTMLElement | null>, enabled: boolean, workspace: string) {
  const [compact, setCompact] = useState(false);
  const hold = useRef(0);
  const expand = () => { hold.current = performance.now() + 450; setCompact(false); };
  useEffect(() => { hold.current = performance.now() + 450; }, [workspace, enabled]);
  useEffect(() => {
    const element = root.current;
    if (!element || !enabled) return;
    const media = matchMedia('(max-width:899px)');
    let touchY = 0, touchX = 0, startY = 0;
    const region = (target: EventTarget | null) => target instanceof Element && target.closest('.event-stack,.plan-board-scroll,.plan-list-view,.workspace-panel');
    const editing = (target: EventTarget | null) => target instanceof Element && !!target.closest('input,textarea,select,.plan-drag-handle,[role=dialog],dialog');
    const browse = (target: EventTarget | null, delta: number) => {
      if (!media.matches || !region(target) || editing(target) || editing(document.activeElement)) return;
      if (delta > 16) setCompact(true);
      // Only restore at the beginning with an explicit upward gesture. This avoids
      // bouncing when the larger viewport itself clamps a short list's scrollTop.
      if (delta < -24 && (region(target) as HTMLElement).scrollTop < 8) expand();
    };
    const wheel = (event: WheelEvent) => browse(event.target, event.deltaY);
    const start = (event: TouchEvent) => { if(event.touches.length===1){touchY=startY=event.touches[0].clientY;touchX=event.touches[0].clientX;} };
    const move = (event: TouchEvent) => {
      if(event.touches.length!==1)return;
      const point=event.touches[0];
      if(Math.abs(point.clientX-touchX)>Math.abs(point.clientY-startY))return;
      browse(event.target,touchY-point.clientY);if(Math.abs(touchY-point.clientY)>24)touchY=point.clientY;
    };
    const scroll = (event: Event) => {
      const target=event.target;
      if(media.matches && performance.now()>hold.current && target instanceof HTMLElement && target.matches('.event-stack,.plan-board-scroll,.plan-list-view,.workspace-panel') && target.scrollTop>32 && !editing(document.activeElement))setCompact(true);
    };
    const resize = () => { if(!media.matches)expand(); };
    element.addEventListener('wheel',wheel,{passive:true});element.addEventListener('touchstart',start,{passive:true});element.addEventListener('touchmove',move,{passive:true});element.addEventListener('scroll',scroll,true);media.addEventListener('change',resize);
    return()=>{element.removeEventListener('wheel',wheel);element.removeEventListener('touchstart',start);element.removeEventListener('touchmove',move);element.removeEventListener('scroll',scroll,true);media.removeEventListener('change',resize);};
  },[enabled,root]);
  return { compact: enabled && compact, expand };
}
