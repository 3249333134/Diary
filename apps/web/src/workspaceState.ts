import {useCallback,useLayoutEffect,useMemo,useState,type RefObject} from 'react';
const memory=new Map<string,unknown>();
function read<T>(key:string,initial:T):T{if(memory.has(key))return memory.get(key) as T;try{const value=JSON.parse(sessionStorage.getItem(key)||'null');if(value!==null){memory.set(key,value);return value;}}catch{}return initial;}
function write(key:string,value:unknown){memory.set(key,value);try{if(value===undefined)sessionStorage.removeItem(key);else sessionStorage.setItem(key,JSON.stringify(value));}catch{}}
/** Navigation only: never persist permission conclusions or editor documents here. */
export function useWorkspaceState<T>(account:string,scope:string,initial:T){
 const key=`diary.view.v1.${account}.${scope}`,[state,setState]=useState(()=>({key,value:read(key,initial)})),value=state.key===key?state.value:read(key,initial);
 const update=useCallback((next:T|((old:T)=>T))=>setState(old=>{const value=typeof next==='function'?(next as (old:T)=>T)(old.key===key?old.value:read(key,initial)):next;write(key,value);return {key,value};}),[key]);
 return [value,update] as const;
}
export function useWorkspaceSet(account:string,scope:string){
 const [values,setValues]=useWorkspaceState<string[]>(account,scope,[]),value=useMemo(()=>new Set(values),[values]);
 const update=useCallback((next:Set<string>|((old:Set<string>)=>Set<string>))=>setValues(old=>[...(typeof next==='function'?next(new Set(old)):next)]),[setValues]);
 return [value,update] as const;
}
export function useScrollMemory(account:string,scope:string,ref:RefObject<HTMLElement|null>,enabled=true){
 useLayoutEffect(()=>{const el=ref.current;if(!el||!enabled)return;const key=`diary.view.v1.${account}.scroll.${scope}`,position=read(key,{top:0,left:0});el.scrollTop=position.top;el.scrollLeft=position.left;
  let timer:ReturnType<typeof setTimeout>|undefined;const save=()=>{const value={top:el.scrollTop,left:el.scrollLeft};memory.set(key,value);if(!timer)timer=setTimeout(()=>{timer=undefined;write(key,memory.get(key));},200);};el.addEventListener('scroll',save,{passive:true});return()=>{clearTimeout(timer);write(key,memory.get(key)||position);el.removeEventListener('scroll',save);};
 },[account,scope,enabled,ref]);
 return read(`diary.view.v1.${account}.scroll.${scope}`,undefined)!==undefined;
}
