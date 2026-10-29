export function creationFieldLocation(path:string){
 const clean=path.replace(/^todos\.\d+\./,'').replace(/^facts\.events\.\d+\./,'').replace(/^entries\.\w+\.\d+\./,'');
 const name=clean.split('.')[0];
 const field=/^(title|note|content|excerpt)$/.test(name)?'content':/^(remark|description)$/.test(name)?'description':name;
 const group=['category','important','urgent','priority','list'].includes(field)?'classification':['startDate','startTime','repeat','checkinEnabled'].includes(field)?'repeat':['entities','people','places','activities','foods','description'].includes(field)?'entities':['tags','attachments','planAttachments'].includes(field)?'attachments':undefined;
 return {field:field==='dueDate'||field==='dueTime'?'date':field,group};
}
export function focusCreationIssue(root:HTMLElement|null,path=''){
 if(!root)return;const {field,group}=creationFieldLocation(path),container=root.querySelector<HTMLElement>(`[data-create-field="${CSS.escape(field)}"]`)||(group?root.querySelector<HTMLElement>(`[data-create-group="${group}"] .creation-group-body`):null)||root.querySelector<HTMLElement>('[data-create-field="content"]');
 if(!container)return;let parent:HTMLElement|null=container;while(parent){if(parent instanceof HTMLDetailsElement)parent.open=true;parent=parent.parentElement;}
 requestAnimationFrame(()=>{const el=container.matches('input,textarea,button')?container:container.querySelector<HTMLElement>('input:not([hidden]):not([type=radio]),textarea,button,[tabindex="0"]')||container;el.scrollIntoView({block:'center'});el.focus({preventScroll:true});});
}
