import { Maximize2,Minimize2, SlidersHorizontal } from 'lucide-react';
import { useEffect, useRef } from 'react';
import type { PlanLayout } from './PlanNavigation';
import type { PlanFilter } from './planFilters';
import { calendarRange } from './calendarDates';
import { planClock } from './planFilters';
import { WorkspaceToolbar } from './WorkspaceTools';
import { GlassSegments } from './GlassSegments';

export const PLAN_LAYOUTS = [['fortnight','两周'],['month','月'],['week','周'],['windows','窗口'],['list','列表'],['board','四象限']] as const;

export function PlanToolbar({layout,onLayout,anchor,onAnchor,filter,filterLabel,restricted,saving,onFilters,theme,onTheme,fullscreen,onToggleFullscreen}:{
  layout:PlanLayout;onLayout:(view:PlanLayout)=>void;anchor:string;onAnchor:(date:string)=>void;
  filter:PlanFilter;filterLabel:string;restricted:boolean;saving:boolean;onFilters:()=>void;
  theme:'light'|'dark';onTheme:()=>void;fullscreen?:boolean;onToggleFullscreen?:()=>void;
}) {
  const viewScroller=useRef<HTMLElement>(null);
  useEffect(()=>{
    const nav=viewScroller.current,selected=nav?.querySelector<HTMLElement>('[data-selected]');
    if(nav&&selected){
      const item=selected.getBoundingClientRect(),box=nav.getBoundingClientRect();
      if(item.left<box.left)nav.scrollLeft+=item.left-box.left;
      else if(item.right>box.right)nav.scrollLeft+=item.right-box.right;
    }
  },[layout,filter]);
  const calendar=layout==='fortnight'||layout==='week'||layout==='month';
  const range=calendarRange(anchor,calendar?layout:'fortnight');
  const sameYear=range.from.slice(0,4)===range.to.slice(0,4);
  const label=layout==='month'?anchor.slice(0,7):`${range.from} — ${sameYear?range.to.slice(5):range.to}`;
  return <WorkspaceToolbar className="plan-main-toolbar" label="计划工具栏">
    <div className="plan-date-tools">
      <strong className="plan-date-range" title={label} aria-label={`${range.from} 至 ${range.to}`}>{label}</strong>
      <nav aria-label="日历日期">
        <button type="button" disabled={saving} onClick={()=>{if(!calendar)onLayout('fortnight');onAnchor(planClock().date);}}>今天</button>
      </nav>
    </div>
    <nav ref={viewScroller} className="plan-view-switch" aria-label="计划视图"><GlassSegments label="选择计划视图" value={filter==='trash'?'list':layout} options={PLAN_LAYOUTS.map(([value,label])=>({value,label,disabled:filter==='trash'&&value!=='list'}))} onChange={onLayout} disabled={saving}/></nav>
    <div className="plan-toolbar-actions">
      <button type="button" className="plan-filter-trigger" data-restricted={restricted||undefined} aria-label="筛选计划" title={`筛选：${filterLabel}${restricted?' · 已应用限制':''}`} aria-haspopup="dialog" onClick={onFilters}><SlidersHorizontal size={18}/>{restricted&&<i className="plan-filter-dot" aria-label="已应用筛选"/>}</button>
      {onToggleFullscreen&&<button type="button" aria-label={fullscreen?'退出全屏':'全屏显示'} title="全屏" onClick={onToggleFullscreen}>{fullscreen?<Minimize2 size={18}/>:<Maximize2 size={18}/>}</button>}
    </div>
  </WorkspaceToolbar>;
}
