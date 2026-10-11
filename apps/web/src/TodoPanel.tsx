import { usePlanCategories, AddPlanCategory, categoryStyle } from './PlanCategories';
import { PlanEntityFields, PlanEntitySummary, type EntityContext } from './PlanEntities';
import { GlassSelect } from './GlassSelect';
import { useGlassConfirm } from './GlassConfirm';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { ListTodo, Plus, Trash2, X, Clock, Calendar, Check, Pencil, RotateCcw, Link2, CheckCircle2, Sparkles, Flag, SlidersHorizontal, ChevronDown } from 'lucide-react';
import type { RecordRef, Todo } from '@diary/contracts';
import { api, type ActionRow, type ActionInput, type ParsedTodo } from './api';
import { planClock, matchesPlan, planState, type PlanFilter } from './planFilters';
import { ClassificationFields, QUADRANTS, quadrant, type Classification } from './PlanFields';
import { PlanBoard } from './PlanBoard';
import { PlanWindows } from './PlanWindows';
import { PlanViews } from './PlanViews';
import type { PlanView } from './api';
import './plan-board.css';
import './plan-windows.css';
import { PlanCompletion } from './PlanCompletion';
import type { CaptureDraft } from '@diary/contracts';
const today = () => planClock().date;
import './todos.css';

const PRIORITY_LABEL: Record<string, string> = { high: '高', medium: '中', low: '低' };
const PRIORITY_COLOR: Record<string, string> = { high: '#bd3d4c', medium: '#b8860b', low: '#6b7280' };
const STATUS_LABEL: Record<string, string> = { todo: '待开始', doing: '进行中', done: '已完成', cancelled: '已取消' };

function TodoStats({ rows, filter, onFilter }: { rows: ActionRow[]; filter: PlanFilter; onFilter: (f: PlanFilter) => void }) {
  return <div className="todo-stats">{([['all','全部'],['overdue','逾期'],['today','今日'],['upcoming','即将开始'],['done','已完成']] as const).map(([key,label]) => { const count=rows.filter(r=>matchesPlan(r.task,key)).length;const Icon=key==='all'?ListTodo:key==='overdue'?Flag:key==='today'?Calendar:key==='upcoming'?Clock:CheckCircle2;return <button key={key} className={`todo-stat-chip ${key} ${filter === key ? 'active' : ''}`} aria-label={`${label} ${count} 项`} title={label} aria-pressed={filter === key} onClick={() => onFilter(key)}><Icon className="compact-stat-icon" size={16}/><strong>{count}</strong><span>{label}</span></button>;})}</div>;
}

function PlanDialog({ children, busy, onClose, label = "计划编辑" }: { children: ReactNode; busy: boolean; onClose: () => void; label?: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null; ref.current?.showModal(); return () => { ref.current?.close(); if(opener?.isConnected) opener.focus({preventScroll:true}); }; }, []);
  return <dialog ref={ref} aria-label={label} className="plan-edit-dialog" onCancel={e => { e.preventDefault(); if (!busy) onClose(); }}>{children}</dialog>;
}

/** 优先级标签 */
function PriorityBadge({ priority }: { priority: string }) {
  return (
    <span className="todo-priority" style={{ color: PRIORITY_COLOR[priority] || '#6b7280', borderColor: PRIORITY_COLOR[priority] || '#6b7280' }}>
      <Flag size={11} />{PRIORITY_LABEL[priority] || priority}
    </span>
  );
}

/** 单个计划卡片 */
function TodoItem({ row, busy, onCheck, onEdit, onDelete, onStatus, onOpenSource, onOpenCompletion, onMove, handle }: {
  handle?: ReactNode; onMove: (row: ActionRow, patch: Classification) => void;
  row: ActionRow; busy: boolean;
  onCheck: (row: ActionRow) => void;
  onEdit: (row: ActionRow) => void;
  onDelete: (row: ActionRow) => void;
  onStatus: (row: ActionRow, status: 'todo' | 'doing' | 'done' | 'cancelled') => void;
  onOpenSource: (ref: RecordRef) => void;
  onOpenCompletion: (row: ActionRow) => void;
}) {
  const due = row.task.dueDate || row.task.plannedDate || '';
  const dueTime = row.task.dueDate ? row.task.dueTime : row.task.time;
  const overdue = matchesPlan(row.task, 'overdue');
  const status = row.task.done ? 'done' : row.task.status || 'todo';
  const [expanded, setExpanded] = useState(false);
  const detailsId = useId();
  const state = planState(row.task);
  const {categories}=usePlanCategories();
  const category=categories.find(c=>c.id===row.task.category);
  const categoryLabel = category?.name || (row.task.category ? '自定义类别' : '待分类');
  return (
    <li
      key={`${row.date}:${row.task.id}`}
      style={categoryStyle(category?.color)}
      data-custom-category={!!row.task.category&&!'work personal'.split(' ').includes(row.task.category)}
      data-record-id={row.task.id}
      data-plan-id={row.task.id}
      data-expanded={expanded}
      className={['plan-card', `category-${row.task.category || 'unset'}`, `state-${planState(row.task)}`,
        `quadrant-${quadrant(row.task)}`,
        row.task.done || row.task.status === 'done' ? 'todo-done' : '',
        overdue ? 'todo-overdue' : '',
      ].filter(Boolean).join(' ')}
    >
      <label className="todo-check">
        <input
          type="checkbox"
          checked={row.task.done || row.task.status === 'done'}
          disabled={busy}
          aria-label={`完成：${row.task.title}`}
          onChange={() => onCheck(row)}
        />
      </label>

      <button type="button" className="plan-card-summary" aria-label={'计划详情：'+row.task.title} aria-expanded={expanded} aria-controls={detailsId} onClick={()=>{setExpanded(value=>!value);}}>
        <span className="plan-summary-heading"><strong className="todo-title">{row.task.title}</strong><ChevronDown size={18} className="plan-expand-icon"/></span>
        <span className="plan-summary-meta"><span className="plan-category-label">{categoryLabel}</span><span className="plan-summary-due"><Calendar size={13}/>{due ? due+(dueTime?' '+dueTime:'') : '未安排日期'}</span>{state!=='neutral'&&<strong className={'plan-state-badge badge-'+state}>{({done:'已完成',overdue:'已超期',soon:'即将到期',neutral:''})[state]}</strong>}</span>
      </button>
      <div id={detailsId} hidden={!expanded} className="todo-copy plan-card-details">
        <div className="plan-detail-classification"><PriorityBadge priority={row.task.priority}/><span>{QUADRANTS.find(q=>q.id===quadrant(row.task))?.label || '象限待分类'}</span><span>{STATUS_LABEL[status]}</span></div>
        {row.task.description && <p className="todo-desc">{row.task.description}</p>}

        <PlanEntitySummary value={row.task.entities || []}/>
        <p className="plan-start">原定开始：{row.task.startDate ? `${row.task.startDate} ${row.task.startTime || '未设置时间'}` : '未设置'}</p>

        <div className="todo-meta">
          {row.task.list && <span className="todo-list-chip">{row.task.list}</span>}
          <span>{row.task.source ? '来自日记' : '自主创建'}</span>
        </div>

        {/* 子任务进度 */}
        {row.task.subtasks?.length > 0 && (
          <div className="todo-subtasks">
            {row.task.subtasks.filter(s => s.done).length}/{row.task.subtasks.length} 子任务
          </div>
        )}

        {/* 来源 / 完成事实 */}
        <div className="todo-actions" style={{ marginTop: 6 }}>
          {row.task.source && (
            <button className="todo-source-link" onClick={() => onOpenSource(row.task.source!)} title={`来源：${row.task.source.summary}`}>
              <Link2 size={12} />{row.sourceExists ? '查看来源' : '来源已删除'}
            </button>
          )}
          {row.task.completion && (
            <button className="todo-source-link" onClick={() => onOpenSource(row.task.completion!)} title={`完成事实：${row.task.completion.summary}`}>
              <CheckCircle2 size={12} />{row.completionExists ? '查看日记' : '完成记录已删除'}
            </button>
          )}
        </div>

        {/* 操作按钮：左侧次要操作，右侧主要操作（完成+删除） */}
        <div className="todo-actions">
          <div className="plan-actions-left">
            <div className="plan-move-menu"><GlassSelect action placeholder="移动到…" label={'移动到：'+row.task.title} disabled={busy||!!row.task.deletedAt} value={row.task.category||''} options={[...categories.map(c=>({value:c.id,label:c.name,group:'事项类别',color:c.color,selected:row.task.category===c.id})),...QUADRANTS.map((q,i)=>({value:q.id,label:q.label,group:'四象限',selected:q.id===quadrant(row.task),color:['#c05d56','#7856bd','#258378','#9296a3'][i]}))]} onChange={id=>{const q=QUADRANTS.find(q=>q.id===id);onMove(row,q?{important:q.important,urgent:q.urgent}:{category:id});}}/></div>
            <GlassSelect label={'计划状态：'+row.task.title} value={status} disabled={busy||!!row.task.deletedAt} options={Object.entries(STATUS_LABEL).map(([value,label])=>({value,label,color:({todo:'#9296a3',doing:'#7856bd',done:'#258378',cancelled:'#a36b76'} as Record<string,string>)[value]}))} onChange={status=>onStatus(row,status as 'todo'|'doing'|'done'|'cancelled')}/>
            <button className="quiet-button" disabled={busy || !!row.task.deletedAt} onClick={() => onEdit(row)}>
              <Pencil size={15} />修改
            </button>
            {(row.task.done || row.task.deletedAt || row.restorePending) && (
              <button className="quiet-button" disabled={busy} onClick={() => onCheck(row)}>
                <RotateCcw size={15} />恢复
              </button>
            )}
          </div>
          <div className="plan-actions-right">
            {!row.task.done && !row.task.deletedAt && (
              <button className="quiet-button plan-primary-action" disabled={busy} onClick={() => onOpenCompletion(row)}>
                <Check size={15} />完成
              </button>
            )}
            <button className="quiet-button plan-delete-action" disabled={busy} aria-label={`${row.task.deletedAt ? '永久删除' : '删除计划'}：${row.task.title}`} onClick={() => onDelete(row)}>
              <Trash2 size={15} />{row.task.deletedAt ? "永久删除" : "删除"}
            </button>
          </div>
        </div>

        {row.restorePending && <p role="status">恢复计划待重试，请点击“恢复”补全撤销；其他事实不受影响。</p>}
        {(row.completionPending || row.pendingRecord || row.pendingFact) && (
          <p role="status" style={{ color: 'var(--purple-ink)', fontSize: 12, marginTop: 4 }}>
            完成记录待恢复，将保留首次完成时间。
            <button className="quiet-button" onClick={() => onOpenCompletion(row)}>恢复保存</button>
          </p>
        )}
      </div>

      {handle && <div className="plan-card-tools">{handle}</div>}
    </li>
  );
}

/** AI 识别预览模态框 */
function ParsePreviewModal({ text, parsed, busy, onConfirm, onEdit, onClose, entityContext }: {
  entityContext: EntityContext;
  text: string;
  parsed: ParsedTodo | null;
  busy: boolean;
  onConfirm: () => void;
  onEdit: (patch: Partial<ParsedTodo>) => void;
  onClose: () => void;
}) {
  if (!parsed) return null;
  return (
    <PlanDialog busy={busy} onClose={onClose}>
      <div className="todo-modal" onClick={e => e.stopPropagation()}>
        <div className="todo-modal-header">
          <h3><Sparkles size={18} style={{ color: 'var(--purple)' }} /> 新建计划</h3>
          <p>已自动提取属性，可直接修改后创建</p>
        </div>
        <div className="todo-modal-body">
          <label className="field">
            <span>标题</span>
            <input value={parsed.title} maxLength={2000} onChange={e => onEdit({ title: e.target.value })} />
          </label>
          <label className="field"><span>详情描述</span><textarea rows={2} maxLength={10000} value={parsed.description || ''} onChange={e => onEdit({description: e.target.value})} placeholder="补充说明（可选）" /></label>
          <ClassificationFields value={parsed} onChange={onEdit}/>
          <div style={{ display: 'flex', gap: 12 }}>
            <label className="field" style={{ flex: 1 }}>
              <span>截止日期</span>
              <input type="date" value={parsed.dueDate} onChange={e => onEdit({ dueDate: e.target.value })} />
            </label>
            <label className="field" style={{ flex: 1 }}>
              <span>截止时间</span>
              <input type="time" value={parsed.dueTime} onChange={e => onEdit({ dueTime: e.target.value })} />
            </label>
          </div>
          <div style={{ display: 'flex', gap: 12 }}>
            <label className="field" style={{ flex: 1 }}>
              <span>优先级</span>
              <GlassSelect label="优先级" value={parsed.priority} options={Object.entries(PRIORITY_LABEL).map(([value,label])=>({value,label}))} onChange={priority=>onEdit({priority})}/>
            </label>
            <label className="field" style={{ flex: 1 }}>
              <span>清单</span>
              <input value={parsed.list} onChange={e => onEdit({ list: e.target.value })} placeholder="工作/生活/学习..." />
            </label>
          </div>
          <PlanEntityFields context={entityContext} value={parsed.entities || []} onChange={entities=>onEdit({entities})}/>
        </div>
        <div className="todo-modal-footer">
          <button className="quiet-button" disabled={busy} onClick={onClose}>取消</button>
          <button className="quiet-button" disabled={busy || !parsed.title.trim()} onClick={onConfirm}>
            <Check size={15} />确认创建
          </button>
        </div>
      </div>
    </PlanDialog>
  );
}

/** 修改安排模态框（完整属性） */
function EditModal({ row, busy, onSave, onClose, entityContext }: {
  entityContext: EntityContext;
  row: ActionRow; busy: boolean;
  onSave: (task: Todo) => void;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(row.task.title);
  const [description, setDescription] = useState(row.task.description || '');
  const [plannedDate, setPlannedDate] = useState(row.task.plannedDate || '');
  const [time, setTime] = useState(row.task.time || '');
  const [dueDate, setDueDate] = useState(row.task.dueDate || '');
  const [dueTime, setDueTime] = useState(row.task.dueTime || '');
  const [priority, setPriority] = useState(row.task.priority || 'medium');
  const [list, setList] = useState(row.task.list || '');
  const [tagsInput, setTagsInput] = useState((row.task.tags || []).join(', '));
  const [planEntities, setPlanEntities] = useState(row.task.entities || []);
  const [subtasks, setSubtasks] = useState(row.task.subtasks || []);
  const [classification, setClassification] = useState<Classification>({category:row.task.category,important:row.task.important,urgent:row.task.urgent,startDate:row.task.startDate,startTime:row.task.startTime});

  const save = () => {
    const tags = tagsInput.split(/[,，]/).map(s => s.trim()).filter(Boolean);
    const updated: Todo = {
      ...row.task,
      ...classification,
      title: title.trim(),
      description,
      plannedDate,
      time,
      dueDate,
      dueTime,
      priority,
      list,
      tags,
      subtasks,
      entities: planEntities,
    };
    onSave(updated);
  };

  const addSubtask = () => setSubtasks([...subtasks, { id: crypto.randomUUID(), title: '', done: false }]);

  return (
    <PlanDialog busy={busy} onClose={onClose}>
      <div className="todo-modal todo-modal-large" onClick={e => e.stopPropagation()}>
        <div className="todo-modal-header">
          <h3>编辑计划</h3>
          <p>修改任务属性</p>
        </div>
        <div className="todo-modal-body">
          <label className="field"><span>标题</span><input value={title} maxLength={2000} onChange={e => setTitle(e.target.value)} /></label>
          <label className="field"><span>详情描述</span><textarea rows={2} value={description} onChange={e => setDescription(e.target.value)} placeholder="补充说明" /></label>
          <ClassificationFields value={classification} onChange={patch=>setClassification({...classification,...patch})} />
          {(plannedDate || time) && <details><summary>历史日期字段</summary><p>用于兼容旧计划；原定开始与截止分别在上方、下方设置。</p><div style={{ display: 'flex', gap: 12 }}>
            <label className="field" style={{ flex: 1 }}><span>旧计划日期</span><input type="date" value={plannedDate} onChange={e => setPlannedDate(e.target.value)} /></label>
            <label className="field" style={{ flex: 1 }}><span>旧计划时间</span><input type="time" value={time} onChange={e => setTime(e.target.value)} /></label>
          </div></details>}
          <div style={{ display: 'flex', gap: 12 }}>
            <label className="field" style={{ flex: 1 }}><span>截止日期</span><input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} /></label>
            <label className="field" style={{ flex: 1 }}><span>截止时间</span><input type="time" value={dueTime} onChange={e => setDueTime(e.target.value)} /></label>
          </div>
          <div style={{ display: 'flex', gap: 12 }}>
            <label className="field" style={{ flex: 1 }}>
              <span>优先级</span>
              <GlassSelect label="优先级" value={priority} options={Object.entries(PRIORITY_LABEL).map(([value,label])=>({value,label}))} onChange={setPriority}/>
            </label>
            <label className="field" style={{ flex: 1 }}>
              <span>清单</span>
              <input value={list} onChange={e => setList(e.target.value)} placeholder="工作/生活/学习..." />
            </label>
          </div>
          <PlanEntityFields context={entityContext} value={planEntities} onChange={setPlanEntities}/>
          {/* 子任务 */}
          <div className="field">
            <span>子任务</span>
            <div className="todo-subtasks-edit">
              {subtasks.map((st, i) => (
                <div key={st.id} className="todo-subtask-row">
                  <input type="checkbox" checked={st.done} onChange={() => {
                    const next = [...subtasks]; next[i] = { ...st, done: !st.done }; setSubtasks(next);
                  }} />
                  <input value={st.title} placeholder="子步骤" onChange={e => {
                    const next = [...subtasks]; next[i] = { ...st, title: e.target.value }; setSubtasks(next);
                  }} />
                  <button className="square-button" onClick={() => setSubtasks(subtasks.filter((_, j) => j !== i))}>
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
              <button className="quiet-button" onClick={addSubtask}><Plus size={14} />添加子任务</button>
            </div>
          </div>
        </div>
        <div className="todo-modal-footer">
          <button className="quiet-button" disabled={busy} onClick={onClose}>取消</button>
          <button className="quiet-button" disabled={busy || !title.trim()} onClick={save}>保存</button>
        </div>
      </div>
    </PlanDialog>
  );
}

export function TodoPanel({ date, source, prepare, changed, onOpen, onClose, revision = 0, focusId, toolbarAction, onExpand, fullscreen, onToggleFullscreen, entityContext }: {
  entityContext: EntityContext;
  date: string; source?: RecordRef; revision?: number; focusId?: string;
  toolbarAction?: { kind: "create" | "filters"; id: number }; onExpand?: () => void; fullscreen?: boolean; onToggleFullscreen?: () => void;
  prepare: (targetDate?: string) => Promise<string | undefined>;
  changed: () => Promise<void>;
  onOpen: (ref: RecordRef) => void;
  onClose: () => void;
}) {
  const {categories,reorder:reorderCategories}=usePlanCategories();
  const [addingCategory,setAddingCategory]=useState(false);
  const confirmation=useGlassConfirm();
  const [showFilters, setShowFilters] = useState(false);
  const createPlan = (category?: string) => { setQuickText(''); setCreateId(crypto.randomUUID()); setParsed({title:'',dueDate:'',dueTime:'',priority:'medium',list:'',tags:[],category:category||undefined}); };
  useEffect(() => { if(toolbarAction?.kind==='create')createPlan(); if(toolbarAction?.kind==='filters')setShowFilters(true); }, [toolbarAction]);
  const [quickText, setQuickText] = useState('');
  const [parsed, setParsed] = useState<ParsedTodo | null>(null);
  const [sourceFilter, setSourceFilter] = useState('all');
  const [listFilter, setListFilter] = useState('');
  const [createId, setCreateId] = useState(() => crypto.randomUUID());
  const [rows, setRows] = useState<ActionRow[]>([]);
  const [filter, setFilter] = useState<PlanFilter>('all');
  const [layout, setLayout] = useState<'board'|'list'|'windows'>('board');
  const [categoryFilter,setCategoryFilter] = useState('all');
  const [viewFilter,setViewFilter] = useState('');
  const [views,setViews] = useState<PlanView[]>([]);
  const [retryMove,setRetryMove] = useState<{row:ActionRow;patch:Classification}>();
  const [batch,setBatch] = useState<Classification>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<ActionRow | null>(null);
  const [completing, setCompleting] = useState<ActionRow | null>(null);

  const [, tick] = useState(0);
  useEffect(() => { const timer = window.setInterval(() => tick(n => n + 1), 60000); return () => clearInterval(timer); }, []);
  const refresh = async () => setRows((await api.actions()).tasks);
  useEffect(() => { void refresh().catch(() => setError('计划读取失败，请重试。')); }, [revision]);
  useEffect(() => { if (focusId) { setFilter('all'); setSourceFilter('all'); setListFilter(''); } }, [focusId, revision]);
  useEffect(() => { let active = true; if (source) { setQuickText(source.summary); setParsed({title: source.summary, dueDate:'',dueTime:'',priority:'medium',list:'',tags:[]}); setCreateId(crypto.randomUUID()); void api.loadDiary(source.date).then(({document}) => { const event = source.kind === 'facts' ? document.facts.events.find(e=>e.id===source.id) : undefined; const entry = source.kind !== 'facts' && source.kind !== 'todo' ? document.entries?.[source.kind].find(e=>e.id===source.id) : undefined; const entities = event ? [...event.people,...event.places,...event.activities,...event.foods] : entry?.sources || []; if(active) setParsed(p=>p && p.entities === undefined ? {...p,entities} : p); }).catch(()=>{}); } return ()=>{active=false}; }, [source]);

  const run = async (input: ActionInput) => {
    setBusy(true); setError('');
    try {
      const ownVersion = await prepare(input.date);
      await api.changeAction({ ...input, version: ownVersion || input.version });
      await refresh();
      await changed();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存失败，请重试。');
      return false;
    } finally {
      setBusy(false);
    }
  };

  const act = (row: ActionRow, mode: ActionInput['mode'], task?: Todo, extra?: Partial<ActionInput>) =>
    run({ mode, date: row.date, version: row.version, task: task || row.task, operationId: crypto.randomUUID(), ...extra });

  const confirmCreate = async () => {
    if (!parsed || busy) return;
    setBusy(true); setError('');
    try {
      await prepare(source?.date || date);
      const owner = await api.loadDiary(source?.date || date);
      const sourceEvent = source?.kind === 'facts' ? owner.document.facts.events.find(e => e.id === source.id) : undefined;
      const sourceEntry = source && source.kind !== 'facts' && source.kind !== 'todo' ? owner.document.entries?.[source.kind].find(e => e.id === source.id) : undefined;
      const task: Todo = {
        category:parsed.category, important:parsed.important, urgent:parsed.urgent, startDate:parsed.startDate, startTime:parsed.startTime,
        entities: parsed.entities ?? (sourceEvent ? [...sourceEvent.people, ...sourceEvent.places, ...sourceEvent.activities, ...sourceEvent.foods] : sourceEntry?.sources),
        id: createId,
        title: parsed.title.trim(),
        done: false,
        status: 'todo',
        time: parsed.dueTime,
        plannedDate: parsed.dueDate,
        dueDate: parsed.dueDate,
        dueTime: parsed.dueTime,
        priority: parsed.priority,
        list: parsed.list,
        tags: parsed.tags,
        description: parsed.description || '',
        subtasks: [],
        repeat: null,
        attachments: [],
        createdAt: new Date().toISOString(),
        source,
      };
      if (await run({ mode: 'create', date: owner.document.date, version: owner.version, sourceVersion: owner.version, task, operationId: crypto.randomUUID() })) {
        setQuickText('');
        setParsed(null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '创建失败');
    } finally {
      setBusy(false);
    }
  };

  // Restoring removes the linked completion fact and starts a new completion cycle.
  const onCheck = async (row: ActionRow) => {
    if (row.task.done || row.restorePending) {
      if (row.task.completion?.kind !== 'facts' || await confirmation.confirm('恢复计划将删除这项计划自动生成的完成事实，并恢复为待开始。继续？')) {
        void act(row, 'restore');
      }
    } else {
      void act(row,'complete',undefined,{automaticRecord:true});
    }
  };

  const onEdit = (row: ActionRow) => setEditing(row);
  const onDelete = async (row: ActionRow) => {
    if(row.task.deletedAt){if(await confirmation.confirm('永久删除此计划？关联日记仍保留。'))void act(row,'purge');return;}
    if (await confirmation.confirm('删除此计划？（移入回收站，可恢复）')) {
      void act(row, 'delete');
    }
  };

  const onStatus = async (row: ActionRow, status: 'todo' | 'doing' | 'done' | 'cancelled') => {
    if ((status === 'todo' || status === 'doing') && row.task.completion?.kind === 'facts' && !await confirmation.confirm('撤销完成将删除这项计划关联的完成事实。继续？')) return;
    if (status === 'done') void act(row,'complete',undefined,{automaticRecord:true}); else void act(row, 'status', row.task, { nextStatus: status });
  };

  const saveEdit = (updated: Todo) => {
    if (!editing) return;
    void act(editing, 'update', updated).then(ok => { if (ok) setEditing(null); });
  };

  const finish = async (record: CaptureDraft | undefined, operationId: string) => {
    if (!completing || busy) return false;
    const row = rows.find(r => r.date === completing.date && r.task.id === completing.task.id) || completing;
    setBusy(true); setError('');
    try {
      const savedVersion = record ? await prepare(record.date) : undefined;
      const target = record ? await api.loadDiary(record.date) : undefined;
      const ok = await run({ mode: 'complete', date: row.date, version: record?.date === row.date && savedVersion ? savedVersion : row.version, task: row.task, operationId,
        ...(record && target ? { completionRecord: { ...record, kind: record.kind === 'plan' ? 'facts' : record.kind, version: target.version } } : {}) });
      if (ok) setCompleting(null);
      return ok;
    } catch(e) { setError(e instanceof Error ? e.message : '保存失败'); return false; }
    finally { setBusy(false); }
  };
  const visible = rows.filter(r => matchesPlan(r.task, filter))
    .filter(r=>categoryFilter==='all'||r.task.category===categoryFilter)
    .filter(r=>!viewFilter||views.find(v=>v.id===viewFilter)?.tags.some(tag=>r.task.tags.includes(tag)))
    .filter(r => sourceFilter === 'all' || (sourceFilter === 'diary' ? !!r.task.source : !r.task.source))
    .filter(r => !listFilter || r.task.list === listFilter)
    .sort((a,b) => ((a.task.dueDate || a.task.plannedDate || '9999') + (a.task.dueTime || a.task.time)).localeCompare((b.task.dueDate || b.task.plannedDate || '9999') + (b.task.dueTime || b.task.time)));

  const move=async(row:ActionRow,patch:Classification)=>{
    if(busy)return;
    setRetryMove({row,patch});
    try {
      const latest=(await api.actions()).tasks.find(r=>r.task.id===row.task.id&&r.date===row.date);
      if(!latest)throw new Error('该计划已不存在，请刷新');
      if(await act(latest,'update',{...latest.task,...patch}))setRetryMove(undefined);
    } catch(e) { setError(e instanceof Error?e.message:'归类失败，请重试'); }
  };
  const batchSave=async()=>{
    if(!batch||busy)return;setBusy(true);setError('');
    try{for(const row of visible.filter(r=>quadrant(r.task)==='unclassified'&&!r.task.deletedAt)){
      await prepare(row.date);const latest=(await api.actions()).tasks.find(r=>r.date===row.date&&r.task.id===row.task.id);if(!latest)continue;
      await api.changeAction({mode:'update',date:latest.date,version:latest.version,task:{...latest.task,...batch},operationId:crypto.randomUUID()});
    }await refresh();await changed();setBatch(undefined);}catch(e){setError(`批量归类部分未完成：${e instanceof Error?e.message:'请重试'}`);await refresh();}finally{setBusy(false);}
  };
  const rangeLabels: Record<PlanFilter,string> = {all:'全部',today:'今日',upcoming:'即将开始',done:'已完成',trash:'回收站',overdue:'逾期'};
  const hasExtraFilters = sourceFilter !== 'all' || !!listFilter || !!viewFilter;
  const hasUnclassified = visible.some(r=>quadrant(r.task)==='unclassified'&&!r.task.deletedAt);
  const categoryControls = <nav className="plan-category-tabs" aria-label="事项类别">{[{id:'all',name:'全部',color:''},...categories].map(c=><button type="button" key={c.id} style={categoryStyle(c.color)} data-custom-category={c.id.startsWith('cat-')} data-plan-drop={c.id==='all'?undefined:'category:'+c.id} aria-pressed={categoryFilter===c.id} className={`category-${c.id}`} onClick={()=>setCategoryFilter(c.id)}>{c.name}</button>)}<button type="button" className="plan-category-add" aria-label="添加计划类别" title="添加类别" onClick={()=>setAddingCategory(true)}><Plus size={16}/></button></nav>;
  const filterControls = <><section className="plan-filter-section"><h3>时间与状态</h3><nav className="todo-filters" aria-label="计划范围">{(['all','today','upcoming','overdue','done','trash'] as const).map(key=><button type="button" key={key} className="quiet-button" aria-pressed={filter===key} onClick={()=>setFilter(key)}>{rangeLabels[key]}</button>)}</nav></section>
    <section className="plan-filter-section"><h3>来源与清单</h3><div className="capture-row plan-source-filters"><label>来源<GlassSelect label="来源" value={sourceFilter} onChange={setSourceFilter} options={[{value:'all',label:'全部来源'},{value:'self',label:'自主创建'},{value:'diary',label:'来自日记'}]}/></label><label>清单<GlassSelect label="清单" value={listFilter} onChange={setListFilter} options={[{value:'',label:'全部清单'},...[...new Set(rows.map(r=>r.task.list).filter(Boolean))].map(value=>({value,label:value}))]}/></label></div></section>
    <section className="plan-filter-section"><h3>标签视图</h3><PlanViews active={viewFilter} onSelect={setViewFilter} onLoad={setViews}/></section>
    {hasUnclassified&&<button type="button" className="quiet-button plan-batch-button" onClick={()=>{setShowFilters(false);setBatch({category:null,important:null,urgent:null});}}>批量归类</button>}</>;
  const renderItem=(row:ActionRow,handle?:ReactNode)=><TodoItem key={`${row.date}:${row.task.id}`} row={row} busy={busy} handle={handle} onMove={(r,p)=>void move(r,p)} onCheck={r=>r.task.deletedAt?void act(r,'restore'):onCheck(r)} onEdit={onEdit} onDelete={onDelete} onStatus={onStatus} onOpenSource={onOpen} onOpenCompletion={r=>{if(r.pendingRecord&&!r.completionPending)setCompleting(r);else void act(r,'complete',undefined,{automaticRecord:true});}}/>;
  return (
    <section className="panel-section todo-panel" data-fullscreen={fullscreen ? 'true' : undefined} aria-labelledby="todo-title">
      {confirmation.dialog}
      {addingCategory&&<AddPlanCategory onClose={()=>setAddingCategory(false)}/>}
      <div className="section-heading">
        <div>
          <ListTodo />
          <div>
            <h2 id="todo-title">我的计划</h2>
            <p>从记录出发，完成后留下真正发生的事。</p>
          </div>
        </div>
        <button type="button" className="plan-add-button" aria-label="新增计划" title="新增计划" onClick={()=>createPlan()}><Plus size={21}/></button>
      </div>

      {source && (
        <p style={{ color: 'var(--muted)', fontSize: 13 }}>
          来源：{source.summary}
          <button className="quiet-button" onClick={() => onOpen(source)}>查看原记录</button>
        </p>
      )}

      {/* 进度统计 — 可点击过滤 */}
      <TodoStats rows={rows} filter={filter} onFilter={setFilter} />
      {retryMove&&<p role="status" className="plan-retry">分类选择已保留。<button disabled={busy} onClick={()=>void move(retryMove.row,retryMove.patch)}>重试归类</button><button onClick={()=>setRetryMove(undefined)}>取消</button></p>}

      {error && (
        <div role="alert" style={{ color: 'var(--red)', padding: '8px 12px', background: 'var(--red-soft)', borderRadius: 10, marginTop: 8 }}>
          <p style={{ margin: 0 }}>{error}</p>
          <button className="quiet-button" disabled={busy} onClick={() => void refresh().catch(() => setError('刷新失败，请检查连接。'))}>刷新版本，保留输入</button>
        </div>
      )}

      <div className="plan-browse-tools">
        {categoryControls}
        <div className="plan-content-toolbar">
          <button type="button" className={`quiet-button plan-filter-trigger${hasExtraFilters?' has-extra-filters':''}`} aria-label="筛选计划" aria-haspopup="dialog" onClick={()=>setShowFilters(true)}><SlidersHorizontal size={16}/><span>{rangeLabels[filter]}</span>{hasExtraFilters&&<span className="plan-filter-dot" aria-label="已应用其他筛选"/>}<ChevronDown size={14}/></button>
          <span className="plan-range-label">{rangeLabels[filter]}{hasExtraFilters?' · 已筛选':''}</span>
          <nav className="plan-view-switch" aria-label="计划视图"><button type="button" aria-pressed={layout==='board'&&filter!=='trash'} disabled={filter==='trash'} title={filter==='trash'?'回收站以列表显示':'四象限'} onClick={()=>setLayout('board')}>四象限</button><button type="button" aria-pressed={layout==='windows'&&filter!=='trash'} disabled={filter==='trash'} title={filter==='trash'?'回收站以列表显示':'窗口'} onClick={()=>setLayout('windows')}>窗口</button><button type="button" aria-pressed={layout==='list'||filter==='trash'} onClick={()=>setLayout('list')}>列表</button></nav>
        </div>
      </div>
      {showFilters&&<PlanDialog label="筛选计划" busy={false} onClose={()=>setShowFilters(false)}><div className="compact-sheet"><header><div><h2>筛选计划</h2><p>调整筛选后，继续浏览当前视图。</p></div><button className="square-button" aria-label="关闭计划筛选" onClick={()=>setShowFilters(false)}><X size={20}/></button></header><section className="plan-filter-section"><h3>事项类别</h3>{categoryControls}</section>{filterControls}<footer><button className="quiet-button" onClick={()=>{setFilter('all');setCategoryFilter('all');setSourceFilter('all');setListFilter('');setViewFilter('');}}>重置筛选</button><button className="save-button" onClick={()=>setShowFilters(false)}>显示 {visible.length} 项</button><button className="quiet-button" onClick={()=>{setShowFilters(false);onExpand?.();}}>展开完整顶部</button></footer></div></PlanDialog>}

      {/* 计划列表 */}
      {filter==='trash'||layout==='list'?<ul className="todo-list plan-list-view">
        {visible.map(row => (
          <TodoItem
            onMove={(r,p)=>void move(r,p)}
            key={`${row.date}:${row.task.id}`}
            row={row}
            busy={busy}
            onCheck={r => r.task.deletedAt ? void act(r,'restore') : onCheck(r)}
            onEdit={onEdit}
            onDelete={onDelete}
            onStatus={onStatus}
            onOpenSource={onOpen}
            onOpenCompletion={r => { if(r.pendingRecord&&!r.completionPending)setCompleting(r);else void act(r,'complete',undefined,{automaticRecord:true}); }}
          />
        ))}
      </ul>:layout==='windows'?<PlanWindows rows={visible} categories={categories} busy={busy} render={renderItem} onMove={(r,p)=>void move(r,p)} onCreate={categoryId=>createPlan(categoryId)} onAddCategory={()=>setAddingCategory(true)} onReorder={reorderCategories}/>:<PlanBoard rows={visible} busy={busy} render={renderItem} onMove={(r,p)=>void move(r,p)}/>}
      {batch&&<PlanDialog busy={busy} onClose={()=>setBatch(undefined)}><div className="todo-modal"><div className="todo-modal-header"><h3>批量归类</h3><p>仅修改当前筛选范围内的待分类事项。</p></div><div className="todo-modal-body"><ClassificationFields value={batch} start={false} onChange={patch=>setBatch({...batch,...patch})}/></div><div className="todo-modal-footer"><button className="quiet-button" disabled={busy} onClick={()=>setBatch(undefined)}>取消</button><button className="save-button" disabled={busy||!batch.category||typeof batch.important!=='boolean'||typeof batch.urgent!=='boolean'} onClick={()=>void batchSave()}>应用分类</button></div></div></PlanDialog>}

      {!visible.length && <p className="todo-empty">此范围暂无计划。可以从一条记录创建行动，也可以直接在上方添加。</p>}

      {/* AI 识别预览模态框 */}
      {parsed && (
        <ParsePreviewModal
          entityContext={entityContext}
          text={quickText}
          parsed={parsed}
          busy={busy}
          onConfirm={confirmCreate}
          onEdit={patch => setParsed(p => p ? { ...p, ...patch } : p)}
          onClose={() => setParsed(null)}
        />
      )}

      {/* 修改模态框 */}
      {editing && (
        <EditModal
          entityContext={entityContext}
          row={editing}
          busy={busy}
          onSave={saveEdit}
          onClose={() => setEditing(null)}
        />
      )}

      {/* 完成模态框 */}
      {completing && (
        <PlanCompletion
          row={completing}
          busy={busy}
          onFinish={finish}
          onClose={() => setCompleting(null)}
        />
      )}
    </section>
  );
}
