import {createContext,useContext,useEffect,useRef,useState,type ReactNode,type CSSProperties} from 'react';
import {defaultPlanCategories,type PlanCategory} from '@diary/contracts';
import {api} from './api';
import {Plus,X} from 'lucide-react';
const Context=createContext<{categories:PlanCategory[];add:(name:string,color:string)=>Promise<void>}>({categories:defaultPlanCategories,add:async()=>{throw new Error('类别服务未加载');}});
export const usePlanCategories=()=>useContext(Context);
export function PlanCategoryProvider({children}:{children:ReactNode}) {
  const [categories,setCategories]=useState(defaultPlanCategories);
  useEffect(()=>{let active=true;void api.planCategories().then(r=>{if(active&&Array.isArray(r.categories))setCategories(r.categories);}).catch(()=>{});return()=>{active=false};},[]);
  const add=async(name:string,color:string)=>{const result=await api.addPlanCategory(name,color);setCategories(result.categories);};
  return <Context.Provider value={{categories,add}}>{children}</Context.Provider>;
}
export const categoryStyle=(color?:string)=>color?{'--category-color':color} as CSSProperties:undefined;
export function AddPlanCategory({onClose}:{onClose:()=>void}) {
  const {add}=usePlanCategories(),ref=useRef<HTMLDialogElement>(null);const [name,setName]=useState(''),[color,setColor]=useState('#a798d5'),[busy,setBusy]=useState(false),[error,setError]=useState('');
  useEffect(()=>{const opener=document.activeElement instanceof HTMLElement?document.activeElement:null;ref.current?.showModal();return()=>{ref.current?.close();if(opener?.isConnected)opener.focus({preventScroll:true});};},[]);
  const save=async()=>{if(busy||!name.trim())return;setBusy(true);setError('');try{await add(name.trim(),color);onClose();}catch(e){setError(e instanceof Error?e.message:'保存失败，请重试');}finally{setBusy(false);}};
  return <dialog ref={ref} className="plan-edit-dialog" aria-label="添加计划类别" onCancel={e=>{e.preventDefault();if(!busy)onClose();}}><form className="compact-sheet" onSubmit={e=>{e.preventDefault();void save();}}><header><div><h2>添加类别</h2><p>创建后可用于筛选、编辑和拖动归类。</p></div><button type="button" className="square-button" aria-label="关闭类别编辑" disabled={busy} onClick={onClose}><X size={18}/></button></header><label>类别名称<input autoFocus value={name} maxLength={30} onChange={e=>setName(e.target.value)} placeholder="例如：学习、健康、家庭" disabled={busy}/></label><label className="plan-category-color">类别颜色<input type="color" value={color} onChange={e=>setColor(e.target.value)} disabled={busy}/></label>{error&&<p role="alert">{error}</p>}<footer><button type="button" className="quiet-button" disabled={busy} onClick={onClose}>取消</button><button type="submit" className="save-button" disabled={busy||!name.trim()}><Plus size={16}/>{busy?'保存中…':'添加类别'}</button></footer></form></dialog>;
}
