import {diaryDocumentSchema,fieldLimit} from '@diary/contracts';
export function FieldHint({value,path,limit=fieldLimit(diaryDocumentSchema,path)}:{value:string;path:string;limit?:number}){
 if(limit==null||value.length<limit*.8)return null;
 const invalid=value.length>limit;
 return <small className="field-hint" role={invalid?'alert':undefined}>{value.length.toLocaleString('zh-CN')} / {limit.toLocaleString('zh-CN')} 字符{invalid?'，请缩短内容后保存':''}</small>;
}
