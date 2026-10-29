import {createHash,randomUUID} from 'node:crypto';
import {z} from 'zod';
import type {FastifyInstance} from 'fastify';
import {departmentPath,managesDepartment,organizationAccess,type Organization,type OrganizationChange,type OrganizationImpact,type FriendGroup,type OrganizationInvitation,type WindowGrant,type SocialDomain} from '@diary/contracts';
import {pool,queryRows} from './db.js';
import {databaseContext} from './db-context.js';
import {syncTransaction} from './sync-db.js';
import {socialProfile,notifyOrganizationChange} from './social.js';

const fail=(message:string,statusCode=400)=>Object.assign(new Error(message),{statusCode});
const uuid=z.string().uuid(),name=z.string().trim().min(1).max(60),code=z.string().trim().min(1).max(16).transform(v=>v.toUpperCase());
const permission=z.enum(['deny','viewer','editor']);
const grantsSchema=z.array(z.object({kind:z.enum(['organization','department','person']),targetId:z.string(),permission,includeChildren:z.boolean().default(true)})).max(1000);
type Binding={window_id:string;organization_id:string;department_id:string|null};
type OrgRow={id:string;name:string;owner_id:number;version:string;archived:number};
const lock=()=>databaseContext.getStore()&&typeof pool.getConnection==='function'?' FOR UPDATE':'';
const operationLocks=new Map<string,Promise<unknown>>();
async function personId(value:string){const [row]=await queryRows<{user_id:number}>('SELECT user_id FROM social_profiles WHERE friend_code = ?',[code.parse(value)]);if(!row)throw fail('未找到这个好友码',404);return row.user_id;}

export async function ensureOrganizationTables(){
 const suffix=typeof pool.getConnection==='function'?' ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci':'';
 for(const sql of [
  'CREATE TABLE IF NOT EXISTS friend_groups (id VARCHAR(36) PRIMARY KEY,user_id INT NOT NULL,name VARCHAR(60) NOT NULL,codes LONGTEXT NOT NULL,version VARCHAR(36) NOT NULL)',
  'CREATE TABLE IF NOT EXISTS organizations (id VARCHAR(36) PRIMARY KEY,name VARCHAR(60) NOT NULL,owner_id INT NOT NULL,version VARCHAR(36) NOT NULL,archived INT NOT NULL DEFAULT 0)',
  'CREATE TABLE IF NOT EXISTS organization_members (organization_id VARCHAR(36) NOT NULL,user_id INT NOT NULL,role VARCHAR(10) NOT NULL,status VARCHAR(12) NOT NULL,PRIMARY KEY(organization_id,user_id))',
  'CREATE TABLE IF NOT EXISTS organization_departments (id VARCHAR(36) PRIMARY KEY,organization_id VARCHAR(36) NOT NULL,parent_id VARCHAR(36),name VARCHAR(60) NOT NULL,version VARCHAR(36) NOT NULL)',
  'CREATE TABLE IF NOT EXISTS organization_department_members (organization_id VARCHAR(36) NOT NULL,department_id VARCHAR(36) NOT NULL,user_id INT NOT NULL,is_manager INT NOT NULL DEFAULT 0,PRIMARY KEY(department_id,user_id))',
  'CREATE TABLE IF NOT EXISTS organization_invitations (id VARCHAR(36) PRIMARY KEY,organization_id VARCHAR(36) NOT NULL,user_id INT NOT NULL,inviter_id INT NOT NULL,departments LONGTEXT NOT NULL,status VARCHAR(12) NOT NULL)',
  'CREATE TABLE IF NOT EXISTS organization_windows (window_id VARCHAR(36) PRIMARY KEY,organization_id VARCHAR(36) NOT NULL,department_id VARCHAR(36))',
  'CREATE TABLE IF NOT EXISTS organization_window_grants (window_id VARCHAR(36) NOT NULL,kind VARCHAR(16) NOT NULL,target_id VARCHAR(36) NOT NULL,permission VARCHAR(10) NOT NULL,include_children INT NOT NULL DEFAULT 1,PRIMARY KEY(window_id,kind,target_id))',
  'CREATE TABLE IF NOT EXISTS organization_window_exits (window_id VARCHAR(36) NOT NULL,user_id INT NOT NULL,PRIMARY KEY(window_id,user_id))',
  'CREATE TABLE IF NOT EXISTS organization_audit (id VARCHAR(36) PRIMARY KEY,organization_id VARCHAR(36) NOT NULL,actor_id INT NOT NULL,action VARCHAR(30) NOT NULL,details LONGTEXT NOT NULL,created_at VARCHAR(30) NOT NULL)',
  'CREATE TABLE IF NOT EXISTS organization_operations (user_id INT NOT NULL,operation_id VARCHAR(36) NOT NULL,request_hash VARCHAR(64) NOT NULL,result LONGTEXT NOT NULL,PRIMARY KEY(user_id,operation_id))',
 ])await pool.query(sql+suffix);
}
export async function organizationOperation<T>(userId:number,operationId:string,input:unknown,work:()=>Promise<T>,domains:SocialDomain[]=['social','plans']):Promise<T>{
 const key=userId+':'+operationId,previous=operationLocks.get(key)||Promise.resolve(),result=previous.catch(()=>{}).then(()=>organizationOperationUnlocked(userId,operationId,input,work,domains));operationLocks.set(key,result);try{return await result;}finally{if(operationLocks.get(key)===result)operationLocks.delete(key);}
}
async function organizationOperationUnlocked<T>(userId:number,operationId:string,input:unknown,work:()=>Promise<T>,domains:SocialDomain[]=['social','plans']):Promise<T>{
 uuid.parse(operationId);const digest=createHash('sha256').update(JSON.stringify(input)).digest('hex');
 const replay=async()=>{const [row]=await queryRows<{request_hash:string;result:string}>('SELECT request_hash,result FROM organization_operations WHERE user_id = ? AND operation_id = ?',[userId,operationId]);if(row){if(row.request_hash!==digest)throw fail('操作编号已用于其他内容',409);return {value:JSON.parse(row.result) as T};}};
 const previous=await replay();if(previous)return previous.value;
 try{return await syncTransaction(async()=>{await pool.query('INSERT INTO organization_operations (user_id,operation_id,request_hash,result) VALUES (?,?,?,?)',[userId,operationId,digest,'null']);const result=await work(),payload=result as {users?:number[];organization?:Organization;ok?:boolean};if(payload.users||payload.organization||payload.ok)await notifyOrganizationChange([userId,...payload.users||[]],'组织、成员或个人分组设置已更新',domains);await pool.query('UPDATE organization_operations SET result = ? WHERE user_id = ? AND operation_id = ?',[JSON.stringify(result),userId,operationId]);return result;});}
 catch(error){const previous=await replay();if(previous&&previous.value!==null)return previous.value;throw error;}
}
async function audit(orgId:string,userId:number,action:string,details:unknown){await pool.query('INSERT INTO organization_audit (id,organization_id,actor_id,action,details,created_at) VALUES (?,?,?,?,?,?)',[randomUUID(),orgId,userId,action,JSON.stringify(details),new Date().toISOString()]);}
export async function loadOrganization(id:string,userId=0):Promise<Organization>{
 uuid.parse(id);const [row]=await queryRows<OrgRow>('SELECT * FROM organizations WHERE id = ?'+lock(),[id]);if(!row||row.archived)throw fail('组织不存在或已归档',403);
 const members=await queryRows<{user_id:number;role:'owner'|'admin'|'member'}>('SELECT user_id,role FROM organization_members WHERE organization_id = ? AND status = ?'+lock(),[id,'active']);
 const self=members.find(m=>m.user_id===userId);if(userId&&!self)throw fail('你尚未加入这个组织',403);
 const departments=await queryRows<{id:string;name:string;parent_id:string|null;version:string}>('SELECT * FROM organization_departments WHERE organization_id = ?'+lock(),[id]);
 const assignments=await queryRows<{department_id:string;user_id:number;is_manager:number}>('SELECT * FROM organization_department_members WHERE organization_id = ?'+lock(),[id]);
 return {id,name:row.name,version:row.version,role:self?.role||'member',departments:departments.map(d=>({id:d.id,name:d.name,parentId:d.parent_id||undefined,version:d.version})),members:await Promise.all(members.map(async m=>({...await socialProfile(m.user_id),role:m.role,departmentIds:assignments.filter(d=>d.user_id===m.user_id).map(d=>d.department_id),managedDepartmentIds:assignments.filter(d=>d.user_id===m.user_id&&d.is_manager).map(d=>d.department_id)})))};
}
export async function windowGrants(windowId:string):Promise<WindowGrant[]>{return (await queryRows<{kind:WindowGrant['kind'];target_id:string;permission:WindowGrant['permission'];include_children:number}>('SELECT * FROM organization_window_grants WHERE window_id = ?'+lock(),[windowId])).map(g=>({kind:g.kind,targetId:g.target_id,permission:g.permission,includeChildren:!!g.include_children}));}
export async function organizationWindow(windowId:string,userId:number){
 const [binding]=await queryRows<Binding>('SELECT * FROM organization_windows WHERE window_id = ?',[windowId]);if(!binding)return;
 const org=await loadOrganization(binding.organization_id,userId),person=await socialProfile(userId),grants=await windowGrants(windowId),exits=await queryRows('SELECT user_id FROM organization_window_exits WHERE window_id = ? AND user_id = ?'+lock(),[windowId,userId]);
 return {binding,org,grants,access:organizationAccess(org,person.code,binding.department_id||undefined,grants,!!exits.length)};
}
async function projectWindow(binding:Binding,org:Organization,archived=false){
 const old=await queryRows<{user_id:number;status:string}>('SELECT user_id,status FROM shared_members WHERE window_id = ?',[binding.window_id]),grants=await windowGrants(binding.window_id),exits=await queryRows<{user_id:number}>('SELECT user_id FROM organization_window_exits WHERE window_id = ?',[binding.window_id]),active=new Set<number>();
 for(const member of org.members){const userId=await personId(member.code),access=organizationAccess(org,member.code,binding.department_id||undefined,grants,exits.some(e=>e.user_id===userId));if(archived||!access.permission)continue;active.add(userId);const role=access.canManage?'owner':access.permission;
  if(old.some(m=>m.user_id===userId))await pool.query('UPDATE shared_members SET role = ?,status = ? WHERE window_id = ? AND user_id = ?',[role,'active',binding.window_id,userId]);
  else await pool.query('INSERT INTO shared_members (window_id,user_id,role,status) VALUES (?,?,?,?)',[binding.window_id,userId,role,'active']);
 }
 for(const member of old)if(!active.has(member.user_id)){await pool.query('UPDATE shared_members SET status = ? WHERE window_id = ? AND user_id = ?',['left',binding.window_id,member.user_id]);await pool.query('UPDATE shared_fact_jobs SET state = ? WHERE window_id = ? AND user_id = ?',['frozen',binding.window_id,member.user_id]);}
 // A grant preview must become stale when its organization membership graph changes.
 await pool.query('UPDATE shared_windows SET version = ? WHERE id = ?',[randomUUID(),binding.window_id]);
 return [...new Set([...old.map(m=>m.user_id),...active])];
}
async function projectOrganization(org:Organization,archived=false){const ids=new Set<number>();for(const binding of await queryRows<Binding>('SELECT * FROM organization_windows WHERE organization_id = ?',[org.id]))for(const id of await projectWindow(binding,org,archived))ids.add(id);for(const member of org.members)ids.add(await personId(member.code));return [...ids];}
function prepare(org:Organization,actorCode:string,input:OrganizationChange){
 const next=structuredClone(org),actor=next.members.find(m=>m.code===actorCode)!;if(!actor)throw fail('组织成员资格已变化',403);
 const global=actor.role==='owner'||actor.role==='admin',department=(id?:string)=>{if(!managesDepartment(org,actor,id))throw fail('只能管理本部门及下级',403);};
 const target=next.members.find(m=>m.code===input.code);
 switch(input.action){
  case 'rename':if(!global)throw fail('需要组织管理员权限',403);next.name=name.parse(input.name);break;
  case 'department':{const id=input.departmentId||randomUUID(),old=next.departments.find(d=>d.id===id);if(old)department(old.id);if(!old||old.parentId!==(input.parentId||undefined))department(input.parentId||undefined);if(input.parentId&&!next.departments.some(d=>d.id===input.parentId))throw fail('上级部门不存在');const node={id,name:name.parse(input.name),parentId:input.parentId||undefined,version:randomUUID()};if(next.departments.some(d=>d.id!==id&&d.parentId===node.parentId&&d.name===node.name))throw fail('同一级已有这个部门名称');next.departments=next.departments.filter(d=>d.id!==id);next.departments.push(node);for(const d of next.departments){const path=departmentPath(next.departments,d.id);if(path.some(p=>p.parentId===d.id)||path.length>12)throw fail('部门不能循环嵌套，最多支持12级');}break;}
  case 'removeDepartment':{department(input.departmentId);if(!next.departments.some(d=>d.id===input.departmentId))throw fail('部门不存在');if(next.departments.some(d=>d.parentId===input.departmentId)||next.members.some(m=>m.departmentIds.includes(input.departmentId!)))throw fail('请先转移子部门及成员，再删除空部门');next.departments=next.departments.filter(d=>d.id!==input.departmentId);break;}
  case 'member':{if(!target)throw fail('成员不存在',404);const role=z.enum(['owner','admin','member']).parse(input.role||target.role);if(role!==target.role&&(actor.role!=='owner'||role==='owner'||target.role==='owner'))throw fail('只有组织负责人可调整管理员，所有权请使用转移操作',403);
   if(target.role==='owner'&&actor.role!=='owner')throw fail('不能修改组织负责人',403);
   const ids=[...new Set(input.departmentIds||[])],managed=[...new Set(input.managedDepartmentIds||[])];for(const id of [...ids,...managed])if(!next.departments.some(d=>d.id===id))throw fail('部门不存在');
   if(!global){if(role!==target.role||JSON.stringify([...managed].sort())!==JSON.stringify([...target.managedDepartmentIds].sort()))throw fail('只有组织管理员可任命部门负责人',403);for(const id of new Set([...target.departmentIds,...ids]))if(target.departmentIds.includes(id)!==ids.includes(id))department(id);}
   if(managed.some(id=>!ids.includes(id)))throw fail('部门负责人必须属于该部门');Object.assign(target,{role,departmentIds:ids,managedDepartmentIds:managed});break;}
  case 'removeMember':if(!global)throw fail('部门负责人可移出本部门，移出组织需要组织管理员',403);if(!target)throw fail('成员不存在',404);if(target.role==='owner'||target.role==='admin'&&actor.role!=='owner')throw fail('不能移出负责人或其他管理员',403);next.members=next.members.filter(m=>m.code!==input.code);break;
  case 'leave':if(actor.role==='owner')throw fail('负责人需先转移组织或归档');next.members=next.members.filter(m=>m.code!==actorCode);break;
  case 'transfer':if(actor.role!=='owner'||!target||target===actor)throw fail('只有负责人可将组织转移给其他现有成员',403);actor.role='admin';target.role='owner';break;
  case 'archive':if(actor.role!=='owner')throw fail('只有负责人可归档组织',403);break;
  default:throw fail('未知组织操作');
 }
 return next;
}
async function impact(before:Organization,after:Organization,archived=false):Promise<OrganizationImpact>{
 const affected=new Set<string>();let windows=0,gained=0,lost=0,changed=0;
 for(const binding of await queryRows<Binding>('SELECT * FROM organization_windows WHERE organization_id = ?',[before.id])){const grants=await windowGrants(binding.window_id);let dirty=false;for(const code of new Set([...before.members,...after.members].map(m=>m.code))){const id=await personId(code),exited=!!(await queryRows('SELECT user_id FROM organization_window_exits WHERE window_id = ? AND user_id = ?',[binding.window_id,id])).length,a=organizationAccess(before,code,binding.department_id||undefined,grants,exited),b=archived?{permission:undefined,canManage:false}:organizationAccess(after,code,binding.department_id||undefined,grants,exited);if(a.permission!==b.permission||a.canManage!==b.canManage){affected.add(code);dirty=true;if(!a.permission&&b.permission)gained++;else if(a.permission&&!b.permission)lost++;else changed++;}}if(dirty)windows++;}
 return {people:affected.size,windows,gained,lost,changed};
}
const changeSchema=z.object({action:z.enum(['rename','department','removeDepartment','member','removeMember','leave','transfer','archive']),name:name.optional(),departmentId:uuid.optional(),parentId:z.union([uuid,z.literal('')]).optional(),code:code.optional(),role:z.enum(['owner','admin','member']).optional(),departmentIds:z.array(uuid).max(100).optional(),managedDepartmentIds:z.array(uuid).max(100).optional()});
async function validateDepartmentRemoval(org:Organization,input:OrganizationChange){
 if(input.action!=='removeDepartment')return;
 const windows=await queryRows('SELECT w.id FROM organization_windows b JOIN shared_windows w ON w.id = b.window_id LEFT JOIN organization_window_grants g ON g.window_id = w.id WHERE b.organization_id = ? AND w.archived = 0 AND (b.department_id = ? OR (g.kind = ? AND g.target_id = ?)) LIMIT 1',[org.id,input.departmentId,'department',input.departmentId]);
 if(windows.length)throw fail('这个部门仍管理窗口或提供访问权限，请先调整相关窗口授权并归档其管理的窗口');
}
export async function previewOrganizationChange(id:string,userId:number,body:unknown){const input=changeSchema.parse(body),org=await loadOrganization(id,userId),next=prepare(org,(await socialProfile(userId)).code,input);await validateDepartmentRemoval(org,input);return {...await impact(org,next,input.action==='archive'),version:org.version};}
export async function changeOrganization(id:string,userId:number,body:unknown){
 const data=changeSchema.extend({version:uuid,operationId:uuid}).parse(body);
 const result=await organizationOperation(userId,data.operationId,{id,...data},async()=>{
  const org=await loadOrganization(id,userId);if(org.version!==data.version)throw fail('组织已变化，请重新查看影响范围',409);const next=prepare(org,(await socialProfile(userId)).code,data);await validateDepartmentRemoval(org,data);const affected=await impact(org,next,data.action==='archive');
  const owner=next.members.find(m=>m.role==='owner')!,version=randomUUID();await pool.query('UPDATE organizations SET name = ?,owner_id = ?,version = ?,archived = ? WHERE id = ?',[next.name,await personId(owner.code),version,data.action==='archive'?1:0,id]);
  await pool.query('DELETE FROM organization_departments WHERE organization_id = ?',[id]);for(const d of next.departments)await pool.query('INSERT INTO organization_departments (id,organization_id,parent_id,name,version) VALUES (?,?,?,?,?)',[d.id,id,d.parentId||null,d.name,d.version]);
  await pool.query('UPDATE organization_members SET status = ? WHERE organization_id = ?',['left',id]);await pool.query('DELETE FROM organization_department_members WHERE organization_id = ?',[id]);
  for(const m of next.members){const user=await personId(m.code);await pool.query('UPDATE organization_members SET role = ?,status = ? WHERE organization_id = ? AND user_id = ?',[m.role,'active',id,user]);for(const department of m.departmentIds)await pool.query('INSERT INTO organization_department_members (organization_id,department_id,user_id,is_manager) VALUES (?,?,?,?)',[id,department,user,m.managedDepartmentIds.includes(department)?1:0]);}
  await audit(id,userId,data.action,data);const users=await projectOrganization(next,data.action==='archive');for(const m of org.members)users.push(await personId(m.code));return {impact:affected,users,version};
 });await notifyOrganizationChange(result.users,'组织架构、成员或权限已更新');return {impact:result.impact,version:result.version};
}
export async function createOrganization(userId:number,body:unknown){const input=z.object({name,operationId:uuid}).parse(body);const result=await organizationOperation(userId,input.operationId,input,async()=>{const id=randomUUID();await socialProfile(userId);await pool.query('INSERT INTO organizations (id,name,owner_id,version) VALUES (?,?,?,?)',[id,input.name,userId,randomUUID()]);await pool.query('INSERT INTO organization_members (organization_id,user_id,role,status) VALUES (?,?,?,?)',[id,userId,'owner','active']);await audit(id,userId,'create',{name:input.name});return {organization:await loadOrganization(id,userId)};});await notifyOrganizationChange([userId],'组织已创建');return result;}

export async function inviteOrganization(id:string,userId:number,body:unknown){
 const input=z.object({codes:z.array(code).min(1).max(500),departmentIds:z.array(uuid).max(100),version:uuid,operationId:uuid}).parse(body);
 const result=await organizationOperation(userId,input.operationId,{id,...input},async()=>{const org=await loadOrganization(id,userId);if(input.version!==org.version)throw fail('组织已变化，请重新选择部门',409);const actorCode=(await socialProfile(userId)).code,actor=org.members.find(m=>m.code===actorCode)!;
  if(!input.departmentIds.length&&!managesDepartment(org,actor))throw fail('部门负责人只能邀请到本部门',403);for(const department of input.departmentIds)if(!org.departments.some(d=>d.id===department)||!managesDepartment(org,actor,department))throw fail('邀请部门超出管理范围',403);
  const results:{code:string;ok:boolean;message:string}[]=[],users:number[]=[];
  for(const targetCode of new Set(input.codes))try{const target=await personId(targetCode);if(org.members.some(m=>m.code===targetCode)){results.push({code:targetCode,ok:true,message:'已加入组织'});continue;}
   const [existing]=await queryRows<{id:string}>('SELECT id FROM organization_invitations WHERE organization_id = ? AND user_id = ? AND status = ?',[id,target,'pending']);if(existing){results.push({code:targetCode,ok:true,message:'已发送邀请'});continue;}
   await pool.query('INSERT INTO organization_invitations (id,organization_id,user_id,inviter_id,departments,status) VALUES (?,?,?,?,?,?)',[randomUUID(),id,target,userId,JSON.stringify(input.departmentIds),'pending']);users.push(target);results.push({code:targetCode,ok:true,message:'等待接受组织共享规则'});
  }catch(error){results.push({code:targetCode,ok:false,message:error instanceof Error?error.message:'邀请失败'});}
  await audit(id,userId,'invite',{results});return {results,users};
 });await notifyOrganizationChange([...result.users,userId],'收到组织邀请，请确认部门共享规则');return {results:result.results};
}
export async function respondOrganizationInvitation(userId:number,id:string,body:unknown){
 const input=z.object({action:z.enum(['accept','reject','withdraw']),operationId:uuid,consent:z.boolean().optional()}).parse(body);
 const result=await organizationOperation(userId,input.operationId,{id,...input},async()=>{const [invitation]=await queryRows<{id:string;organization_id:string;user_id:number;inviter_id:number;departments:string;status:string}>('SELECT * FROM organization_invitations WHERE id = ?',[uuid.parse(id)]);if(!invitation||invitation.status!=='pending')throw fail('邀请已失效',409);
  const org=await loadOrganization(invitation.organization_id);if(input.action==='withdraw'){const actorCode=(await socialProfile(userId)).code,actor=org.members.find(m=>m.code===actorCode);if(!actor||userId!==invitation.inviter_id&&!managesDepartment(org,actor))throw fail('不能撤回此邀请',403);}
  else if(invitation.user_id!==userId)throw fail('邀请不属于当前账号',403);
  if(input.action==='accept'){
   if(!input.consent)throw fail('请确认部门窗口自动加入及完成入日记规则');const departments=z.array(uuid).parse(JSON.parse(invitation.departments));if(departments.some(d=>!org.departments.some(node=>node.id===d)))throw fail('邀请部门已变化，请联系管理员重新邀请',409);
   const inviterCode=(await socialProfile(invitation.inviter_id)).code,inviter=org.members.find(m=>m.code===inviterCode);if(!inviter||(!departments.length&&!managesDepartment(org,inviter))||departments.some(d=>!managesDepartment(org,inviter,d)))throw fail('邀请人的管理权限已变化',409);
   const old=await queryRows('SELECT user_id FROM organization_members WHERE organization_id = ? AND user_id = ?',[org.id,userId]);
   if(old.length)await pool.query('UPDATE organization_members SET role = ?,status = ? WHERE organization_id = ? AND user_id = ?',['member','active',org.id,userId]);else await pool.query('INSERT INTO organization_members (organization_id,user_id,role,status) VALUES (?,?,?,?)',[org.id,userId,'member','active']);
   await pool.query('DELETE FROM organization_department_members WHERE organization_id = ? AND user_id = ?',[org.id,userId]);for(const d of departments)await pool.query('INSERT INTO organization_department_members (organization_id,department_id,user_id,is_manager) VALUES (?,?,?,?)',[org.id,d,userId,0]);await pool.query('UPDATE organizations SET version = ? WHERE id = ?',[randomUUID(),org.id]);
  }
  await pool.query('UPDATE organization_invitations SET status = ? WHERE id = ?',[input.action==='accept'?'accepted':input.action==='reject'?'rejected':'withdrawn',id]);await audit(org.id,userId,input.action+'Invitation',{id});return {users:[...await projectOrganization(await loadOrganization(org.id)),invitation.user_id,invitation.inviter_id]};
 });await notifyOrganizationChange(result.users,'组织邀请状态已更新');return {ok:true};
}
export async function personalGroups(userId:number):Promise<FriendGroup[]>{const valid=await friendCodes(userId);return (await queryRows<{id:string;name:string;codes:string;version:string}>('SELECT id,name,codes,version FROM friend_groups WHERE user_id = ?',[userId])).map(g=>({...g,codes:JSON.parse(g.codes).filter((c:string)=>valid.includes(c))}));}
export async function saveFriendGroup(userId:number,body:unknown){const input=z.object({id:uuid.optional(),name,codes:z.array(code).max(1000),version:uuid.optional(),remove:z.boolean().default(false),operationId:uuid}).parse(body);
 const result=await organizationOperation(userId,input.operationId,input,async()=>{const old=input.id?(await personalGroups(userId)).find(g=>g.id===input.id):undefined;if(input.id&&(!old||old.version!==input.version))throw fail('分组已变化或不属于当前账号',409);const id=input.id||randomUUID();
  if(input.remove){await pool.query('DELETE FROM friend_groups WHERE id = ? AND user_id = ?',[id,userId]);return {ok:true};}
  const valid=await friendCodes(userId);if(input.codes.some(c=>!valid.includes(c)))throw fail('个人分组只能包含当前好友');const codes=JSON.stringify([...new Set(input.codes)]),version=randomUUID();
  if(old)await pool.query('UPDATE friend_groups SET name = ?,codes = ?,version = ? WHERE id = ? AND user_id = ?',[input.name,codes,version,id,userId]);else await pool.query('INSERT INTO friend_groups (id,user_id,name,codes,version) VALUES (?,?,?,?,?)',[id,userId,input.name,codes,version]);return {ok:true};
 },['social']);await notifyOrganizationChange([userId],'个人好友分组已更新',['social']);return result;
}
async function friendCodes(userId:number){const rows=await queryRows<{sender_id:number;recipient_id:number}>('SELECT sender_id,recipient_id FROM social_friends WHERE (sender_id = ? OR recipient_id = ?) AND status = ?',[userId,userId,'accepted']);return Promise.all(rows.map(async row=>(await socialProfile(row.sender_id===userId?row.recipient_id:row.sender_id)).code));}
export async function expandFriendSelection(userId:number,codes:string[]=[],groupIds:string[]=[]){const groups=await personalGroups(userId);if(groupIds.some(id=>!groups.some(g=>g.id===id)))throw fail('好友分组不存在或不属于当前账号',403);return [...new Set([...codes.map(c=>c.trim().toUpperCase()),...groups.filter(g=>groupIds.includes(g.id)).flatMap(g=>g.codes)])];}
export async function organizationSnapshot(userId:number){
 const joins=await queryRows<{organization_id:string}>('SELECT m.organization_id FROM organization_members m JOIN organizations o ON o.id = m.organization_id WHERE m.user_id = ? AND m.status = ? AND o.archived = 0',[userId,'active']);
 const organizations:Organization[]=[];for(const join of joins){const org=await loadOrganization(join.organization_id,userId),left=await queryRows<{id:string;name:string}>('SELECT w.id,w.name FROM organization_window_exits e JOIN organization_windows b ON b.window_id = e.window_id JOIN shared_windows w ON w.id = e.window_id WHERE e.user_id = ? AND b.organization_id = ? AND w.archived = 0',[userId,org.id]);org.leftWindows=[];for(const window of left){const grants=await windowGrants(window.id),[binding]=await queryRows<Binding>('SELECT * FROM organization_windows WHERE window_id = ?',[window.id]);if(organizationAccess(org,(await socialProfile(userId)).code,binding.department_id||undefined,grants).permission)org.leftWindows.push(window);}organizations.push(org);}
 const invites=await queryRows<{id:string;organization_id:string;name:string;user_id:number;inviter_id:number;departments:string}>('SELECT i.*,o.name FROM organization_invitations i JOIN organizations o ON o.id = i.organization_id WHERE (i.user_id = ? OR i.inviter_id = ?) AND i.status = ? AND o.archived = 0',[userId,userId,'pending']),organizationInvitations:OrganizationInvitation[]=[];
 for(const invitation of invites){const org=await loadOrganization(invitation.organization_id);organizationInvitations.push({id:invitation.id,organizationId:org.id,organizationName:org.name,person:await socialProfile(invitation.user_id),inviter:await socialProfile(invitation.inviter_id),departmentNames:JSON.parse(invitation.departments).map((id:string)=>departmentPath(org.departments,id).map(d=>d.name).join(' / ')),direction:invitation.user_id===userId?'incoming':'outgoing'});}
 return {groups:await personalGroups(userId),organizations,organizationInvitations};
}
function validateGrants(org:Organization,actorCode:string,grants:WindowGrant[],previous:WindowGrant[]=[]){const actor=org.members.find(m=>m.code===actorCode)!;if(new Set(grants.map(g=>g.kind+':'+g.targetId)).size!==grants.length)throw fail('授权对象重复');for(const grant of [...grants,...previous.filter(old=>!grants.some(g=>g.kind===old.kind&&g.targetId===old.targetId))]){
 if(previous.some(old=>JSON.stringify(old)===JSON.stringify(grant))&&grants.some(g=>JSON.stringify(g)===JSON.stringify(grant)))continue;
 if(grant.kind==='organization'&&(grant.targetId!==org.id||!managesDepartment(org,actor)))throw fail('只有组织管理员可授权整个组织',403);
 if(grant.kind==='department'&&(!org.departments.some(d=>d.id===grant.targetId)||!managesDepartment(org,actor,grant.targetId)))throw fail('授权部门超出管理范围',403);
 if(grant.kind==='person'){const member=org.members.find(m=>m.code===grant.targetId);if(!member||!managesDepartment(org,actor)&&!member.departmentIds.some(d=>managesDepartment(org,actor,d)))throw fail('个人授权超出管理范围',403);}
 }}
export async function attachOrganizationWindow(windowId:string,userId:number,organizationId:string,departmentId:string|undefined,grantsInput:unknown){
 const org=await loadOrganization(organizationId,userId),actor=(await socialProfile(userId)).code,member=org.members.find(m=>m.code===actor)!,grants=grantsSchema.parse(grantsInput);
 if(departmentId&&!org.departments.some(d=>d.id===departmentId)||!managesDepartment(org,member,departmentId))throw fail('只能在有管理权限的部门创建窗口',403);validateGrants(org,actor,grants);
 await pool.query('INSERT INTO organization_windows (window_id,organization_id,department_id) VALUES (?,?,?)',[windowId,organizationId,departmentId||null]);for(const g of grants)await pool.query('INSERT INTO organization_window_grants (window_id,kind,target_id,permission,include_children) VALUES (?,?,?,?,?)',[windowId,g.kind,g.targetId,g.permission,g.includeChildren?1:0]);const users=await projectWindow({window_id:windowId,organization_id:organizationId,department_id:departmentId||null},org);await audit(org.id,userId,'createWindow',{windowId,grants});return users;
}
export async function changeWindowGrants(windowId:string,userId:number,body:unknown,preview=false){
 const input=z.object({grants:grantsSchema,version:uuid,operationId:uuid.optional()}).parse(body);
 const work=async()=>{const info=await organizationWindow(windowId,userId);if(!info?.access.canManage)throw fail('没有窗口授权管理权限',403);const [window]=await queryRows<{version:string}>('SELECT version FROM shared_windows WHERE id = ?',[windowId]);if(input.version!==window.version)throw fail('窗口授权已变化，请重新查看影响',409);validateGrants(info.org,(await socialProfile(userId)).code,input.grants,info.grants);
  let gained=0,lost=0,changed=0;const users:number[]=[];for(const member of info.org.members){const id=await personId(member.code),exit=!!(await queryRows('SELECT user_id FROM organization_window_exits WHERE window_id = ? AND user_id = ?',[windowId,id])).length,a=organizationAccess(info.org,member.code,info.binding.department_id||undefined,info.grants,exit),b=organizationAccess(info.org,member.code,info.binding.department_id||undefined,input.grants,exit);if(a.permission!==b.permission){users.push(id);if(!a.permission)gained++;else if(!b.permission)lost++;else changed++;}}
  const impact={people:users.length,windows:users.length?1:0,gained,lost,changed};if(preview)return {impact};
  await pool.query('DELETE FROM organization_window_grants WHERE window_id = ?',[windowId]);for(const g of input.grants)await pool.query('INSERT INTO organization_window_grants (window_id,kind,target_id,permission,include_children) VALUES (?,?,?,?,?)',[windowId,g.kind,g.targetId,g.permission,g.includeChildren?1:0]);await pool.query('UPDATE shared_windows SET version = ? WHERE id = ?',[randomUUID(),windowId]);await audit(info.org.id,userId,'windowGrants',{windowId,grants:input.grants});return {impact,users:await projectWindow(info.binding,info.org)};
 };if(preview)return work();const result=await organizationOperation(userId,uuid.parse(input.operationId),{windowId,...input},work);if('users' in result)await notifyOrganizationChange(result.users||[],'组织窗口授权已更新');return {impact:result.impact};
}
export async function leaveOrganizationWindow(windowId:string,userId:number,action:'leave'|'rejoin'){
 const [binding]=await queryRows<Binding>('SELECT * FROM organization_windows WHERE window_id = ?',[windowId]);if(!binding)return false;
 let users:number[]=[];await syncTransaction(async()=>{const org=await loadOrganization(binding.organization_id,userId),grants=await windowGrants(windowId),access=organizationAccess(org,(await socialProfile(userId)).code,binding.department_id||undefined,grants);if(action==='leave'&&access.canManage)throw fail('请先解除对应组织或部门管理职责再退出');
  await pool.query('DELETE FROM organization_window_exits WHERE window_id = ? AND user_id = ?',[windowId,userId]);if(action==='leave')await pool.query('INSERT INTO organization_window_exits (window_id,user_id) VALUES (?,?)',[windowId,userId]);else if(!access.permission)throw fail('当前部门或个人授权不允许重新加入',403);
  await audit(org.id,userId,action+'Window',{windowId});users=await projectWindow(binding,org);await notifyOrganizationChange(users,action==='leave'?'成员已退出组织窗口':'成员已重新加入组织窗口');
 });await notifyOrganizationChange(users,'组织窗口成员已更新');return true;
}
export async function registerOrganizations(app:FastifyInstance){
 app.post('/api/friend-groups',request=>saveFriendGroup(request.userId!,request.body));
 app.post('/api/organizations',request=>createOrganization(request.userId!,request.body));
 app.post('/api/organizations/:id/preview',request=>previewOrganizationChange((request.params as {id:string}).id,request.userId!,request.body));
 app.post('/api/organizations/:id/actions',request=>changeOrganization((request.params as {id:string}).id,request.userId!,request.body));
 app.post('/api/organizations/:id/invitations',request=>inviteOrganization((request.params as {id:string}).id,request.userId!,request.body));
 app.post('/api/organization-invitations/:id/respond',request=>respondOrganizationInvitation(request.userId!,(request.params as {id:string}).id,request.body));
 app.post('/api/shared-windows/:id/grants/preview',request=>changeWindowGrants((request.params as {id:string}).id,request.userId!,request.body,true));
 app.post('/api/shared-windows/:id/grants',request=>changeWindowGrants((request.params as {id:string}).id,request.userId!,request.body));
 app.get('/api/organizations/:id/audit',async request=>{const org=await loadOrganization((request.params as {id:string}).id,request.userId!);if(org.role==='member')throw fail('需要组织管理员权限',403);return {entries:await Promise.all((await queryRows<{id:string;actor_id:number;action:string;details:string;created_at:string}>('SELECT * FROM organization_audit WHERE organization_id = ? ORDER BY created_at DESC LIMIT 100',[org.id])).map(async row=>({id:row.id,actor:await socialProfile(row.actor_id),action:row.action,details:JSON.parse(row.details),createdAt:row.created_at})))};});
}
