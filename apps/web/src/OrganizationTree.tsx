import {useEffect,useMemo,useState,type ReactNode} from 'react';
import {Building2,ChevronDown,ChevronRight,FolderTree,Plus,Users} from 'lucide-react';
import {useWorkspaceState} from './workspaceState';
import {departmentPath,type Organization,type OrganizationDepartment} from '@diary/contracts';

export function OrganizationTree({account,org,selected,search,onSelect,onAdd,canAdd,onInvite,canInvite}:{account:string;org:Organization;selected:string;search:string;onSelect:(id:string)=>void;onAdd:(parentId:string)=>void;canAdd:(id:string)=>boolean;onInvite?:(departmentId:string)=>void;canInvite?:(id:string)=>boolean}){
 const [savedCollapsed,setCollapsed]=useWorkspaceState<string[]>(account,'organization.'+org.id+'.collapsed',[]),[searchCollapsed,setSearchCollapsed]=useState<string[]>([]),collapsed=new Set(search.trim()?searchCollapsed:savedCollapsed);
 useEffect(()=>setSearchCollapsed([]),[search]);
 const {children,counts,visible,levels}=useMemo(()=>{
  const children=new Map<string,OrganizationDepartment[]>(),counts=new Map<string,number>(),visible=new Set<string>(),query=search.trim().toLocaleLowerCase();let levels=0;
  const includePath=(id:string)=>departmentPath(org.departments,id).forEach(d=>visible.add(d.id));
  for(const department of org.departments){const key=department.parentId||'',siblings=children.get(key)||[];siblings.push(department);children.set(key,siblings);const path=departmentPath(org.departments,department.id);levels=Math.max(levels,path.length);if(!query||path.map(d=>d.name).join(' / ').toLocaleLowerCase().includes(query))includePath(department.id);}
  for(const siblings of children.values())siblings.sort((a,b)=>a.name.localeCompare(b.name,'zh-CN'));
  for(const member of org.members){const ids=new Set(member.departmentIds.flatMap(id=>departmentPath(org.departments,id).map(d=>d.id)));for(const id of ids)counts.set(id,(counts.get(id)||0)+1);if(query&&(member.name+member.code).toLocaleLowerCase().includes(query))member.departmentIds.forEach(includePath);}
  return {children,counts,visible,levels};
 },[org,search]);
 const toggle=(id:string)=>{const update=search.trim()?setSearchCollapsed:setCollapsed;update(old=>old.includes(id)?old.filter(value=>value!==id):[...old,id]);};
 const branch=(parent=''):ReactNode=><ul className={parent?'org-tree-children':'org-tree-list'} id={parent?`org-children-${parent}`:undefined}>{(children.get(parent)||[]).filter(d=>visible.has(d.id)).map(d=>{
  const nested=(children.get(d.id)||[]).filter(child=>visible.has(child.id)),expanded=!collapsed.has(d.id),path=departmentPath(org.departments,d.id).map(node=>node.name).join(' / ');
  return <li key={d.id}><div className="org-tree-row">
   {nested.length?<button type="button" className="org-tree-toggle" aria-label={`${expanded?'收起':'展开'}${d.name}的下级部门`} aria-expanded={expanded} aria-controls={expanded?`org-children-${d.id}`:undefined} onClick={()=>toggle(d.id)}>{expanded?<ChevronDown size={16}/>:<ChevronRight size={16}/>}</button>:<span className="org-tree-leaf"><FolderTree size={16}/></span>}
   <button type="button" className="org-tree-select" aria-current={selected===d.id?'page':undefined} title={path} onClick={()=>onSelect(d.id)}><span>{d.name}</span><small>{counts.get(d.id)||0}人</small></button>
   {canAdd(d.id)&&departmentPath(org.departments,d.id).length<12&&<button type="button" className="org-tree-add" aria-label={`在${path}下新增子部门`} title="新增子部门" onClick={()=>onAdd(d.id)}><Plus size={17}/></button>}
   {onInvite&&(canInvite?canInvite(d.id):canAdd(d.id))&&<button type="button" className="org-tree-add org-tree-invite" aria-label={`邀请成员到${path}`} title="快速邀请成员" onClick={()=>onInvite(d.id)}><Users size={16}/></button>}
  </div>{nested.length>0&&expanded&&branch(d.id)}</li>;
 })}</ul>;
 return <nav className="org-tree" aria-label="部门树"><div className="org-tree-heading"><strong>部门结构</strong><small>{org.departments.length}个部门{levels?` · ${levels}级`:''}</small></div><div className="org-tree-row"><button type="button" className="org-tree-root" aria-current={!selected?'page':undefined} onClick={()=>onSelect('')}><Building2 size={18}/><span>{org.name}</span><small>{org.members.length}人</small></button>{canAdd('')&&<button type="button" className="org-tree-add" aria-label={`在${org.name}下新增一级部门`} title="新增一级部门" onClick={()=>onAdd('')}><Plus size={17}/></button>}{onInvite&&(canInvite?canInvite(''):canAdd(''))&&<button type="button" className="org-tree-add org-tree-invite" aria-label={`邀请成员到${org.name}`} title="快速邀请成员" onClick={()=>onInvite('')}><Users size={16}/></button>}</div>{org.departments.length?branch():<p className="org-tree-empty">点击＋新增一级部门，再为部门添加下级。</p>}{search.trim()&&visible.size===0&&<p className="org-tree-empty">没有匹配的部门或成员。</p>}</nav>;
}
