import {useCallback,useContext,useEffect,useRef,useState,type ReactNode} from 'react';
import {ComboBox,ComboBoxStateContext,Input,Button,Popover,ListBox,ListBoxItem,ModalOverlay,Modal,Dialog} from 'react-aria-components';
import {ChevronDown} from 'lucide-react';
import './glass-ui.css';
/** React Aria owns placement/focus; the workspace owns dismissal. */
export function useOverlayControl(){
 const [open,update]=useState(false),trigger=useRef<HTMLButtonElement>(null);
 const setOpen=useCallback((next:boolean)=>{if(next)document.dispatchEvent(new Event('glass-menu-close'));update(next);},[]);
 useEffect(()=>{
  if(!open)return;
  const close=()=>update(false),started=performance.now();
  const scroll=(e:Event)=>{if(performance.now()-started<180||e.target instanceof Element&&e.target.closest('.glass-popup'))return;if(e.target instanceof Element&&e.target.closest('.workspace-panel,.calendar-scroll,.todo-list,.glass-modal,.main-content'))close();};
  const main=document.querySelector('main'),observer=new MutationObserver(close);
  if(main)observer.observe(main,{attributes:true,attributeFilter:['data-workspace']});
  const visible=new IntersectionObserver(entries=>{if(entries.some(e=>!e.isIntersecting))close();});
  if(trigger.current)visible.observe(trigger.current);
  document.addEventListener('glass-menu-close',close);document.addEventListener('scroll',scroll,true);
  return()=>{observer.disconnect();visible.disconnect();document.removeEventListener('glass-menu-close',close);document.removeEventListener('scroll',scroll,true);};
 },[open]);
 return {open,setOpen,trigger};
}
export function GlassComboBox({label,value,onChange,options,placeholder,onCommit,autoFocus,id,fieldPath}:{label:string;value:string;onChange:(value:string)=>void;options:string[];placeholder?:string;onCommit?:(value:string)=>void;autoFocus?:boolean;id?:string;fieldPath?:string}){
 const overlay=useOverlayControl(),[query,setQuery]=useState(false);
 const items=[...new Set(options)].filter(o=>!query||o.toLocaleLowerCase().includes(value.toLocaleLowerCase()));
 return <ComboBox aria-label={label} allowsCustomValue allowsEmptyCollection inputValue={value} selectedKey={null} onInputChange={next=>{setQuery(true);onChange(next);}} onSelectionChange={key=>{if(key!=null){onChange(String(key));onCommit?.(String(key));overlay.setOpen(false);}}} onOpenChange={overlay.setOpen} menuTrigger="manual" className="glass-combo">
 <ComboBoxDismiss open={overlay.open}/>
 <div className="glass-combo-control"><Input id={id} autoFocus={autoFocus} placeholder={placeholder} data-field={fieldPath} onKeyDown={e=>{if(e.key==='Enter'&&!overlay.open&&onCommit){e.preventDefault();onCommit(value);}}}/><Button ref={overlay.trigger} aria-label={'展开'+label+'选项'} onPress={()=>setQuery(false)}><ChevronDown size={16}/></Button></div>
 <Popover className="glass-popup" placement="bottom start" offset={8} containerPadding={8} shouldFlip><ListBox className="glass-listbox" renderEmptyState={()=><p className="glass-no-options">无匹配选项，可继续输入自定义内容</p>}>{items.map(o=><ListBoxItem id={o} key={o} textValue={o} className="glass-option">{o}</ListBoxItem>)}</ListBox></Popover></ComboBox>;
}
function ComboBoxDismiss({open}:{open:boolean}) { const state=useContext(ComboBoxStateContext);useEffect(()=>{if(!open&&state?.isOpen)state.close();},[open,state]);return null; }
export function GlassDialog({children,label,onClose,busy=false,className='plan-edit-dialog',overlayClassName=''}:{children:ReactNode;label:string;onClose:()=>void;busy?:boolean;className?:string;overlayClassName?:string}){
 return <ModalOverlay isOpen isDismissable={!busy} isKeyboardDismissDisabled={busy} onOpenChange={open=>{if(!open)onClose();}} className={'glass-modal-overlay '+overlayClassName}><Modal className={'glass-modal '+className}><Dialog aria-label={label} className="plan-dialog-content">{children}</Dialog></Modal></ModalOverlay>;
}
