import {createContext,useContext,useEffect,useRef,type ReactNode,type RefObject} from 'react';
import {BookOpen, X} from 'lucide-react';
import {GlassDialog} from './GlassUI';
import {useScrollMemory} from './workspaceState';
import './diary-panel.css';

export type DiaryControls={create:()=>void;information:()=>void};
export const DiaryControlsContext=createContext<{register:(id:string,controls:RefObject<DiaryControls>)=>()=>void;onReceipts:()=>void;account?:string;date?:string;column?:string;active?:boolean}>({register:()=>()=>{},onReceipts:()=>{}});
export function DiaryPanel({id,title,onInformation,onCreate,children,className=''}:{
  id:string;title:string;onInformation:()=>void;onCreate:()=>void;children:ReactNode;className?:string;
}) {
  const {register,account='guest',date='',column,active}=useContext(DiaryControlsContext),controls=useRef({create:onCreate,information:onInformation}),body=useRef<HTMLDivElement>(null);
  useScrollMemory(account,'diary.'+date+'.'+id,body,active&&column===id.replace('-title',''));
  controls.current={create:onCreate,information:onInformation};
  useEffect(()=>register(id,controls),[id,register]);
  return <section className={`panel-section diary-panel ${className}`} aria-label={title}>
    <div ref={body} className="diary-panel-body" role="region" aria-label={`${title}记录区`} tabIndex={0}>{children}</div>
  </section>;
}

export function DiaryInformation({title,onClose,children}:{title:string;onClose:()=>void;children:ReactNode}) {
  const {onReceipts}=useContext(DiaryControlsContext);
  return <GlassDialog label={title} className="diary-information-dialog" onClose={onClose}>
    <header><h2>{title}</h2><button type="button" className="square-button" aria-label={`关闭${title}`} onClick={onClose}><X size={20}/></button></header>
    <div className="diary-information-fields">{children}</div>
    <footer><button type="button" className="quiet-button" onClick={()=>{onClose();onReceipts();}}><BookOpen size={18}/>每日小票</button><button type="button" className="save-button" onClick={onClose}>完成编辑</button></footer>
  </GlassDialog>;
}
