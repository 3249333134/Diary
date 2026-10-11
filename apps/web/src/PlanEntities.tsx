import { UserRound, MapPin, Activity, Utensils, Package } from 'lucide-react';
import type { EntityRecord, EntityType, TaggedEntity, TagStore } from '@diary/contracts';
import { EntityField } from './EntityField';
export type EntityContext = { entities: EntityRecord[]; tags: TagStore; onCreateTag: (type: EntityType, name: string) => Promise<void> };
const groups = [['person','和谁'],['place','在哪'],['activity','做什么'],['food','吃什么'],['thing','相关事物']] as const;
export function PlanEntityFields({value, onChange, context, includeThings = true}: {value: TaggedEntity[]; onChange:(value:TaggedEntity[])=>void; context:EntityContext; includeThings?:boolean}) {
  return <section className="plan-entities-edit" aria-label="计划关联实体"><h4>人物与地点</h4><p className="muted">与日记共用实体和标签；点击名称可编辑该实体的标签。</p>{groups.filter(([type])=>includeThings || type!=='thing').map(([type,label])=><EntityField key={type} label={label} type={type} values={value.filter(e=>e.type===type)} {...context} onChange={next=>onChange([...value.filter(e=>e.type!==type),...next])}/>)}</section>;
}
export function PlanEntitySummary({value}: {value:TaggedEntity[]}) {
  if(!value.length)return null;
  const icons = {person:UserRound,place:MapPin,activity:Activity,food:Utensils,thing:Package};
  return <div className="plan-entity-summary" aria-label="关联人物与地点">{groups.flatMap(([type,label])=>value.filter(e=>e.type===type).map(e=>{const Icon=icons[type];return <span className="plan-entity-inline" key={e.type+':'+e.name}><Icon size={14} aria-hidden="true"/><span className="sr-only">{label}：</span><span className="entity-name">{e.name}{e.tags.length>0&&<small>· {e.tags.join(' · ')}</small>}</span></span>;}))}</div>;
}
