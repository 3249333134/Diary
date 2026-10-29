import type {ReactNode} from 'react';
import {useSocial} from './Social';
import {useWorkspaceState} from './workspaceState';
export function CreationGroup({id,draftId,title,summary,children,defaultOpen=false}:{id:string;draftId:string;title:string;summary:string;children:ReactNode;defaultOpen?:boolean}){
 const {data}=useSocial(),[open,setOpen]=useWorkspaceState(data.profile.code,`create.${draftId}.${id}${defaultOpen?'.default-open-v1':''}`,defaultOpen);
 return <details className="creation-group" data-create-group={id} open={open} onToggle={e=>setOpen(e.currentTarget.open)}><summary><strong>{title}</strong><span>{summary||'未设置'}</span></summary><div className="creation-group-body">{children}</div></details>;
}
