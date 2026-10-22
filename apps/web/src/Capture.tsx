import {validationMessage,fieldLimit} from '@diary/contracts';
import {FieldHint} from './FieldHint';
import {GlassSelect} from './GlassSelect';
import {GlassChoices} from './GlassChoices';
import { PlanEntityFields, type EntityContext } from './PlanEntities';
import { useEffect, useRef, useState } from 'react';
import { captureDraftSchema, type CaptureDraft, type RecordRef } from '@diary/contracts';
import { Sparkles, X, Maximize2, Minimize2 } from 'lucide-react';
import { api } from './api';
import { planClock } from './planFilters';
import './capture.css';
import { ClassificationFields, SharedTagInput } from './PlanFields';
import { DateTimeField } from './DateTimeField';
import { RepeatFields } from './RepeatFields';
import { VoiceInput } from './VoiceInput';

export const CAPTURE_LABELS = { plan: '计划', facts: '事实', learn: '新知', input: '输入', idea: '灵感' };
export function DraftFields({ draft, onChange, diaryOnly = false, disabled = false, entityContext }: { entityContext?: EntityContext; draft: CaptureDraft; onChange: (draft: CaptureDraft) => void; diaryOnly?: boolean; disabled?: boolean }) {
  const patch = (value: Partial<CaptureDraft>) => onChange({ ...draft, ...value });
  const chooseKind = draft.needsReview && /手动草稿|AI 未能识别/.test(draft.reviewReason);
  return <fieldset className="capture-fields" disabled={disabled}>
    <div className="capture-row">
      <label>用途<GlassSelect label="用途" value={chooseKind?'':draft.kind} placeholder="请选择用途" options={Object.entries(CAPTURE_LABELS).filter(([key])=>!diaryOnly||key!=='plan').map(([value,label])=>({value,label}))} onChange={kind=>patch({kind:kind as CaptureDraft['kind'],date:draft.date||planClock().date,time:draft.time||planClock().time,needsReview:false})}/></label>
      <DateTimeField label={draft.kind==='plan'?'截止时间':'发生时间'} date={draft.date} time={draft.time} required={draft.kind!=='plan'} onChange={(date,time)=>patch({date,time})}/>
    </div>
    <label>{draft.kind === 'plan' ? '计划标题' : '正文'}<textarea rows={3} value={draft.content} onChange={e => patch({ content: e.target.value })} /><FieldHint path={draft.kind==='plan'?'todos.0.title':'content'} limit={draft.kind==='plan'?undefined:fieldLimit(captureDraftSchema,'content')} value={draft.content}/></label>
    {draft.kind === 'plan' && <><label>说明<textarea rows={2} value={draft.description} onChange={e => patch({ description: e.target.value })} /><FieldHint path="todos.0.description" value={draft.description}/></label><div className="capture-row"><div className="plan-choice-field"><span>优先级</span><GlassChoices label="优先级" value={draft.priority} options={[{value:'high',label:'高'},{value:'medium',label:'中'},{value:'low',label:'低'}]} onChange={priority=>patch({priority:priority as CaptureDraft['priority']})}/></div><label>清单<input value={draft.list} onChange={e => patch({ list: e.target.value })} /></label></div></>}
    {draft.kind === 'plan' && <ClassificationFields value={draft} onChange={patch} />}
    {draft.kind === 'plan' && <RepeatFields value={draft.repeat} onChange={repeat=>patch({repeat})}/>}
    {draft.kind !== 'plan' && <SharedTagInput value={draft.tags} onChange={tags => patch({ tags })} />}
    <section aria-label="人物、地点、活动与食物">{entityContext ? <PlanEntityFields includeThings={false} context={entityContext} value={Object.values(draft.entities).flat()} onChange={value => patch({entities:{people:value.filter(e=>e.type==='person').map(e=>({...e,type:'person' as const})),places:value.filter(e=>e.type==='place').map(e=>({...e,type:'place' as const})),activities:value.filter(e=>e.type==='activity').map(e=>({...e,type:'activity' as const})),foods:value.filter(e=>e.type==='food').map(e=>({...e,type:'food' as const}))}})}/> : <p>实体标签编辑需要加载标签候选，请刷新后重试。</p>}</section>
    {chooseKind ? <p role="status">{draft.reviewReason}</p> : draft.needsReview && <label className="capture-review"><input type="checkbox" checked={false} onChange={() => patch({ needsReview: false })} />确认用途与日期：{draft.reviewReason || '请检查后勾选确认'}</label>}
  </fieldset>;
}

type Row = { draft: CaptureDraft; submitted?: CaptureDraft; state: 'draft' | 'saving' | 'saved' | 'error'; error?: string; ref?: RecordRef };
export function UnifiedCapture({ onSave, onOpen, hidden = false, bottomNav = false, entityContext, fullscreen, onToggleFullscreen, compactDesktop = false }: { compactDesktop?:boolean; entityContext?: EntityContext; hidden?: boolean; bottomNav?: boolean; onSave: (draft: CaptureDraft) => Promise<RecordRef>; onOpen: (ref: RecordRef) => void; fullscreen?: boolean; onToggleFullscreen?: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const [smallScreen, setMobile] = useState(() => window.matchMedia('(max-width: 899px)').matches);
  const mobile=smallScreen||compactDesktop;
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
  const [listening,setListening]=useState(false);
  const parse = async (input=text) => {
    const defaultClock=planClock();
    setBusy(true); setMessage('');
    try { const result = await api.parseCapture(input); setRows(result.drafts.map(draft => ({ draft, state: 'draft' }))); setMessage(result.mode === 'ai' ? 'AI 已整理，请逐条核对后保存。' : 'AI 暂不可用，原文已保留，请手动选择用途。'); }
    catch (error) {
      setMessage(error instanceof Error ? error.message : '识别失败，原文已保留。');
      setRows([{ draft: captureDraftSchema.parse({ id: crypto.randomUUID(), kind: 'facts', date: defaultClock.date,time:defaultClock.time, content: input, needsReview: true, reviewReason: 'AI 未能识别，请手动选择用途和日期' }), state: 'draft' }]);
    } finally { setBusy(false); }
  };
  const save = async (row: Row) => {
    const update = (patch: Partial<Row>) => setRows(old => old.map(r => r.draft.id === row.draft.id ? { ...r, ...patch } : r));
    update({ state: 'saving', error: undefined });
    try { const draft = captureDraftSchema.parse(row.submitted || row.draft); if (draft.needsReview) throw new Error('请先确认用途与日期'); update({ submitted: draft }); const ref = await onSave(draft); update({ state: 'saved', ref }); }
    catch (e) { update({ state: 'error', error: validationMessage(e,'保存失败，草稿仍保留') }); }
  };
  return <div className={`capture-shell${bottomNav ? ' has-bottom-nav' : ''}${expanded ? ' capture-expanded' : ''}${compactDesktop?' capture-plan-docked':''}`} hidden={hidden}>
    <div className="capture-mobile-bar">
      <button ref={trigger} type="button" className="capture-mobile-trigger" aria-expanded={expanded} aria-controls="capture-panel" onClick={() => setExpanded(true)}><Sparkles size={19} /><span>AI · 记一句话 / 建计划</span>{(text || rows.some(r => r.state !== 'saved')) && <small>有草稿</small>}</button>
      {onToggleFullscreen && <button type="button" className="capture-fullscreen-btn" aria-pressed={fullscreen} aria-label={fullscreen ? '退出全屏' : '全屏显示'} title={fullscreen ? '退出全屏' : '全屏显示'} onClick={onToggleFullscreen}>{fullscreen ? <Minimize2 size={18} /> : <Maximize2 size={18} />}</button>}
    </div>
    {mobile && expanded && <button className="capture-backdrop" aria-label="收起 AI 录入" tabIndex={-1} onClick={close} />}
    <section ref={panel} id="capture-panel" className="unified-capture" aria-labelledby="capture-title" role={mobile && expanded ? 'dialog' : undefined} aria-modal={mobile && expanded ? true : undefined}>
    <button type="button" className="capture-mobile-close quiet-button" onClick={close}><X size={18} />收起</button>
    <h2 id="capture-title">先记下一句话</h2><p>记日记或建计划。输入与已知名称、标签会发送到你配置的 AI，整理后由你确认。</p>
    <label className="sr-only" htmlFor="capture-text">统一录入</label><textarea id="capture-text" rows={3} disabled={listening} value={text} onChange={e => setText(e.target.value)} placeholder="今天和张三讨论方案；每周一下午三点开会。" /><FieldHint path="facts.events.0.note" value={text}/>
    {(!mobile||expanded)&&!hidden&&<VoiceInput text={text} disabled={busy||rows.some(r=>r.state!=='saved')} onText={setText} onParse={input=>void parse(input)} onListening={setListening}/>}
    <div className="capture-repeat-shortcuts" aria-label="快捷重复日程">{([['每天','每天 20:00 阅读'],['每周','每周一 15:00 项目例会'],['每月','每月1日 18:00 整理账单']] as const).map(([label,example])=><button type="button" key={label} disabled={busy||listening||rows.some(r=>r.state!=='saved')} onClick={()=>{const input=text.trim()?`${label} ${text}`:example;setText(input);void parse(input);}}>＋ {label}日程</button>)}</div>
    <div className="capture-actions"><small>未说明时间默认现在</small><button className="save-button" disabled={busy || listening || !text.trim() || text.length>10000 || rows.some(r => r.state !== 'saved')} onClick={() => void parse()}>{busy ? '正在整理…' : '整理为草稿'}</button></div>
    {message && <p role="alert">{message}</p>}
    {rows.map((row, index) => <article className="capture-draft" key={row.draft.id}><h3>草稿 {index + 1} · {CAPTURE_LABELS[row.draft.kind]}</h3>{row.state !== 'saved' && <DraftFields entityContext={entityContext} draft={row.draft} disabled={!!row.submitted || row.state === 'saving'} onChange={draft => setRows(old => old.map(r => r === row ? { ...r, draft } : r))} />}{row.error && <p role="alert">{row.error}</p>}<div className="capture-actions">{row.state === 'saved' ? <><span role="status">已保存</span><button className="quiet-button" onClick={() => { if (row.ref) { close(); onOpen(row.ref); } }}>查看{row.draft.kind === 'plan' ? '计划' : '日记'}</button></> : <><button className="quiet-button" disabled={row.state === 'saving'} onClick={() => setRows(old => old.filter(r => r !== row))}>移除草稿</button><button className="save-button" disabled={row.state === 'saving' || row.draft.needsReview || rows.some(r => r.state === 'saving')} onClick={() => void save(row)}>{row.state === 'saving' ? '保存中…' : row.state === 'error' ? '重试此条' : '确认保存此条'}</button></>}</div></article>)}
  </section></div>;
}
