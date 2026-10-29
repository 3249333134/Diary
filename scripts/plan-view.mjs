export async function selectPlanView(page,label){
 const nav=page.getByRole('navigation',{name:'计划视图'}),direct=nav.getByRole('button',{name:label,exact:true});
 if(await direct.count())await direct.click();else{await nav.locator('.glass-select-trigger').click();await page.getByRole('option',{name:label,exact:true}).click();}
}
export async function selectCreationDraft(page,index){
 const dialog=page.locator('.creation-dialog');await dialog.getByRole('button',{name:/^AI草稿/}).click();await dialog.getByRole('button',{name:/核对AI草稿$/}).click();await page.getByRole('option',{name:new RegExp('^'+index+' ·')}).click();
}
