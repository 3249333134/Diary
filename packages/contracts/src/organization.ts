export type OrganizationRole='owner'|'admin'|'member';
export type GrantPermission='deny'|'viewer'|'editor';
export type OrganizationDepartment={id:string;name:string;parentId?:string;version:string};
export type OrganizationMember={code:string;name:string;role:OrganizationRole;departmentIds:string[];managedDepartmentIds:string[]};
export type Organization={id:string;name:string;version:string;role:OrganizationRole;departments:OrganizationDepartment[];members:OrganizationMember[];leftWindows?:{id:string;name:string}[]};
export type FriendGroup={id:string;name:string;codes:string[];version:string};
export type OrganizationInvitation={id:string;organizationId:string;organizationName:string;person:{code:string;name:string};inviter:{code:string;name:string};departmentNames:string[];direction:'incoming'|'outgoing'};
export type WindowGrant={kind:'organization'|'department'|'person';targetId:string;permission:GrantPermission;includeChildren:boolean};
export type PermissionSource={label:string;permission:GrantPermission;kind:'management'|'organization'|'department'|'person'};
export type OrganizationChange={action:'rename'|'department'|'removeDepartment'|'member'|'removeMember'|'leave'|'transfer'|'archive';name?:string;departmentId?:string;parentId?:string;code?:string;role?:OrganizationRole;departmentIds?:string[];managedDepartmentIds?:string[]};
export type OrganizationImpact={people:number;windows:number;gained:number;lost:number;changed:number};
export function departmentPath(departments:OrganizationDepartment[],id:string):OrganizationDepartment[]{
 const path:OrganizationDepartment[]=[],seen=new Set<string>();let node=departments.find(d=>d.id===id);
 while(node&&!seen.has(node.id)){seen.add(node.id);path.unshift(node);node=departments.find(d=>d.id===node!.parentId);}return path;
}
export function managesDepartment(org:Organization,member:OrganizationMember,departmentId?:string){
 return member.role==='owner'||member.role==='admin'||!!departmentId&&member.managedDepartmentIds.some(id=>departmentPath(org.departments,departmentId).some(d=>d.id===id));
}
/** Each department path resolves its nearest rule; personal overrides are final. */
export function organizationAccess(org:Organization,code:string,departmentId:string|undefined,grants:WindowGrant[],exited=false):{permission?:'viewer'|'editor';canManage:boolean;sources:PermissionSource[]}{
 const member=org.members.find(m=>m.code===code);if(!member)return {canManage:false,sources:[]};
 const canManage=managesDepartment(org,member,departmentId);
 if(canManage)return {permission:'editor',canManage:true,sources:[{kind:'management',label:member.role==='owner'?'组织负责人':member.role==='admin'?'组织管理员':'部门负责人',permission:'editor'}]};
 if(exited)return {canManage:false,sources:[{kind:'person',label:'已主动退出窗口',permission:'deny'}]};
 const personal=grants.find(g=>g.kind==='person'&&g.targetId===code);
 if(personal)return {canManage:false,permission:personal.permission==='deny'?undefined:personal.permission,sources:[{kind:'person',label:'个人设置',permission:personal.permission}]};
 const root=grants.find(g=>g.kind==='organization'&&g.targetId===org.id),sources:PermissionSource[]=[];
 for(const id of member.departmentIds){
  const path=departmentPath(org.departments,id),match=[...path].reverse().map(d=>grants.find(g=>g.kind==='department'&&g.targetId===d.id&&(d.id===id||g.includeChildren))).find(Boolean);
  if(match)sources.push({kind:'department',label:departmentPath(org.departments,match.targetId).map(d=>d.name).join(' / '),permission:match.permission});
  else if(root)sources.push({kind:'organization',label:org.name,permission:root.permission});
 }
 if(!member.departmentIds.length&&root)sources.push({kind:'organization',label:org.name,permission:root.permission});
 const unique=sources.filter((s,i)=>sources.findIndex(o=>o.kind===s.kind&&o.label===s.label&&o.permission===s.permission)===i);
 return {canManage:false,permission:unique.some(s=>s.permission==='editor')?'editor':unique.some(s=>s.permission==='viewer')?'viewer':undefined,sources:unique};
}
