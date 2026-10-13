import type {ReactNode} from 'react';
import type {LucideIcon} from 'lucide-react';
import {ChevronRight, Plus, X} from 'lucide-react';
import {GlassDialog} from './GlassUI';
import './diary-panel.css';

export function DiaryPanel({id,title,icon:Icon,count,summary,informationLabel,onInformation,onCreate,actions,children,className=''}:{
  id:string;title:string;icon:LucideIcon;count:number;summary:string;informationLabel:string;
  onInformation:()=>void;onCreate:()=>void;actions?:ReactNode;children:ReactNode;className?:string;
}) {
  return <section className={`panel-section diary-panel ${className}`} aria-labelledby={id}>
    <header className="diary-panel-heading">
      <Icon aria-hidden="true"/><h2 id={id}>{title}<small className="record-count">{count} 条</small></h2>
      <div className="diary-panel-actions">{actions}<button type="button" className="diary-create" aria-label={`新增${title.replace('今日','').replace('记录','').replace('碎片','')}`} title="新增记录" onClick={onCreate}><Plus size={22}/></button></div>
    </header>
    <button type="button" className="diary-information" onClick={onInformation} aria-haspopup="dialog" aria-label={`编辑${informationLabel}`}>
      <span>{informationLabel}</span><small>{summary}</small><ChevronRight size={16}/>
    </button>
    <div className="diary-panel-body" role="region" aria-label={`${title}记录区`} tabIndex={0}>{children}</div>
  </section>;
}

export function DiaryInformation({title,onClose,children}:{title:string;onClose:()=>void;children:ReactNode}) {
  return <GlassDialog label={title} className="diary-information-dialog" onClose={onClose}>
    <header><h2>{title}</h2><button type="button" className="square-button" aria-label={`关闭${title}`} onClick={onClose}><X size={20}/></button></header>
    <div className="diary-information-fields">{children}</div>
    <footer><button type="button" className="save-button" onClick={onClose}>完成编辑</button></footer>
  </GlassDialog>;
}
