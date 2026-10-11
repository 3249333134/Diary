import { useEffect, useId, useRef, useState } from 'react';
import { X } from 'lucide-react';
import './plan-glass.css';

function ConfirmDialog({ message, resolve }: { message:string; resolve:(value:boolean)=>void }) {
  const ref=useRef<HTMLDialogElement>(null), id=useId();
  useEffect(()=>{const el=ref.current;el?.showModal();return()=>el?.close();},[]);
  return <dialog ref={ref} className="plan-edit-dialog glass-confirm" aria-labelledby={id} onCancel={event=>{event.preventDefault();resolve(false);}}><header><h2 id={id}>确认操作</h2><button type="button" className="square-button" aria-label="关闭确认" onClick={()=>resolve(false)}><X size={18}/></button></header><p>{message}</p><footer><button type="button" autoFocus className="quiet-button" onClick={()=>resolve(false)}>取消</button><button type="button" className="save-button" onClick={()=>resolve(true)}>确认</button></footer></dialog>;
}
export function useGlassConfirm() {
  const [pending,setPending]=useState<{message:string;resolve:(value:boolean)=>void}>();
  const pendingRef=useRef(pending);pendingRef.current=pending;
  useEffect(()=>()=>pendingRef.current?.resolve(false),[]);
  return { confirm:(message:string)=>new Promise<boolean>(resolve=>{pendingRef.current?.resolve(false);setPending({message,resolve});}), dialog:pending&&<ConfirmDialog message={pending.message} resolve={value=>{pending.resolve(value);setPending(undefined);}}/> };
}
