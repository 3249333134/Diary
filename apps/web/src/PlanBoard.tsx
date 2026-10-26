import { useEffect, useRef, useState, type ReactNode, type PointerEvent } from 'react';
import { GripVertical } from 'lucide-react';
import type { ActionRow } from './api';
import { urgencyStyle } from './planUrgency';
import type { CSSProperties } from 'react';
import { QUADRANTS, quadrant, type Classification } from './PlanFields';
import { createFrameTask } from './frameTask';
import { SharedPlanBadge } from './SharedPlanBadge';

export function PlanBoard({ rows, busy, render, onMove }: { rows: ActionRow[]; busy: boolean; render: (row: ActionRow, handle?: ReactNode) => ReactNode; onMove: (row: ActionRow, patch: Classification) => void }) {
  const [drag, setDrag] = useState<{ title: string; x: number; y: number; target?: string; style: CSSProperties }>();
  const press = useRef<{ row: ActionRow; x: number; y: number; active: boolean; pointer: number } | undefined>(undefined);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined), scroll = useRef<HTMLDivElement>(null);
  const ghost = useRef<HTMLDivElement>(null);
  const finish = useRef(onMove); finish.current = onMove;
  useEffect(() => {
    const target = (x: number, y: number) => document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-plan-drop]')?.dataset.planDrop;
    const motion = createFrameTask(() => {
      const p = press.current; if (!p?.active) return;
      const hit = target(p.x,p.y);
      if (ghost.current) ghost.current.style.transform = `translate3d(${p.x+12}px,${p.y+12}px,0)`;
      setDrag(old => old && old.target !== hit ? {...old,target:hit} : old);
    });
    const move = (e: globalThis.PointerEvent) => {
      const p = press.current; if (!p || p.pointer !== e.pointerId) return;
      if (!p.active) { if (Math.hypot(e.clientX-p.x,e.clientY-p.y)>8) { clearTimeout(timer.current); press.current = undefined; } return; }
      e.preventDefault(); p.x=e.clientX;p.y=e.clientY;
      motion.schedule();
    };
    const end = (e: globalThis.PointerEvent) => {
      const p = press.current; if (!p || p.pointer !== e.pointerId) return;
      motion.cancel();
      clearTimeout(timer.current); press.current=undefined; setDrag(undefined);
      if (!p.active || e.type==='pointercancel') return;
      const hit=target(e.clientX,e.clientY), q=QUADRANTS.find(q=>q.id===hit);
      if (q) finish.current(p.row,{important:q.important,urgent:q.urgent});
      else if (hit?.startsWith('category:')) finish.current(p.row,{category:hit.slice(9)});
    };
    const cancel=(e:KeyboardEvent)=>{if(e.key==='Escape'){motion.cancel();clearTimeout(timer.current);press.current=undefined;setDrag(undefined);}};
    document.addEventListener('pointermove',move,{passive:false});document.addEventListener('pointerup',end);document.addEventListener('pointercancel',end);document.addEventListener('keydown',cancel);
    return()=>{motion.cancel();press.current=undefined;clearTimeout(timer.current);document.removeEventListener('pointermove',move);document.removeEventListener('pointerup',end);document.removeEventListener('pointercancel',end);document.removeEventListener('keydown',cancel);};
  },[]);
  useEffect(() => {
    if (!drag) return;
    let frame=0;
    const auto=()=>{const p=press.current,el=scroll.current;if(p?.active&&el){const r=el.getBoundingClientRect();const speed=p.y<r.top+50?-12:p.y>r.bottom-50?12:0;if(speed)el.scrollTop+=speed;}frame=requestAnimationFrame(auto);};
    frame=requestAnimationFrame(auto);return()=>cancelAnimationFrame(frame);
  },[!!drag]);
  const begin=(e:PointerEvent<HTMLButtonElement>,row:ActionRow)=>{
    if(busy||row.readOnly||row.task.deletedAt||e.button!==0)return;
    const p={row,x:e.clientX,y:e.clientY,active:false,pointer:e.pointerId};press.current=p;
    e.currentTarget.setPointerCapture(e.pointerId);
    const activate=()=>{if(press.current===p){p.active=true;setDrag({style:urgencyStyle(row.task),title:row.task.title,x:p.x,y:p.y});}};
    if(e.pointerType==='touch')timer.current=setTimeout(activate,350);else activate();
  };
  const sections=[...QUADRANTS,{id:'unclassified',label:'待分类',important:false,urgent:false}];
  return <div ref={scroll} className="plan-board-scroll"><div className="plan-board">{sections.map(q=>{
    const items=rows.filter(row=>quadrant(row.task)===q.id);
    return <section key={q.id} className={`plan-quadrant ${q.id}${drag?.target===q.id?' drop-active':''}`} data-plan-drop={q.id==='unclassified'?undefined:q.id} aria-label={q.label}>
      <h3><span className="quadrant-dot"/>{q.label}<small>{items.length}</small></h3>
      <ul className="todo-list quadrant-list">{items.map(row=>render(row,<button className="plan-drag-handle" disabled={busy||!!row.task.deletedAt} aria-label={`拖动归类：${row.task.title}`} onPointerDown={e=>begin(e,row)}><GripVertical size={18}/></button>))}</ul>
      {!items.length&&<p className="quadrant-empty">{q.id==='unclassified'?'所有事项已分类':'暂无事项，可拖入或使用“移动到”'}</p>}
    </section>;
  })}</div>{drag&&<div ref={ghost} className="plan-drag-preview" style={{...drag.style,left:0,top:0,transform:`translate3d(${drag.x+12}px,${drag.y+12}px,0)`}}>{press.current?.row.windowId&&<SharedPlanBadge name={press.current.row.windowName} compact/>}{drag.title}<small>松手移动 · Esc 取消</small></div>}</div>;
}

