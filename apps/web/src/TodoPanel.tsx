import { useEffect, useState } from 'react';
import { ListTodo, Plus, Trash2, X, Clock, Calendar, Check, Pencil, RotateCcw, Link2, CheckCircle2, Sparkles, Flag, Tag, ChevronDown } from 'lucide-react';
import type { RecordRef, Todo } from '@diary/contracts';
import { api, type ActionRow, type ActionInput, type ParsedTodo } from './api';
import { today } from './date';
import './todos.css';

const PRIORITY_LABEL: Record<string, string> = { high: '高', medium: '中', low: '低' };
const PRIORITY_COLOR: Record<string, string> = { high: '#bd3d4c', medium: '#b8860b', low: '#6b7280' };
const STATUS_LABEL: Record<string, string> = { todo: '待办', doing: '进行中', done: '已完成', cancelled: '已取消' };

/** 进度统计 — 可点击切换过滤 */
function TodoStats({ rows, filter, onFilter }: {
  rows: ActionRow[];
  filter: 'open' | 'date' | 'done' | 'overdue' | 'today';
  onFilter: (f: 'open' | 'date' | 'done' | 'overdue' | 'today') => void;
}) {
  const t = today();
  const active = rows.filter(r => !r.task.done && !r.task.deletedAt);
  const done = rows.filter(r => r.task.done);
  const overdue = active.filter(r => r.task.dueDate && r.task.dueDate < t);
  const todayCount = rows.filter(r => r.task.dueDate === t || r.task.plannedDate === t);
  const chip = (active2: boolean, count: number, label: string, cls: string, target: 'open' | 'date' | 'done' | 'overdue' | 'today') => (
    <button className={`todo-stat-chip ${cls} ${active2 ? 'active' : ''}`} onClick={() => onFilter(target)} aria-pressed={active2}>
      <strong>{count}</strong> {label}
    </button>
  );
  return (
    <div className="todo-stats">
      {chip(filter === 'open', active.length, '待完成', '', 'open')}
      {overdue.length > 0 && chip(filter === 'overdue', overdue.length, '已逾期', 'overdue', 'overdue')}
      {todayCount.length > 0 && chip(filter === 'today', todayCount.length, '今日', '', 'today')}
      {chip(filter === 'done', done.length, '已完成', 'done', 'done')}
    </div>
  );
}

/** 优先级标签 */
function PriorityBadge({ priority }: { priority: string }) {
  return (
    <span className="todo-priority" style={{ color: PRIORITY_COLOR[priority] || '#6b7280', borderColor: PRIORITY_COLOR[priority] || '#6b7280' }}>
      <Flag size={11} />{PRIORITY_LABEL[priority] || priority}
    </span>
  );
}

/** 标签 chips */
function TagChips({ tags }: { tags: string[] }) {
  if (!tags?.length) return null;
  return (
    <div className="todo-tags">
      {tags.slice(0, 4).map(tag => (
        <span key={tag} className="todo-tag"><Tag size={10} />{tag}</span>
      ))}
    </div>
  );
}

/** 单个待办卡片 */
function TodoItem({ row, busy, onCheck, onEdit, onDelete, onStatus, onOpenSource, onOpenCompletion }: {
  row: ActionRow; busy: boolean;
  onCheck: (row: ActionRow) => void;
  onEdit: (row: ActionRow) => void;
  onDelete: (row: ActionRow) => void;
  onStatus: (row: ActionRow, status: 'todo' | 'doing' | 'done' | 'cancelled') => void;
  onOpenSource: (ref: RecordRef) => void;
  onOpenCompletion: (row: ActionRow) => void;
}) {
  const t = today();
  const due = row.task.dueDate || row.task.plannedDate || '';
  const overdue = !row.task.done && due && due < t;
  const status = row.task.status || (row.task.done ? 'done' : 'todo');
  const [showStatus, setShowStatus] = useState(false);
  return (
    <li
      key={`${row.date}:${row.task.id}`}
      data-record-id={row.task.id}
      className={[
        row.task.done ? 'todo-done' : '',
        overdue ? 'todo-overdue' : '',
      ].filter(Boolean).join(' ')}
    >
      <label className="todo-check">
        <input
          type="checkbox"
          checked={row.task.done}
          disabled={busy}
          aria-label={`完成：${row.task.title}`}
          onChange={() => onCheck(row)}
        />
      </label>

      <div className="todo-copy">
        <div className="todo-title-row">
          <strong className="todo-title">{row.task.title}</strong>
          <PriorityBadge priority={row.task.priority} />
        </div>

        {row.task.description && <p className="todo-desc">{row.task.description}</p>}

        <TagChips tags={row.task.tags} />

        <div className="todo-meta">
          <span className="todo-planned">
            <Calendar size={13} />
            {due || '未设日期'}
            {row.task.dueTime && <><Clock size={13} />{row.task.dueTime}</>}
          </span>
          {row.task.list && <span className="todo-list-chip">{row.task.list}</span>}
          <span>创建于 {row.date}</span>
          {overdue && <span className="todo-overdue-tag">已逾期</span>}
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
              <CheckCircle2 size={12} />{row.completionExists ? '查看完成记录' : '完成记录已删除'}
            </button>
          )}
        </div>

        {/* 操作按钮 */}
        <div className="todo-actions">
          {!row.task.done && (
            <button className="quiet-button" disabled={busy} onClick={() => onOpenCompletion(row)}>
              <Check size={15} />完成
            </button>
          )}
          {/* 状态切换下拉 */}
          <div className="todo-status-wrap">
            <button className="quiet-button" disabled={busy} onClick={() => setShowStatus(s => !s)}>
              {STATUS_LABEL[status]} <ChevronDown size={12} />
            </button>
            {showStatus && (
              <div className="todo-status-menu" onClick={() => setShowStatus(false)}>
                {(['todo', 'doing', 'done', 'cancelled'] as const).map(s => (
                  <button key={s} className="todo-status-item" onClick={() => onStatus(row, s)}>
                    {STATUS_LABEL[s]}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button className="quiet-button" disabled={busy} onClick={() => onEdit(row)}>
            <Pencil size={15} />修改
          </button>
          {row.task.done && (
            <button className="quiet-button" disabled={busy} onClick={() => onCheck(row)}>
              <RotateCcw size={15} />恢复
            </button>
          )}
        </div>

        {row.pendingFact && (
          <p role="status" style={{ color: 'var(--purple-ink)', fontSize: 12, marginTop: 4 }}>
            事实已写入，待确认。
            <button className="quiet-button" onClick={() => onOpenCompletion(row)}>恢复保存</button>
          </p>
        )}
      </div>

      <button className="square-button" disabled={busy} aria-label={`删除待办：${row.task.title}`} onClick={() => onDelete(row)}>
        <Trash2 size={17} />
      </button>
    </li>
  );
}

/** AI 识别预览模态框 */
function ParsePreviewModal({ text, parsed, busy, onConfirm, onEdit, onClose }: {
  text: string;
  parsed: ParsedTodo | null;
  busy: boolean;
  onConfirm: () => void;
  onEdit: (patch: Partial<ParsedTodo>) => void;
  onClose: () => void;
}) {
  if (!parsed) return null;
  return (
    <div className="todo-modal-overlay" onClick={onClose}>
      <div className="todo-modal" onClick={e => e.stopPropagation()}>
        <div className="todo-modal-header">
          <h3><Sparkles size={18} style={{ color: 'var(--purple)' }} /> AI 识别结果</h3>
          <p>已自动提取属性，可直接修改后创建</p>
        </div>
        <div className="todo-modal-body">
          <label className="field">
            <span>标题</span>
            <input value={parsed.title} maxLength={2000} onChange={e => onEdit({ title: e.target.value })} />
          </label>
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
              <select value={parsed.priority} onChange={e => onEdit({ priority: e.target.value })}>
                <option value="high">高</option>
                <option value="medium">中</option>
                <option value="low">低</option>
              </select>
            </label>
            <label className="field" style={{ flex: 1 }}>
              <span>清单</span>
              <input value={parsed.list} onChange={e => onEdit({ list: e.target.value })} placeholder="工作/生活/学习..." />
            </label>
          </div>
          <label className="field">
            <span>标签（逗号分隔）</span>
            <input value={parsed.tags.join(', ')} onChange={e => onEdit({ tags: e.target.value.split(/[,，]/).map(s => s.trim()).filter(Boolean) })} />
          </label>
        </div>
        <div className="todo-modal-footer">
          <button className="quiet-button" disabled={busy} onClick={onClose}>取消</button>
          <button className="quiet-button" disabled={busy || !parsed.title.trim()} onClick={onConfirm}>
            <Check size={15} />确认创建
          </button>
        </div>
      </div>
    </div>
  );
}

/** 修改安排模态框（完整属性） */
function EditModal({ row, busy, onSave, onClose }: {
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
  const [subtasks, setSubtasks] = useState(row.task.subtasks || []);

  const save = () => {
    const tags = tagsInput.split(/[,，]/).map(s => s.trim()).filter(Boolean);
    const updated: Todo = {
      ...row.task,
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
    };
    onSave(updated);
  };

  const addSubtask = () => setSubtasks([...subtasks, { id: crypto.randomUUID(), title: '', done: false }]);

  return (
    <div className="todo-modal-overlay" onClick={onClose}>
      <div className="todo-modal todo-modal-large" onClick={e => e.stopPropagation()}>
        <div className="todo-modal-header">
          <h3>编辑待办</h3>
          <p>修改任务属性</p>
        </div>
        <div className="todo-modal-body">
          <label className="field"><span>标题</span><input value={title} maxLength={2000} onChange={e => setTitle(e.target.value)} /></label>
          <label className="field"><span>详情描述</span><textarea rows={2} value={description} onChange={e => setDescription(e.target.value)} placeholder="补充说明" /></label>
          <div style={{ display: 'flex', gap: 12 }}>
            <label className="field" style={{ flex: 1 }}><span>计划日期</span><input type="date" value={plannedDate} onChange={e => setPlannedDate(e.target.value)} /></label>
            <label className="field" style={{ flex: 1 }}><span>计划时间</span><input type="time" value={time} onChange={e => setTime(e.target.value)} /></label>
          </div>
          <div style={{ display: 'flex', gap: 12 }}>
            <label className="field" style={{ flex: 1 }}><span>截止日期</span><input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} /></label>
            <label className="field" style={{ flex: 1 }}><span>截止时间</span><input type="time" value={dueTime} onChange={e => setDueTime(e.target.value)} /></label>
          </div>
          <div style={{ display: 'flex', gap: 12 }}>
            <label className="field" style={{ flex: 1 }}>
              <span>优先级</span>
              <select value={priority} onChange={e => setPriority(e.target.value)}>
                <option value="high">高</option>
                <option value="medium">中</option>
                <option value="low">低</option>
              </select>
            </label>
            <label className="field" style={{ flex: 1 }}>
              <span>清单</span>
              <input value={list} onChange={e => setList(e.target.value)} placeholder="工作/生活/学习..." />
            </label>
          </div>
          <label className="field">
            <span>标签（逗号分隔）</span>
            <input value={tagsInput} onChange={e => setTagsInput(e.target.value)} placeholder="方案, 沟通, 外出" />
          </label>
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
    </div>
  );
}

/** 完成确认模态框 */
function CompletionModal({ row, busy, onFinish, onClose }: {
  row: ActionRow; busy: boolean;
  onFinish: (withFact: boolean, actualDate: string, actualTime: string, note: string, remark: string, operationId: string) => void;
  onClose: () => void;
}) {
  const [actualDate, setActualDate] = useState(row.pendingFact?.date || today());
  const [actualTime, setActualTime] = useState(row.pendingFact?.time || new Date().toTimeString().slice(0, 5));
  const [note, setNote] = useState(row.pendingFact?.note || row.task.title);
  const [remark, setRemark] = useState(row.pendingFact?.remark || '');
  const [operationId] = useState(() => row.pendingFact?.id || crypto.randomUUID());

  return (
    <div className="todo-modal-overlay" onClick={onClose}>
      <div className="todo-modal" onClick={e => e.stopPropagation()}>
        <div className="todo-modal-header">
          <h3>实际发生了什么？</h3>
          <p>默认当前时间，请确认；不会使用计划时间。</p>
        </div>
        <div className="todo-modal-body">
          <div style={{ display: 'flex', gap: 12 }}>
            <label className="field" style={{ flex: 1 }}><span>实际日期</span><input type="date" value={actualDate} onChange={e => setActualDate(e.target.value)} /></label>
            <label className="field" style={{ flex: 1 }}><span>实际时间</span><input type="time" value={actualTime} onChange={e => setActualTime(e.target.value)} /></label>
          </div>
          <label className="field"><span>事实描述</span><textarea rows={3} value={note} onChange={e => setNote(e.target.value)} placeholder="实际做了什么" /></label>
          <label className="field"><span>结果或备注</span><textarea rows={2} value={remark} onChange={e => setRemark(e.target.value)} placeholder="可选：结果、感受" /></label>
        </div>
        <div className="todo-modal-footer">
          <button className="quiet-button" disabled={busy} onClick={onClose}>取消</button>
          <button className="quiet-button" disabled={busy} onClick={() => onFinish(false, actualDate, actualTime, note, remark, operationId)}>仅完成</button>
          <button
            className="quiet-button"
            disabled={busy || !note.trim() || !actualDate || !!row.task.completion}
            onClick={() => onFinish(true, actualDate, actualTime, note, remark, operationId)}
          >完成并记入日记</button>
        </div>
      </div>
    </div>
  );
}

export function TodoPanel({ date, source, prepare, changed, onOpen, onClose }: {
  date: string; source?: RecordRef;
  prepare: () => Promise<void>;
  changed: () => Promise<void>;
  onOpen: (ref: RecordRef) => void;
  onClose: () => void;
}) {
  const [quickText, setQuickText] = useState('');
  const [parsed, setParsed] = useState<ParsedTodo | null>(null);
  const [parsing, setParsing] = useState(false);
  const [rows, setRows] = useState<ActionRow[]>([]);
  const [filter, setFilter] = useState<'open' | 'date' | 'done' | 'overdue' | 'today'>('open');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<ActionRow | null>(null);
  const [completing, setCompleting] = useState<ActionRow | null>(null);

  const refresh = async () => setRows((await api.actions()).tasks);
  useEffect(() => { void refresh().catch(() => setError('待办读取失败，请重试。')); }, []);

  const run = async (input: ActionInput) => {
    setBusy(true); setError('');
    try {
      await prepare();
      await api.changeAction(input);
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

  // 极速创建：回车 → AI 解析
  const onQuickSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = quickText.trim();
    if (!text || parsing || busy) return;
    setParsing(true); setError('');
    try {
      const result = await api.parseTodo(text);
      setParsed(result);
    } catch (e) {
      // AI 失败时降级为直接创建（仅标题）
      setParsed({ title: text, dueDate: '', dueTime: '', priority: 'medium', list: '', tags: [] });
    } finally {
      setParsing(false);
    }
  };

  const confirmCreate = async () => {
    if (!parsed || busy) return;
    setBusy(true); setError('');
    try {
      await prepare();
      const owner = await api.loadDiary(source?.date || date);
      const task: Todo = {
        id: crypto.randomUUID(),
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
        description: '',
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

  // 勾选：已完成 → restore；未完成 → 打开完成模态框
  const onCheck = (row: ActionRow) => {
    if (row.task.done) {
      if (!row.task.completion || window.confirm('恢复待办不会删除已经写下的事实。继续？')) {
        void act(row, 'restore');
      }
    } else {
      setCompleting(row);
    }
  };

  const onEdit = (row: ActionRow) => setEditing(row);
  const onDelete = (row: ActionRow) => {
    if (window.confirm('删除此待办？（移入回收站，可恢复）')) {
      void act(row, 'delete');
    }
  };

  const onStatus = (row: ActionRow, status: 'todo' | 'doing' | 'done' | 'cancelled') => {
    void act(row, 'status', row.task, { nextStatus: status });
  };

  const saveEdit = (updated: Todo) => {
    if (!editing) return;
    void act(editing, 'update', updated).then(ok => { if (ok) setEditing(null); });
  };

  const finish = (withFact: boolean, actualDate: string, actualTime: string, note: string, remark: string, operationId: string) => {
    if (!completing || busy) return;
    const row = rows.find(r => r.date === completing.date && r.task.id === completing.task.id) || completing;
    setBusy(true); setError('');
    (async () => {
      try {
        await prepare();
        const target = withFact ? await api.loadDiary(actualDate) : null;
        await run({
          mode: 'complete',
          date: row.date,
          version: row.version,
          task: row.task,
          operationId,
          ...(target ? { fact: { date: actualDate, version: target.version, time: actualTime, note, remark } } : {}),
        });
        setCompleting(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : '读取目标日记失败。');
      } finally {
        setBusy(false);
      }
    })();
  };

  const visible = rows
    .filter(r => !r.task.deletedAt)
    .filter(r => {
      if (filter === 'date') return r.date === date;
      if (filter === 'done') return r.task.done;
      if (filter === 'overdue') return !r.task.done && (r.task.dueDate || r.task.plannedDate) && (r.task.dueDate || r.task.plannedDate)! < today();
      if (filter === 'today') return (r.task.dueDate || r.task.plannedDate) === today();
      return !r.task.done; // open
    })
    .sort((a, b) => `${a.task.dueDate || a.task.plannedDate || '9999'} ${a.task.dueTime || a.task.time || '99:99'}`.localeCompare(`${b.task.dueDate || b.task.plannedDate || '9999'} ${b.task.dueTime || b.task.time || '99:99'}`));

  return (
    <section className="panel-section todo-panel" aria-labelledby="todo-title">
      <div className="section-heading">
        <div>
          <ListTodo />
          <div>
            <h2 id="todo-title">行动清单</h2>
            <p>从记录出发，完成后留下真正发生的事。</p>
          </div>
        </div>
        <button className="quiet-button" onClick={onClose}><X size={18} />返回记录</button>
      </div>

      {source && (
        <p style={{ color: 'var(--muted)', fontSize: 13 }}>
          来源：{source.summary}
          <button className="quiet-button" onClick={() => onOpen(source)}>查看原记录</button>
        </p>
      )}

      {/* 进度统计 — 可点击过滤 */}
      <TodoStats rows={rows} filter={filter} onFilter={setFilter} />

      {/* 极速创建输入框 */}
      <form className="todo-quick-add" onSubmit={onQuickSubmit}>
        <Sparkles size={16} style={{ color: 'var(--purple)' }} />
        <input
          value={quickText}
          onChange={e => setQuickText(e.target.value)}
          placeholder="快速创建：明天下午3点提交方案 高优先级（AI 自动识别）"
          disabled={parsing || busy}
        />
        <button type="submit" className="quiet-button" disabled={!quickText.trim() || parsing || busy}>
          {parsing ? '识别中...' : <><Plus size={16} />创建</>}
        </button>
      </form>

      {error && (
        <div role="alert" style={{ color: 'var(--red)', padding: '8px 12px', background: 'var(--red-soft)', borderRadius: 10, marginTop: 8 }}>
          <p style={{ margin: 0 }}>{error}</p>
          <button className="quiet-button" disabled={busy} onClick={() => void refresh().catch(() => setError('刷新失败，请检查连接。'))}>刷新版本，保留输入</button>
        </div>
      )}

      {/* 辅助过滤器：所选日期 */}
      <div className="todo-filters">
        <button className="quiet-button" aria-pressed={filter === 'date'} onClick={() => setFilter('date')}>
          所选日期的待办
        </button>
        {filter === 'date' && <button className="quiet-button" onClick={() => setFilter('open')}>显示全部未完成</button>}
      </div>

      {/* 待办列表 */}
      <ul className="todo-list">
        {visible.map(row => (
          <TodoItem
            key={`${row.date}:${row.task.id}`}
            row={row}
            busy={busy}
            onCheck={onCheck}
            onEdit={onEdit}
            onDelete={onDelete}
            onStatus={onStatus}
            onOpenSource={onOpen}
            onOpenCompletion={r => setCompleting(r)}
          />
        ))}
      </ul>

      {!visible.length && <p className="todo-empty">此范围暂无待办。可以从一条记录创建行动，也可以直接在上方添加。</p>}

      {/* AI 识别预览模态框 */}
      {parsed && (
        <ParsePreviewModal
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
          row={editing}
          busy={busy}
          onSave={saveEdit}
          onClose={() => setEditing(null)}
        />
      )}

      {/* 完成模态框 */}
      {completing && (
        <CompletionModal
          row={completing}
          busy={busy}
          onFinish={finish}
          onClose={() => setCompleting(null)}
        />
      )}
    </section>
  );
}
