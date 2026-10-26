import { ToggleButton } from 'react-aria-components';

/** One selection model for compact view and status controls. */
export function GlassSegments<T extends string>({label,value,options,onChange,disabled=false}:{
  label:string;value:T;options:readonly {value:T;label:string;disabled?:boolean}[];onChange:(value:T)=>void;disabled?:boolean;
}) {
  // Keep pointer focus on the pressed item; restoring toolbar focus can scroll
  // a narrow group beneath the pointer before its release.
  return <div role="group" aria-label={label} className="glass-segments" onKeyDown={event=>{
    if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
    const buttons=Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
    const index=buttons.indexOf(document.activeElement as HTMLButtonElement);if(index<0||!buttons.length)return;
    const next=event.key==='Home'?0:event.key==='End'?buttons.length-1:Math.max(0,Math.min(buttons.length-1,index+(event.key==='ArrowRight'?1:-1)));
    event.preventDefault();buttons[next].focus();
  }}>
    {options.map(option=><ToggleButton key={option.value} isSelected={value===option.value} isDisabled={disabled||option.disabled} onChange={selected=>{if(selected)onChange(option.value);}}>{option.label}</ToggleButton>)}
  </div>;
}
