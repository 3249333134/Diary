import { CalendarDays, Check, CircleAlert, LayoutGrid, ListTodo, Plus, SlidersHorizontal, Trash2 } from 'lucide-react';
import type { PlanCategory } from '@diary/contracts';
import type { PlanFilter } from './planFilters';

export type PlanLayout = 'board'|'windows'|'list'|'week'|'month';
export type PlanToolAction = {kind:'create'|'filters'|'filter'|'view'|'category';value?:string;id:number};
export type PlanNavigationState = {filter:PlanFilter;layout:PlanLayout;category:string;categories:PlanCategory[];counts:Record<PlanFilter,number>};
const ranges = [['all','全部计划',ListTodo],['today','今日',CalendarDays],['overdue','逾期',CircleAlert],['done','已完成',Check],['trash','回收站',Trash2]] as const;
export function PlanNavigation({state,onAction}:{state?:PlanNavigationState;onAction:(kind:PlanToolAction['kind'],value?:string)=>void}) {
  return <div className="plan-rail-navigation">
    <button type="button" className="plan-rail-create" onClick={()=>onAction('create')}><Plus size={18}/>新建计划</button>
    <nav aria-label="计划快捷导航">{ranges.map(([key,label,Icon])=><button type="button" key={key} aria-pressed={state?.filter===key} onClick={()=>onAction('filter',key)}><Icon size={17}/><span>{label}</span><small>{state?.counts[key]??0}</small></button>)}</nav>
    <div className="plan-rail-group"><h2>日程视图</h2><nav aria-label="侧栏日程视图">{([['board','四象限',LayoutGrid],['windows','分类窗口',LayoutGrid],['week','周日程',CalendarDays],['month','月日程',CalendarDays]] as const).map(([key,label,Icon])=><button type="button" key={key} aria-pressed={state?.layout===key} onClick={()=>onAction('view',key)}><Icon size={17}/><span>{label}</span></button>)}</nav></div>
    <div className="plan-rail-group"><h2>事项类别</h2><nav aria-label="侧栏计划类别"><button type="button" aria-pressed={state?.category==='all'} onClick={()=>onAction('category','all')}><span className="plan-rail-dot"/><span>全部类别</span></button>{state?.categories.map(category=><button type="button" key={category.id} aria-pressed={state.category===category.id} onClick={()=>onAction('category',category.id)}><span className="plan-rail-dot" style={{background:category.color}}/><span>{category.name}</span></button>)}</nav></div>
    <button type="button" className="plan-rail-filter" onClick={()=>onAction('filters')}><SlidersHorizontal size={17}/>更多筛选</button>
    <small className="plan-rail-caption">数量为当前已加载的日程</small>
  </div>;
}
