import {useOverlayControl} from './GlassUI';
import {Select,SelectValue,Button,Popover,ListBox,ListBoxItem,ListBoxSection,Header} from 'react-aria-components';
import {Check,ChevronDown} from 'lucide-react';
import './plan-glass.css';
export type GlassOption={value:string;label:string;group?:string;color?:string;disabled?:boolean;selected?:boolean};
export function GlassSelect({label,value,options,onChange,disabled,placeholder,action=false}:{label:string;value:string;options:GlassOption[];onChange:(value:string)=>void;disabled?:boolean;placeholder?:string;action?:boolean}){
 const overlay=useOverlayControl(),groups=[...new Set(options.map(o=>o.group||''))];
 const item=(o:GlassOption)=><ListBoxItem key={o.value} id={o.value||'__empty'} textValue={o.label} isDisabled={o.disabled} className="glass-option">{({isSelected})=><>{o.color&&<i className="glass-option-dot" style={{background:o.color}}/>}<span>{o.label}</span>{(o.selected??isSelected)&&<Check size={16}/>}</>}</ListBoxItem>;
 return <Select aria-label={label} selectedKey={action?null:value||'__empty'} onSelectionChange={key=>onChange(key==='__empty'?'':String(key))} isDisabled={disabled} isOpen={overlay.open} onOpenChange={overlay.setOpen} className="glass-select"><Button ref={overlay.trigger} className="glass-select-trigger"><SelectValue>{()=>action?placeholder:options.find(o=>o.value===value)?.label||placeholder||'请选择'}</SelectValue><ChevronDown size={15}/></Button><Popover className="glass-popup" placement="bottom start" offset={8} containerPadding={8} shouldFlip><ListBox className="glass-listbox" renderEmptyState={()=><p>暂无可选项</p>}>{groups.map(group=>group?<ListBoxSection key={group}><Header className="glass-option-group">{group}</Header>{options.filter(o=>o.group===group).map(item)}</ListBoxSection>:options.filter(o=>!o.group).map(item))}</ListBox></Popover></Select>;
}
