import { CalendarDays, Check, CircleAlert, Clock, LayoutGrid, ListTodo, Plus, SlidersHorizontal, Trash2 } from 'lucide-react';
import type { PlanCategory } from '@diary/contracts';
import type { PlanFilter } from './planFilters';

export type PlanLayout = 'board'|'windows'|'list'|'fortnight'|'week'|'month';
export type PlanToolAction = {kind:'create'|'filters'|'filter'|'view'|'category'|'add-category';value?:string;id:number};
export type PlanNavigationState = {filter:PlanFilter;layout:PlanLayout;category:string;categories:PlanCategory[];counts:Record<PlanFilter,number>;saving?:boolean;restricted?:boolean};
const ranges = [['all','全部计划',ListTodo],['today','今日',CalendarDays],['upcoming','即将开始',Clock],['overdue','逾期',CircleAlert],['done','已完成',Check],['trash','回收站',Trash2]] as const;
export function PlanNavigation({state,onAction}:{state?:PlanNavigationState;onAction:(kind:PlanToolAction['kind'],value?:string)=>void}) {
  return <div className="plan-rail-navigation">
    <button type="button" disabled={state?.saving} className="plan-rail-create" onClick={()=>onAction('create')}><Plus size={18}/>新建计划</button>
    <nav aria-label="计划快捷导航">{ranges.map(([key,label,Icon])=><button type="button" disabled={state?.saving} key={key} aria-pressed={state?.filter===key} onClick={()=>onAction('filter',key)}><Icon size={17}/><span>{label}</span><small>{state?.counts[key]??0}</small></button>)}</nav>
    <div className="plan-rail-group"><h2>日程视图</h2><nav aria-label="侧栏日程视图">{([['fortnight','两周日程',CalendarDays],['board','四象限',LayoutGrid],['windows','分类窗口',LayoutGrid],['list','列表',ListTodo],['week','周日程',CalendarDays],['month','月日程',CalendarDays]] as const).map(([key,label,Icon])=><button type="button" disabled={state?.saving||state?.filter==='trash'&&key!=='list'} key={key} aria-pressed={state?.filter==='trash'?key==='list':state?.layout===key} onClick={()=>onAction('view',key)}><Icon size={17}/><span>{label}</span></button>)}</nav></div>
    <div className="plan-rail-group"><h2>事项类别</h2><nav aria-label="侧栏计划类别"><button type="button" disabled={state?.saving} aria-pressed={state?.category==='all'} onClick={()=>onAction('category','all')}><span className="plan-rail-dot"/><span>全部类别</span></button>{state?.categories.map(category=><button type="button" disabled={state?.saving} key={category.id} data-plan-drop={'category:'+category.id} aria-pressed={state.category===category.id} onClick={()=>onAction('category',category.id)}><span className="plan-rail-dot" style={{background:category.color}}/><span>{category.name}</span></button>)}<button type="button" disabled={state?.saving} onClick={()=>onAction('add-category')}><Plus size={17}/><span>新增类别</span></button></nav></div>
    <button type="button" disabled={state?.saving} className="plan-rail-filter" onClick={()=>onAction('filters')}><SlidersHorizontal size={17}/>更多筛选</button>
    <small className="plan-rail-caption">数量为当前已加载的日程</small>
  </div>;
}
