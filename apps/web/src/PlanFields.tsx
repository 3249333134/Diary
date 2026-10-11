import { usePlanCategories } from './PlanCategories';
import { GlassSelect } from './GlassSelect';
import { useEffect, useId, useState } from 'react';
import type { Todo } from '@diary/contracts';
import { api } from './api';

export type Classification = Pick<Todo, 'category' | 'important' | 'urgent' | 'startDate' | 'startTime'>;
export const QUADRANTS = [
  { id: 'q1', label: '重要紧急', important: true, urgent: true },
  { id: 'q2', label: '重要不紧急', important: true, urgent: false },
  { id: 'q3', label: '不重要紧急', important: false, urgent: true },
  { id: 'q4', label: '不重要不紧急', important: false, urgent: false },
];
export function quadrant(task: Classification) {
  return task.category && typeof task.important === 'boolean' && typeof task.urgent === 'boolean'
    ? QUADRANTS.find(q => q.important === task.important && q.urgent === task.urgent)?.id : 'unclassified';
}
export function ClassificationFields({ value, onChange, start = true }: { value: Classification; onChange: (patch: Classification) => void; start?: boolean }) {
  const {categories}=usePlanCategories();
  return <div className="plan-classification-fields">
    <label>事项类别<GlassSelect label="事项类别" value={value.category||''} options={[{value:'',label:'待分类'},...categories.map(c=>({value:c.id,label:c.name,color:c.color}))]} onChange={category=>onChange({category:category?category as Todo['category']:null})}/></label>
    <label>四象限<GlassSelect label="四象限" value={typeof value.important==='boolean'&&typeof value.urgent==='boolean'?QUADRANTS.find(q=>q.important===value.important&&q.urgent===value.urgent)?.id||'':''} options={[{value:'',label:'待分类'},...QUADRANTS.map((q,i)=>({value:q.id,label:q.label,color:['#c05d56','#7856bd','#258378','#9296a3'][i]}))]} onChange={id=>{const q=QUADRANTS.find(q=>q.id===id);onChange({important:q?.important??null,urgent:q?.urgent??null});}}/></label>
    {start && <><label>原定开始日期<input type="date" value={value.startDate || ''} onChange={e => onChange({ startDate: e.target.value })} /></label><label>原定开始时间<input type="time" value={value.startTime || ''} onChange={e => onChange({ startTime: e.target.value })} /></label></>}
  </div>;
}
export function SharedTagInput({ value, onChange }: { value: string[]; onChange: (tags: string[]) => void }) {
  const id = useId(), [tags, setTags] = useState<string[]>([]), [input, setInput] = useState(''), [error, setError] = useState('');
  useEffect(() => { void api.tagLibrary().then(data => setTags(data.tags)).catch(() => setError('标签候选暂不可用，仍可手动输入。')); }, []);
  const add = () => {
    const added = input.split(/[,，]/).map(t => t.trim()).filter(Boolean);
    if (!added.length) return;
    onChange([...new Set([...value, ...added])]); setInput('');
    void Promise.all(added.map(tag => api.addSharedTag(tag))).then(data => { setTags(data.at(-1)?.tags || tags); setError(''); }).catch(() => setError('标签已加入草稿，保存后仍会进入共享候选。'));
  };
  return <div className="shared-tags"><label>共享标签<div className="shared-tag-entry"><input aria-label="共享标签" list={id} value={input} maxLength={40} onChange={e => setInput(e.target.value)} onBlur={add} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add(); } }} placeholder="选择或输入标签，回车添加" /><button type="button" onClick={add}>添加</button></div></label><datalist id={id}>{tags.map(tag => <option key={tag} value={tag} />)}</datalist><div className="shared-tag-chips">{value.map(tag => <button type="button" key={tag} aria-label={`移除标签 ${tag}`} onClick={() => onChange(value.filter(t => t !== tag))}>{tag} ×</button>)}</div>{error && <small role="status">{error}</small>}</div>;
}
