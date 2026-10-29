import {randomUUID} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {organizationExampleName,organizationExamplePaths} from './fixtures/organization-example.mjs';

const base='http://127.0.0.1:4320';
const call=async(path,body)=>{const response=await fetch(base+path,{method:body?'POST':'GET',headers:body?{'content-type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined});const result=await response.json();if(!response.ok)throw new Error(`${path}: ${response.status} ${result.message||result.error||'请求失败'}`);return result;};
const accounts=await call('/api/demo/accounts');if(!Array.isArray(accounts.accounts))throw new Error('这里只能创建本地隔离演示示例');
const before=await call('/api/social');if(before.profile.name!=='本地演示')throw new Error('请使用本地演示身份创建示例');
const privateBefore=(await call('/api/actions')).tasks.length;
let org=before.organizations.find(o=>o.name===organizationExampleName&&o.role==='owner');
if(!org)org=(await call('/api/organizations',{name:organizationExampleName,operationId:randomUUID()})).organization;
for(const path of organizationExamplePaths){
 let parentId;
 for(const name of path.slice(0,-1)){const parent=org.departments.find(d=>d.name===name&&d.parentId===parentId);if(!parent)throw new Error('示例上级部门缺失');parentId=parent.id;}
 if(org.departments.some(d=>d.name===path.at(-1)&&d.parentId===parentId))continue;
 await call(`/api/organizations/${org.id}/actions`,{action:'department',departmentId:randomUUID(),parentId:parentId||'',name:path.at(-1),version:org.version,operationId:randomUUID()});
 org=(await call('/api/social')).organizations.find(o=>o.id===org.id);
}
const after=await call('/api/social'),privateAfter=(await call('/api/actions')).tasks.length;
const preserved=before.organizations.filter(o=>o.id!==org.id).every(o=>after.organizations.some(next=>next.id===o.id&&next.version===o.version));
if(!preserved||privateBefore!==privateAfter||before.windows.length!==after.windows.length||before.friends.length!==after.friends.length)throw new Error('既有数据核对未通过');
const result={name:org.name,organizationId:org.id,departments:org.departments.length,departmentLevels:3,paths:organizationExamplePaths.map(path=>path.join(' / ')),existingOrganizationsPreserved:preserved,privateTaskCount:privateAfter,sharedWindowCount:after.windows.length,friendCount:after.friends.length};
await mkdir('qa/organization-hierarchy',{recursive:true});await writeFile('qa/organization-hierarchy/demo-example.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
