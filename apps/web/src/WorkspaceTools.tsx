import type { ReactNode } from 'react';
import { Check, ChevronLeft, ChevronRight, CircleAlert, CloudOff, Info, Loader2, Save, Maximize2, Minimize2 } from 'lucide-react';
import { GlassDate } from './GlassDate';
import { addDays, today } from './date';

export type SaveStatus = 'loading'|'saved'|'dirty'|'saving'|'offline'|'error'|'conflict';
export function WorkspaceToolbar({children,className,label}:{children:ReactNode;className:string;label:string}) {
  return <header className={`workspace-toolbar ${className}`} aria-label={label}>{children}</header>;
}
export function DiaryToolbar({date,onDate,label,count,status,onSave,onInformation,informationLabel,theme,onTheme,navigation,compact=false,fullscreen,onToggleFullscreen}:{
  date:string;onDate:(date:string)=>void;label:string;count:number;status:SaveStatus;onSave:()=>void;
  onInformation:()=>void;informationLabel:string;theme:string;onTheme:()=>void;navigation?:ReactNode;compact?:boolean;fullscreen?:boolean;onToggleFullscreen?:()=>void;
}) {
  const statusLabel={loading:'正在读取',saved:'已保存',dirty:'有未保存修改',saving:'正在保存',offline:'离线草稿',error:'保存失败，点击重试',conflict:'发现版本冲突'}[status];
  const Icon=status==='saved'?Check:status==='saving'||status==='loading'?Loader2:status==='error'||status==='conflict'?CircleAlert:status==='offline'?CloudOff:Save;
  return <WorkspaceToolbar className="diary-main-toolbar" label="日记工具栏">
    <nav className="diary-date-tools" aria-label="日记日期导航">
      <button type="button" aria-label="前一天" title="前一天" onClick={()=>onDate(addDays(date,-1))}><ChevronLeft size={18}/></button>
      <GlassDate label="日记日期" dateOnly required date={date} onChange={value=>{if(value)onDate(value);}}/>
      <button type="button" aria-label="后一天" title="后一天" onClick={()=>onDate(addDays(date,1))}><ChevronRight size={18}/></button>
      {!compact&&<button type="button" aria-label="回到今天" title="回到今天" onClick={()=>onDate(today())}>今天</button>}
    </nav>
    <span className="diary-toolbar-count" title={`${label} ${count} 条`} aria-label={`${label} ${count} 条`}><span>{label}</span><b>{count}</b><small>条</small></span>
    {navigation}
    <div className="diary-toolbar-actions">
      <button type="button" className="diary-desktop-action" aria-label={informationLabel} title={informationLabel} aria-haspopup="dialog" onClick={onInformation}><Info size={18}/></button>
      {onToggleFullscreen&&<button type="button" aria-label={fullscreen?'退出全屏':'全屏显示'} onClick={onToggleFullscreen}>{fullscreen?<Minimize2 size={18}/>:<Maximize2 size={18}/>}</button>}
      <button type="button" className="diary-save-control" data-status={status} aria-label="保存日记" title={statusLabel} disabled={status==='saving'||status==='loading'||status==='conflict'} onClick={onSave}><Icon size={20} className={status==='saving'||status==='loading'?'spin':undefined}/><span className="sr-only" role="status" aria-live="polite">{statusLabel}</span></button>
    </div>
  </WorkspaceToolbar>;
}
