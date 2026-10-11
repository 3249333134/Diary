import { PlanEntityFields, type EntityContext } from './PlanEntities';
import { useEffect, useRef, useState } from 'react';
import { captureDraftSchema, type CaptureDraft, type RecordRef } from '@diary/contracts';
import { Sparkles, X } from 'lucide-react';
import { api } from './api';
import { planClock } from './planFilters';
import './capture.css';
import { ClassificationFields, SharedTagInput } from './PlanFields';

export const CAPTURE_LABELS = { plan: '计划', facts: '事实', learn: '新知', input: '输入', idea: '灵感' };
export function DraftFields({ draft, onChange, diaryOnly = false, disabled = false, entityContext }: { entityContext?: EntityContext; draft: CaptureDraft; onChange: (draft: CaptureDraft) => void; diaryOnly?: boolean; disabled?: boolean }) {
  const patch = (value: Partial<CaptureDraft>) => onChange({ ...draft, ...value });
  const chooseKind = draft.needsReview && /手动草稿|AI 未能识别/.test(draft.reviewReason);
  return <fieldset className="capture-fields" disabled={disabled}>
    <div className="capture-row">
      <label>用途<select aria-label="用途" value={chooseKind ? '' : draft.kind} onChange={e => patch({ kind: e.target.value as CaptureDraft['kind'], date: e.target.value === 'plan' && chooseKind ? '' : draft.date || (e.target.value === 'plan' ? '' : planClock().date), needsReview: false })}><option value="" disabled>请选择用途</option>{Object.entries(CAPTURE_LABELS).filter(([key]) => !diaryOnly || key !== 'plan').map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
      <label>{draft.kind === 'plan' ? '截止日期（可留空）' : '实际日期'}<input type="date" value={draft.date} required={draft.kind !== 'plan'} onChange={e => patch({ date: e.target.value })} /></label>
      <label>{draft.kind === 'plan' ? '截止时间' : '实际时间'}<input type="time" value={draft.time} onChange={e => patch({ time: e.target.value })} /></label>
    </div>
    <label>{draft.kind === 'plan' ? '计划标题' : '正文'}<textarea rows={3} value={draft.content} onChange={e => patch({ content: e.target.value })} /></label>
    {draft.kind === 'plan' && <><label>说明<textarea rows={2} value={draft.description} onChange={e => patch({ description: e.target.value })} /></label><div className="capture-row"><label>优先级<select value={draft.priority} onChange={e => patch({ priority: e.target.value as CaptureDraft['priority'] })}><option value="high">高</option><option value="medium">中</option><option value="low">低</option></select></label><label>清单<input value={draft.list} onChange={e => patch({ list: e.target.value })} /></label></div></>}
    {draft.kind === 'plan' && <ClassificationFields value={draft} onChange={patch} />}
    {draft.kind !== 'plan' && <SharedTagInput value={draft.tags} onChange={tags => patch({ tags })} />}
    <details><summary>人物、地点、活动与食物</summary>{entityContext && draft.kind === 'plan' ? <PlanEntityFields includeThings={false} context={entityContext} value={Object.values(draft.entities).flat()} onChange={value => patch({entities:{people:value.filter(e=>e.type==='person').map(e=>({...e,type:'person' as const})),places:value.filter(e=>e.type==='place').map(e=>({...e,type:'place' as const})),activities:value.filter(e=>e.type==='activity').map(e=>({...e,type:'activity' as const})),foods:value.filter(e=>e.type==='food').map(e=>({...e,type:'food' as const}))}})}/> : <div className="capture-row">{(['people', 'places', 'activities', 'foods'] as const).map((key, i) => <label key={key}>{['人物', '地点', '活动', '食物'][i]}<input key={draft.entities[key].map(e => e.name).join('，')} defaultValue={draft.entities[key].map(e => e.name).join('，')} onBlur={e => patch({ entities: { ...draft.entities, [key]: e.target.value.split(/[,，]/).map(n => n.trim()).filter(Boolean).map(name => draft.entities[key].find(e => e.name === name) || { name, type: ['person', 'place', 'activity', 'food'][i], tags: [] }) } })} /></label>)}</div>}</details>
    {chooseKind ? <p role="status">{draft.reviewReason}</p> : draft.needsReview && <label className="capture-review"><input type="checkbox" checked={false} onChange={() => patch({ needsReview: false })} />确认用途与日期：{draft.reviewReason || '请检查后勾选确认'}</label>}
  </fieldset>;
}

type Row = { draft: CaptureDraft; submitted?: CaptureDraft; state: 'draft' | 'saving' | 'saved' | 'error'; error?: string; ref?: RecordRef };
export function UnifiedCapture({ onSave, onOpen, hidden = false, bottomNav = false, entityContext }: { entityContext?: EntityContext; hidden?: boolean; bottomNav?: boolean; onSave: (draft: CaptureDraft) => Promise<RecordRef>; onOpen: (ref: RecordRef) => void }) {
  const [expanded, setExpanded] = useState(false);
  const [mobile, setMobile] = useState(() => window.matchMedia('(max-width: 899px)').matches);
  const panel = useRef<HTMLElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const media = window.matchMedia('(max-width: 899px)');
    const update = () => { setMobile(media.matches); setExpanded(false); };
    media.addEventListener('change', update); return () => media.removeEventListener('change', update);
  }, []);
  useEffect(() => { if (hidden) setExpanded(false); }, [hidden]);
  const close = () => { setExpanded(false); trigger.current?.focus(); };
  useEffect(() => {
    if (!mobile || !expanded || hidden) return;
    const overflow = document.body.style.overflow; document.body.style.overflow = 'hidden';
    panel.current?.querySelector<HTMLTextAreaElement>('textarea')?.focus();
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); close(); }
      if (event.key === 'Tab') {
        const nodes = Array.from(panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), summary, [tabindex="0"]') || []).filter(el => el.getClientRects().length);
        const first = nodes[0], last = nodes[nodes.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    document.addEventListener('keydown', keyboard);
    return () => { document.body.style.overflow = overflow; document.removeEventListener('keydown', keyboard); };
  }, [mobile, expanded, hidden]);
  const [text, setText] = useState('');
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const parse = async () => {
    setBusy(true); setMessage('');
    try { const result = await api.parseCapture(text); setRows(result.drafts.map(draft => ({ draft, state: 'draft' }))); setMessage(result.mode === 'ai' ? 'AI 已整理，请逐条核对后保存。' : 'AI 暂不可用，原文已保留，请手动选择用途。'); }
    catch (error) {
      setMessage(error instanceof Error ? error.message : '识别失败，原文已保留。');
      setRows([{ draft: captureDraftSchema.parse({ id: crypto.randomUUID(), kind: 'facts', date: planClock().date, content: text, needsReview: true, reviewReason: 'AI 未能识别，请手动选择用途和日期' }), state: 'draft' }]);
    } finally { setBusy(false); }
  };
  const save = async (row: Row) => {
    const update = (patch: Partial<Row>) => setRows(old => old.map(r => r.draft.id === row.draft.id ? { ...r, ...patch } : r));
    update({ state: 'saving', error: undefined });
    try { const draft = captureDraftSchema.parse(row.submitted || row.draft); if (draft.needsReview) throw new Error('请先确认用途与日期'); update({ submitted: draft }); const ref = await onSave(draft); update({ state: 'saved', ref }); }
    catch (e) { update({ state: 'error', error: e instanceof Error ? e.message : '保存失败，草稿仍保留' }); }
  };
  return <div className={`capture-shell${bottomNav ? ' has-bottom-nav' : ''}${expanded ? ' capture-expanded' : ''}`} hidden={hidden}>
    <button ref={trigger} type="button" className="capture-mobile-trigger" aria-expanded={expanded} aria-controls="capture-panel" onClick={() => setExpanded(true)}><Sparkles size={19} /><span>AI · 记一句话 / 建计划</span>{(text || rows.some(r => r.state !== 'saved')) && <small>有草稿</small>}</button>
    {mobile && expanded && <button className="capture-backdrop" aria-label="收起 AI 录入" tabIndex={-1} onClick={close} />}
    <section ref={panel} id="capture-panel" className="unified-capture" aria-labelledby="capture-title" role={mobile && expanded ? 'dialog' : undefined} aria-modal={mobile && expanded ? true : undefined}>
    <button type="button" className="capture-mobile-close quiet-button" onClick={close}><X size={18} />收起</button>
    <h2 id="capture-title">先记下一句话</h2><p>记日记或建计划。输入与已知名称、标签会发送到你配置的 AI，整理后由你确认。</p>
    <label className="sr-only" htmlFor="capture-text">统一录入</label><textarea id="capture-text" rows={3} value={text} onChange={e => setText(e.target.value)} placeholder="今天和张三讨论了方案，明天下午三点再开会。" />
    <div className="capture-actions"><small>今天、明天均按现实日期理解 · 上海时间</small><button className="save-button" disabled={busy || !text.trim() || rows.some(r => r.state !== 'saved')} onClick={() => void parse()}>{busy ? '正在整理…' : '整理为草稿'}</button></div>
    {message && <p role="alert">{message}</p>}
    {rows.map((row, index) => <article className="capture-draft" key={row.draft.id}><h3>草稿 {index + 1} · {CAPTURE_LABELS[row.draft.kind]}</h3>{row.state !== 'saved' && <DraftFields entityContext={entityContext} draft={row.draft} disabled={!!row.submitted || row.state === 'saving'} onChange={draft => setRows(old => old.map(r => r === row ? { ...r, draft } : r))} />}{row.error && <p role="alert">{row.error}</p>}<div className="capture-actions">{row.state === 'saved' ? <><span role="status">已保存</span><button className="quiet-button" onClick={() => { if (row.ref) { close(); onOpen(row.ref); } }}>查看{row.draft.kind === 'plan' ? '计划' : '日记'}</button></> : <><button className="quiet-button" disabled={row.state === 'saving'} onClick={() => setRows(old => old.filter(r => r !== row))}>移除草稿</button><button className="save-button" disabled={row.state === 'saving' || row.draft.needsReview || rows.some(r => r.state === 'saving')} onClick={() => void save(row)}>{row.state === 'saving' ? '保存中…' : row.state === 'error' ? '重试此条' : '确认保存此条'}</button></>}</div></article>)}
  </section></div>;
}
