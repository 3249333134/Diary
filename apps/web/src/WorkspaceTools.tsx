import type { ReactNode } from 'react';
import { Check, ChevronDown, ChevronLeft, ChevronRight, CircleAlert, CloudOff, Feather, Info, ListTodo, Loader2, Moon, Plus, Save, SlidersHorizontal, Sun, UserRound } from 'lucide-react';
import { GlassDate } from './GlassDate';
import { addDays, today } from './date';

export type SaveStatus = 'loading'|'saved'|'dirty'|'saving'|'offline'|'error'|'conflict';
export function WorkspaceToolbar({children,className,label}:{children:ReactNode;className:string;label:string}) {
  return <header className={`workspace-toolbar ${className}`} aria-label={label}>{children}</header>;
}
export function WorkspaceNavigation({plan,onWorkspace,onInformation,informationLabel,restricted,theme,onTheme,onCreate,createLabel,createDisabled,onLogout,username}:{
  plan:boolean;onWorkspace:(plan:boolean)=>void;onInformation:()=>void;informationLabel:string;restricted?:boolean;
  theme:string;onTheme:()=>void;onCreate:()=>void;createLabel:string;createDisabled?:boolean;onLogout:()=>void;username?:string;
}) {
  return <nav className="compact-browse-bar" aria-label="紧凑浏览工具栏">
    <button type="button" aria-label="日记" aria-pressed={!plan} title="日记" onClick={()=>onWorkspace(false)}><Feather size={20}/><small>日记</small></button>
    <button type="button" aria-label="计划" aria-pressed={plan} title="计划" onClick={()=>onWorkspace(true)}><ListTodo size={20}/><small>计划</small></button>
    <button type="button" className="compact-browse-context" data-restricted={restricted||undefined} aria-label={informationLabel} title={informationLabel} aria-haspopup="dialog" onClick={onInformation}>{plan?<SlidersHorizontal size={18}/>:<Info size={18}/>}<span>{plan?'筛选':'信息'}</span><ChevronDown size={14}/></button>
    <button type="button" aria-label={theme==='light'?'切换到深色主题':'切换到浅色主题'} title="切换主题" onClick={onTheme}>{theme==='light'?<Moon size={20}/>:<Sun size={20}/>}</button>
    <button type="button" className={!plan?'diary-navigation-create':undefined} aria-label={createLabel} title={createLabel} disabled={createDisabled} onClick={onCreate}><Plus size={20}/></button>
    <button type="button" aria-label={`退出登录 ${username||''}`} title={`退出登录 (${username||''})`} onClick={onLogout}><UserRound size={20}/></button>
  </nav>;
}
export function DiaryToolbar({date,onDate,label,count,status,onSave,onInformation,informationLabel,onCreate,theme,onTheme,navigation,disabled}:{
  date:string;onDate:(date:string)=>void;label:string;count:number;status:SaveStatus;onSave:()=>void;
  onInformation:()=>void;informationLabel:string;onCreate:()=>void;theme:string;onTheme:()=>void;navigation?:ReactNode;disabled:boolean;
}) {
  const statusLabel={loading:'正在读取',saved:'已保存',dirty:'有未保存修改',saving:'正在保存',offline:'离线草稿',error:'保存失败，点击重试',conflict:'发现版本冲突'}[status];
  const Icon=status==='saved'?Check:status==='saving'||status==='loading'?Loader2:status==='error'||status==='conflict'?CircleAlert:status==='offline'?CloudOff:Save;
  return <WorkspaceToolbar className="diary-main-toolbar" label="日记工具栏">
    <nav className="diary-date-tools" aria-label="日记日期导航">
      <button type="button" aria-label="前一天" title="前一天" onClick={()=>onDate(addDays(date,-1))}><ChevronLeft size={18}/></button>
      <GlassDate label="日记日期" dateOnly required date={date} onChange={value=>{if(value)onDate(value);}}/>
      <button type="button" aria-label="后一天" title="后一天" onClick={()=>onDate(addDays(date,1))}><ChevronRight size={18}/></button>
      <button type="button" aria-label="回到今天" title="回到今天" onClick={()=>onDate(today())}>今天</button>
    </nav>
    <span className="diary-toolbar-count" title={`${label} ${count} 条`} aria-label={`${label} ${count} 条`}><span>{label}</span><b>{count}</b><small>条</small></span>
    {navigation}
    <div className="diary-toolbar-actions">
      <button type="button" className="diary-desktop-action" aria-label={informationLabel} title={informationLabel} aria-haspopup="dialog" onClick={onInformation}><Info size={18}/></button>
      <button type="button" className="diary-desktop-action diary-create" disabled={disabled} aria-label={`新增${label}`} title={`新增${label}`} onClick={onCreate}><Plus size={21}/></button>
      <button type="button" className="diary-desktop-action" aria-label={theme==='light'?'切换到深色主题':'切换到浅色主题'} title="切换主题" onClick={onTheme}>{theme==='light'?<Moon size={20}/>:<Sun size={20}/>}</button>
      <button type="button" className="diary-save-control" data-status={status} aria-label="保存日记" title={statusLabel} disabled={status==='saving'||status==='loading'||status==='conflict'} onClick={onSave}><Icon size={20} className={status==='saving'||status==='loading'?'spin':undefined}/><span className="sr-only" role="status" aria-live="polite">{statusLabel}</span></button>
    </div>
  </WorkspaceToolbar>;
}
