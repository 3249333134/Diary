import {FieldHint} from './FieldHint';
import {fieldLimit,planViewSchema} from '@diary/contracts';
import {GlassDialog} from './GlassUI';
import { GlassSelect } from './GlassSelect';
import { useGlassConfirm } from './GlassConfirm';
import { useEffect, useState } from 'react';
import { api, type PlanView } from './api';
import { SharedTagInput } from './PlanFields';
const viewNameLimit=fieldLimit(planViewSchema,'name')!;

export function PlanViews({ active, onSelect, onLoad }: { active: string; onSelect: (id:string)=>void; onLoad:(views:PlanView[])=>void }) {
  const [views,setViews]=useState<PlanView[]>([]),[editing,setEditing]=useState<PlanView>(),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const confirmation=useGlassConfirm();
  useEffect(()=>{void api.planViews().then(data=>{setViews(data.views);onLoad(data.views);}).catch(()=>setError('标签视图读取失败，请稍后重试。'));},[]);
  const save=async(next:PlanView[])=>{setBusy(true);try{const result=await api.savePlanViews(next);setViews(result.views);onLoad(result.views);setEditing(undefined);setError('');if(!result.views.some(v=>v.id===active))onSelect('');}catch{setError('视图保存失败，编辑内容仍保留。');}finally{setBusy(false);}};
  return <div className="plan-views"><label>标签视图<GlassSelect label="标签视图" value={active} onChange={onSelect} options={[{value:'',label:'全部标签'},...views.map(v=>({value:v.id,label:v.name,color:v.color}))]}/></label><button className="quiet-button" onClick={()=>setEditing({id:crypto.randomUUID(),name:'',color:'#7256d8',tags:[]})}>新建视图</button>{active&&<button className="quiet-button" onClick={()=>setEditing(views.find(v=>v.id===active))}>编辑视图</button>}{active&&<span className="view-color" style={{background:views.find(v=>v.id===active)?.color}} aria-label="视图颜色"/>}{error&&<p role="alert">{error}</p>}
    {editing&&<GlassDialog label="编辑标签视图" busy={busy} onClose={()=>setEditing(undefined)}><div className="todo-modal"><div className="todo-modal-header"><h3>标签视图</h3><p>匹配任意所选标签，同一计划不会被复制。</p></div><div className="todo-modal-body"><label className="field">视图名称<input value={editing.name} onChange={e=>setEditing({...editing,name:e.target.value})}/><FieldHint path="name" limit={viewNameLimit} value={editing.name}/></label><label className="field">显示颜色<input type="color" value={editing.color} onChange={e=>setEditing({...editing,color:e.target.value})}/></label><SharedTagInput value={editing.tags} onChange={tags=>setEditing({...editing,tags})}/></div><div className="todo-modal-footer"><button disabled={busy} className="quiet-button" onClick={()=>setEditing(undefined)}>取消</button>{views.some(v=>v.id===editing.id)&&<button disabled={busy} className="quiet-button" onClick={async()=>{if(await confirmation.confirm('删除此视图？计划和标签仍保留。'))void save(views.filter(v=>v.id!==editing.id));}}>删除视图</button>}<button className="save-button" disabled={busy||!editing.name.trim()||editing.name.trim().length>viewNameLimit||!editing.tags.length} onClick={()=>void save([...views.filter(v=>v.id!==editing.id),editing])}>保存视图</button></div></div></GlassDialog>}
    {confirmation.dialog}
  </div>;
}
