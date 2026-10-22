import { ChevronLeft, ChevronRight, Moon, Plus, SlidersHorizontal, Sun } from 'lucide-react';
import { useEffect, useRef } from 'react';
import type { PlanLayout } from './PlanNavigation';
import type { PlanFilter } from './planFilters';
import { calendarRange, shiftDate } from './calendarDates';
import { planClock } from './planFilters';
import { WorkspaceToolbar } from './WorkspaceTools';

export const PLAN_LAYOUTS = [['fortnight','两周'],['board','四象限'],['windows','窗口'],['list','列表'],['week','周'],['month','月']] as const;

export function PlanToolbar({layout,onLayout,anchor,onAnchor,filter,filterLabel,restricted,saving,onFilters,onCreate,theme,onTheme}:{
  layout:PlanLayout;onLayout:(view:PlanLayout)=>void;anchor:string;onAnchor:(date:string)=>void;
  filter:PlanFilter;filterLabel:string;restricted:boolean;saving:boolean;onFilters:()=>void;onCreate:()=>void;
  theme:'light'|'dark';onTheme:()=>void;
}) {
  const viewScroller=useRef<HTMLElement>(null);
  useEffect(()=>{
    const nav=viewScroller.current,selected=nav?.querySelector<HTMLElement>('[aria-pressed=true]');
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
  const navigate=(direction:number)=>{
    if(!calendar)onLayout('fortnight');
    if(layout==='month'){
      const date=new Date(`${anchor.slice(0,7)}-01T00:00:00Z`);date.setUTCMonth(date.getUTCMonth()+direction);onAnchor(date.toISOString().slice(0,10));
    }else onAnchor(shiftDate(anchor,direction*(layout==='week'?7:14)));
  };
  return <WorkspaceToolbar className="plan-main-toolbar" label="计划工具栏">
    <div className="plan-date-tools">
      <strong className="plan-date-range" title={label} aria-label={`${range.from} 至 ${range.to}`}>{label}</strong>
      <nav aria-label="日历日期">
        <button type="button" aria-label="上一期" title="上一期" disabled={saving} onClick={()=>navigate(-1)}><ChevronLeft size={18}/></button>
        <button type="button" disabled={saving} onClick={()=>onAnchor(planClock().date)}>今天</button>
        <button type="button" aria-label="下一期" title="下一期" disabled={saving} onClick={()=>navigate(1)}><ChevronRight size={18}/></button>
      </nav>
    </div>
    <nav ref={viewScroller} className="plan-view-switch" aria-label="计划视图">{PLAN_LAYOUTS.map(([key,label])=><button key={key} type="button" aria-pressed={filter==='trash'?key==='list':layout===key} disabled={saving||filter==='trash'&&key!=='list'} onClick={()=>onLayout(key)}>{label}</button>)}</nav>
    <div className="plan-toolbar-actions">
      <button type="button" className="plan-filter-trigger" data-restricted={restricted||undefined} aria-label="筛选计划" title={`筛选：${filterLabel}${restricted?' · 已应用限制':''}`} aria-haspopup="dialog" onClick={onFilters}><SlidersHorizontal size={18}/>{restricted&&<i className="plan-filter-dot" aria-label="已应用筛选"/>}</button>
      <button type="button" className="plan-add-button" aria-label="新增计划" title="新增计划" onClick={onCreate}><Plus size={21}/></button>
      <button type="button" aria-label={theme==='light'?'切换到深色主题':'切换到浅色主题'} title="切换主题" onClick={onTheme}>{theme==='light'?<Moon size={20}/>:<Sun size={20}/>}</button>
    </div>
  </WorkspaceToolbar>;
}
