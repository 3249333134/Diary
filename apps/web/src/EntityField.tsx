import {fieldLimit,diaryDocumentSchema} from '@diary/contracts';
import {GlassComboBox} from './GlassUI';
import {FieldHint} from './FieldHint';
import { useId, useState } from 'react';
import { Check, MapPin, Plus, X } from 'lucide-react';
import type { EntityType, TaggedEntity, EntityRecord, TagStore } from '@diary/contracts';
const TYPE_LABEL: Record<EntityType,string> = {person:'人物',place:'地点',activity:'活动',food:'食物',thing:'事物'};
export type EntityFieldProps = {
  label: string;
  type: EntityType;
  values: TaggedEntity[];
  entities: EntityRecord[];
  tags: TagStore;
  onChange: (values: TaggedEntity[]) => void;
  onCreateTag: (type: EntityType, tag: string) => Promise<void>;
  forceShow?: boolean;
  onRequestShow?: () => void;
};

export function EntityField({ label, type, values, entities, tags, onChange, onCreateTag, forceShow, onRequestShow }: EntityFieldProps) {
  const id = useId();
  const [input, setInput] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [tagError, setTagError] = useState('');
  const [newTag, setNewTag] = useState("");
  const [expanded, setExpanded] = useState(false);
  const [locating, setLocating] = useState(false);
  const options = entities.filter((item) => item.type === type && !values.some((value) => value.name === item.name));
  const getLocation = async () => {
    if (locating) return;
    if (!navigator.geolocation) { alert("当前设备不支持定位"); return; }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(async (pos) => {
      try {
        const { latitude, longitude } = pos.coords;
        const resp = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}&zoom=14&accept-language=zh-CN`, { headers: { "Accept-Language": "zh-CN" } });
        const data = await resp.json() as { address?: Record<string, string>; display_name?: string };
        const addr = data.address || {};
        const name = addr.suburb || addr.neighbourhood || addr.road || addr.city || data.display_name?.split(",")[0] || "";
        if (name && !values.some((v) => v.name === name)) {
          const known = entities.find((e) => e.type === "place" && e.name === name);
          onChange([...values, { type: "place" as EntityType, name, tags: known?.tags || [] }]);
        }
      } catch { alert("定位获取失败，请重试"); }
      finally { setLocating(false); }
    }, () => { setLocating(false); alert("定位失败，请检查浏览器权限设置"); }, { enableHighAccuracy: true, timeout: 10_000 });
  };
  const add = (candidate=input) => {
    const name = candidate.trim();
    if(name.length>(fieldLimit(diaryDocumentSchema,'facts.events.0.people.0.name')||80)){setTagError("名称最多 80 字符");return;}
    if (!name || values.some((item) => item.name === name)) return;
    const known = entities.find((item) => item.type === type && item.name === name);
    onChange([...values, { type, name, tags: known?.tags || [] }]);
    setInput("");
  };
  const toggleTag = (name: string, tag: string) => onChange(values.map((item) => item.name === name ? { ...item, tags: item.tags.includes(tag) ? item.tags.filter((value) => value !== tag) : [...item.tags, tag] } : item));
  const createTag = async (name: string) => {
    const clean = newTag.trim();
    if (!clean) return;
    if(clean.length>(fieldLimit(diaryDocumentSchema,'facts.events.0.people.0.tags.0')||40)){setTagError('标签最多 40 字符');return;}
    setTagError('');
    try { await onCreateTag(type, clean); } catch(error) { setTagError(error instanceof Error ? error.message : '标签保存失败，请重试'); return; }
    if (!values.find((item) => item.name === name)?.tags.includes(clean)) toggleTag(name, clean);
    setNewTag("");
  };
  const hasValues = values.length > 0;
  const showInput = expanded || hasValues || !!forceShow;
  const handleCompactClick = () => { if (onRequestShow) onRequestShow(); else setExpanded(true); };
  return <div className={`field entity-field${hasValues ? " has-values" : ""}`}>
    <label htmlFor={id}>{label}</label>
    {!showInput ? (
      <button type="button" className="entity-add-compact" onClick={handleCompactClick}>
        <Plus size={16} />添加{TYPE_LABEL[type]}
        {type === "place" && <span className="compact-loc-hint"> · 📍定位</span>}
      </button>
    ) : (
      <>
    <div className="entity-entry">
      <GlassComboBox label={'添加'+TYPE_LABEL[type]} id={id} autoFocus={forceShow&&!hasValues} value={input} onChange={setInput} onCommit={add} options={options.map(item=>item.name)} placeholder={'添加'+TYPE_LABEL[type]}/>
      {type === "place" && <button type="button" className="square-button locate-btn" onClick={getLocation} disabled={locating} aria-label="获取定位"><MapPin size={18} className={locating ? "spinning" : ""} /></button>}
      <button type="button" className="square-button" onClick={()=>add()} aria-label={`添加${TYPE_LABEL[type]}`}><Plus size={18} /></button>
      {!hasValues && <button type="button" className="square-button" onClick={() => { setExpanded(false); }} aria-label="收起"><X size={16} /></button>}
    </div>
    <FieldHint path="facts.events.0.people.0.name" value={input}/>
    {hasValues && <div className="entity-list">
      {values.map((item) => <div className="entity-wrap" key={`${item.type}-${item.name}`}>
        <div className={`entity-chip${editing === item.name ? " selected" : ""}`}>
          <button type="button" className="entity-name" onClick={() => setEditing(editing === item.name ? null : item.name)} aria-expanded={editing === item.name}>{item.name}{item.tags.length > 0 && <small>{item.tags.join(" · ")}</small>}</button>
          <button type="button" className="chip-remove" onClick={() => onChange(values.filter((value) => value !== item))} aria-label={`移除${item.name}`}><X size={14} /></button>
        </div>
        {editing === item.name && <div className="tag-editor">
          <span>为“{item.name}”选择标签</span>{tagError && <p role="alert">{tagError}</p>}
          <div className="tag-options">{tags[type].map((tag) => <button type="button" key={tag} className={item.tags.includes(tag) ? "active" : ""} onClick={() => toggleTag(item.name, tag)}>{item.tags.includes(tag) && <Check size={12} />}{tag}</button>)}</div>
          <div className="tag-create"><input value={newTag} onChange={(event) => setNewTag(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void createTag(item.name); } }} placeholder="新标签" /><FieldHint path="facts.events.0.people.0.tags.0" value={newTag}/><button type="button" onClick={() => void createTag(item.name)}>添加</button></div>
        </div>}
      </div>)}
    </div>}
      </>
    )}
  </div>;
}

