import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown } from 'lucide-react';
import './plan-glass.css';

export type GlassOption = { value: string; label: string; group?: string; color?: string; disabled?: boolean; selected?: boolean };
export function GlassSelect({ label, value, options, onChange, disabled, placeholder, action = false }: {
  label: string; value: string; options: GlassOption[]; onChange: (value: string) => void;
  disabled?: boolean; placeholder?: string; action?: boolean;
}) {
  const id=useId(), trigger=useRef<HTMLButtonElement>(null), menu=useRef<HTMLDivElement>(null);
  const [open,setOpen]=useState(false), [host,setHost]=useState<HTMLElement|null>(null);
  const native = typeof HTMLElement !== 'undefined' && 'showPopover' in HTMLElement.prototype;
  const close=(focus=true)=>{setOpen(false);if(focus)trigger.current?.focus({preventScroll:true});};
  const show=()=>{document.dispatchEvent(new Event('glass-menu-close'));setHost(trigger.current?.closest('dialog') || document.body);setOpen(true);};
  useLayoutEffect(()=>{
    const el=menu.current, button=trigger.current;if(!open||!el||!button)return;
    if(native)el.showPopover();
    const r=button.getBoundingClientRect(), v=window.visualViewport;
    const left=v?.offsetLeft||0, top=v?.offsetTop||0, width=v?.width||innerWidth, height=v?.height||innerHeight;
    const menuWidth=Math.min(Math.max(r.width,232),width-16);
    const below=top+height-r.bottom-16, above=r.top-top-16;
    const down=below>=Math.min(el.scrollHeight,280)||below>=above;
    const available=Math.max(44,down?below:above);
    el.style.width=menuWidth+'px';el.style.maxHeight=Math.min(420,available)+'px';
    el.style.left=Math.max(left+8,Math.min(r.left,left+width-menuWidth-8))+'px';
    el.style.top=(down?r.bottom+8:Math.max(top+8,r.top-Math.min(el.scrollHeight,available,420)-8))+'px';
    (el.querySelector<HTMLButtonElement>('[aria-selected=true]:not(:disabled)') || el.querySelector<HTMLButtonElement>('[role=option]:not(:disabled)'))?.focus({preventScroll:true});
    return()=>{if(native&&el.matches(':popover-open'))el.hidePopover();};
  },[open,host]);
  useEffect(()=>{
    if(!open)return;
    const openedAt=performance.now();
    const outside=(event:PointerEvent)=>{if(!menu.current?.contains(event.target as Node)&&!trigger.current?.contains(event.target as Node))close(false);};
    const intent=(event:Event)=>{if(!menu.current?.contains(event.target as Node))close();};
    // Opening after focus/scroll can coincide with the compact header resizing.
    // Ignore that initial layout scroll, while wheel/touch intent still dismisses immediately.
    const scroll=(event:Event)=>{if(menu.current?.contains(event.target as Node)||performance.now()-openedAt<120)return;close();};
    const dismiss=()=>close(false);
    const main=trigger.current?.closest('main'), observer=new MutationObserver(dismiss);
    if(main)observer.observe(main,{attributes:true,attributeFilter:['data-workspace']});
    document.addEventListener('pointerdown',outside,true);document.addEventListener('scroll',scroll,true);document.addEventListener('glass-menu-close',dismiss);window.addEventListener('resize',dismiss);
    document.addEventListener('wheel',intent,{capture:true,passive:true});document.addEventListener('touchmove',intent,{capture:true,passive:true});
    return()=>{observer.disconnect();document.removeEventListener('pointerdown',outside,true);document.removeEventListener('scroll',scroll,true);document.removeEventListener('glass-menu-close',dismiss);document.removeEventListener('wheel',intent,true);document.removeEventListener('touchmove',intent,true);window.removeEventListener('resize',dismiss);};
  },[open]);
  const selected=options.find(option=>option.value===value);
  return <><button ref={trigger} type="button" className="glass-select-trigger" role="combobox" aria-label={label} aria-haspopup="listbox" aria-expanded={open} aria-controls={open?id:undefined} disabled={disabled} onClick={()=>open?close():show()} onKeyDown={event=>{if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();show();}}}>
    <span>{action?placeholder:selected?.label||placeholder||'请选择'}</span><ChevronDown size={15}/>
  </button>{open&&host&&createPortal(<div ref={menu} id={id} popover={native?'manual':undefined} className="glass-select-menu" role="listbox" aria-label={label} aria-multiselectable={action||undefined} onKeyDown={event=>{
    const buttons=Array.from(menu.current?.querySelectorAll<HTMLButtonElement>('[role=option]:not(:disabled)')||[]), index=buttons.indexOf(document.activeElement as HTMLButtonElement);
    if(event.key==='Escape'||event.key==='Tab'){if(event.key==='Escape')event.preventDefault();close();return;}
    let next:number|undefined;if(event.key==='ArrowDown')next=(index+1)%buttons.length;if(event.key==='ArrowUp')next=(index-1+buttons.length)%buttons.length;if(event.key==='Home')next=0;if(event.key==='End')next=buttons.length-1;
    if(next!==undefined){event.preventDefault();buttons[next]?.focus();}
  }}>{options.map((option,index)=><div key={option.value}>{option.group!==options[index-1]?.group&&option.group&&<div className="glass-option-group">{option.group}</div>}<button type="button" role="option" aria-selected={option.selected??option.value===value} disabled={option.disabled} onClick={()=>{close();onChange(option.value);}}>{option.color&&<i className="glass-option-dot" style={{background:option.color}}/>}<span>{option.label}</span>{(option.selected??option.value===value)&&<Check size={16}/>}</button></div>)}</div>,host)}</>;
}
