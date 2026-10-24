import path from 'node:path';
import { mkdir, readFile, readdir, cp, unlink, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';

// All paths and services are isolated before loading configuration or vault code.
const root = path.resolve(import.meta.dirname, '..');
const demo = path.join(root, 'data', 'demo');
if (process.argv.includes('--reset')) {
  if (path.resolve(demo) !== path.join(root, 'data', 'demo')) throw new Error('演示路径校验失败');
  const probe=createServer();
  try { await new Promise((resolve,reject)=>{probe.once('error',reject);probe.listen(4320,'127.0.0.1',resolve);}); }
  catch { throw new Error('演示程序仍在运行，请先关闭再重置。'); }
  await new Promise(resolve=>probe.close(resolve));
  // Windows tools may hold directory handles: back up and clear files, retaining folders.
  try {
    await cp(demo, `${demo}-backup-${Date.now()}`, {recursive:true});
    const clear=async(dir)=>{
      const resolved=path.resolve(dir);
      if(resolved!==demo&&!resolved.startsWith(demo+path.sep))throw new Error('重置路径越界');
      for(const entry of await readdir(resolved,{withFileTypes:true})){
        const file=path.join(resolved,entry.name);
        if(entry.isSymbolicLink())throw new Error('演示目录存在链接，停止重置');
        if(entry.isDirectory())await clear(file);else await unlink(file);
      }
    };
    await clear(demo);
  } catch (e) { if (e.code !== 'ENOENT') throw e; }
}
await mkdir(demo, { recursive: true });
Object.assign(process.env, { HOST:'127.0.0.1',DIARY_DEMO_DB:path.join(demo,'diary.sqlite'),OBSIDIAN_DIR: path.join(demo, 'vault'), DIARY_DATA_DIR: path.join(demo, 'state'), DIARY_TIMEZONE: 'Asia/Shanghai', AI_API_KEY: 'demo-local-only', AI_MODEL: 'demo', AI_PROXY: '', AI_AUTO_SUMMARY: 'false' });
const dateAt = (offset=0) => { const d=new Date(); d.setDate(d.getDate()+offset); return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(d); };
const shift = (date, days) => {const d=new Date(`${date}T00:00:00Z`);d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10);};
const mock = createServer(async (req,res) => {
  try {
    let body='';for await(const chunk of req)body+=chunk;
    const payload=JSON.parse(body), input=JSON.parse(payload.messages.at(-1).content);
    if(input.text.includes('模拟失败')) {res.writeHead(503).end();return;}
    const today=dateAt();
    const drafts=input.text.split(/[。；\n]+/).map(t=>t.trim()).filter(Boolean).map(content=>{
      const kind=/明天|后天|计划|安排|待办|需要|每天|每日|每周|每月/.test(content)?'plan':'facts';
      const date=content.includes('后天')?shift(today,2):content.includes('明天')?shift(today,1):content.includes('昨天')?shift(today,-1):kind==='plan'?'':today;
      const category=/工作|会议|开会|客户|项目/.test(content)?'work':/个人|生活|买菜|运动|家/.test(content)?'personal':null;
      const time=content.match(/(?:[01]?\d|2[0-3]):[0-5]\d/)?.[0].padStart(5,'0')||(/三点/.test(content)?'15:00':'');
      const weekdayText=content.match(/每周([日一二三四五六天、，和]+)/)?.[1]||'';
      const weekdays=[...new Set([...weekdayText.matchAll(/[日一二三四五六天]/g),...content.matchAll(/(?:周|星期)([日一二三四五六天])/g)].map(m=>'日一二三四五六'.indexOf((m[1]||m[0])==='天'?'日':m[1]||m[0])))];
      const repeat=/每天|每日/.test(content)?{type:'daily',interval:1}:/每周/.test(content)?{type:'weekly',interval:1,weekdays}:/每月/.test(content)?{type:'monthly',interval:1,monthDay:Number(content.match(/每月(\d+)/)?.[1]||today.slice(-2))}:null;
      return {kind,content,date:date||today,time,repeat,startDate:kind==='plan'&&/开始/.test(content)?date:'',startTime:kind==='plan'&&/开始/.test(content)?time:'',category,important:content.includes('重要')?true:null,urgent:content.includes('紧急')?true:null,tags:[],entities:{people:content.includes('张三')?[{type:'person',name:'张三',tags:['同事']}]:[],places:content.includes('办公室')?[{type:'place',name:'办公室',tags:[]}]:[],activities:[],foods:[]}};
    });
    res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{message:{content:JSON.stringify({drafts})}}]}));
  } catch {res.writeHead(400).end();}
});
await new Promise(resolve=>mock.listen(0,'127.0.0.1',resolve));
process.env.AI_API_URL=`http://127.0.0.1:${mock.address().port}/v1`;
const { emptyDiary, todoSchema, diaryEventSchema } = await import('../packages/contracts/dist/index.js');
const { loadDiary, saveDiary, writeJson, listDiaryDates, readJson } = await import('../apps/api/dist/vault.js');
const { vaultPaths } = await import('../apps/api/dist/config.js');
const marker=path.join(demo,'initialized.json');
let initialized=(await listDiaryDates(1)).length>0;
if(!initialized){
  const today=dateAt();
  const entity=(type,name,tags=[])=>({type,name,tags});
  for(let day=-6;day<=0;day++){
    const date=shift(today,day),doc=emptyDiary(date);
    doc.weather='晴';doc.sleep='7.5h';doc.mood='平静';
    doc.facts.events=[diaryEventSchema.parse({id:randomUUID(),time:'09:00',note:'与张三整理项目资料',tags:['项目'],people:[entity('person','张三',['同事'])],places:[entity('place','办公室')],activities:[entity('activity','整理资料',['项目'])]}),diaryEventSchema.parse({id:randomUUID(),time:'18:30',note:'在家准备晚餐',tags:['生活'],places:[entity('place','家')],foods:[entity('food','面条')],activities:[entity('activity','烹饪')]})];
    if(day===0){
      const titles=['确认客户方案','处理项目风险','准备周汇报','学习新工具','整理收件箱','回复一般邮件','归档旧资料','清理文件','预约体检','安排家人聚餐','阅读与运动','规划旅行','购买日用品','取快递','整理衣柜','浏览收藏','提交报表','补充项目材料','准备会议','日常散步','预约维修','整理书桌','历史待办甲','历史待办乙','已取消的安排','回收站示例'];
      doc.todos=titles.map((title,i)=>todoSchema.parse({id:randomUUID(),title,category:i<8||i>=16&&i<19?'work':i<22?'personal':null,important:i<22?i%4<2:null,urgent:i<22?i%2===0:null,startDate:i<22?shift(today,i%3):'',startTime:i<22?'09:00':'',dueDate:i%5===0?'':shift(today,(i%4)-1),dueTime:i%3===0?'17:00':'',description:'演示原计划背景；自动记录不会推测完成成果。',tags:i%2?['生活','阅读']:['项目','张三'],list:i%2?'日常':'项目推进',source:i===0?{date,kind:'facts',id:doc.facts.events[0].id,summary:doc.facts.events[0].note}:undefined,entities:i%2?[entity('place','家')]:[entity('person','张三',['同事']),entity('place','办公室')],status:i===24?'cancelled':'todo',deletedAt:i===25?new Date().toISOString():undefined}));
      for(const i of [6,14]){
        const task=doc.todos[i],id=randomUUID();
        doc.facts.events.push(diaryEventSchema.parse({id,time:'10:20',note:`完成计划：${task.title}`,remark:`原计划说明：${task.description}\n原定开始：${task.startDate} ${task.startTime}`,plannedStart:{date:task.startDate,time:task.startTime},tags:task.tags,task:{date,kind:'todo',id:task.id,summary:task.title}}));
        Object.assign(task,{done:true,status:'done',completedAt:`${date}T10:20:00+08:00`,completion:{date,kind:'facts',id,summary:`完成计划：${task.title}`}});
      }
    }
    await saveDiary(date,doc,(await loadDiary(date,1)).version,1);
  }
  await writeJson(`${vaultPaths.system}/shared-tags.json`,['项目','同事','生活','阅读','张三'],1);
  await writeJson(`${vaultPaths.system}/plan-views.json`,[{id:randomUUID(),name:'项目相关',color:'#7c6cd9',tags:['项目','张三']}],1);
  await writeFile(marker,JSON.stringify({createdAt:new Date().toISOString(),plans:26,diaryDays:7}));
}
if(!await readJson('demo-schedule-v1',false,1)) {
  const today=dateAt(),current=await loadDiary(today,1);
  for(const [type,title,time] of [['daily','每天阅读','20:00'],['weekly','每周项目例会','15:00'],['monthly','每月整理账单','18:00']]){
    const id=randomUUID(),task=todoSchema.parse({id,title,dueDate:today,dueTime:time,startDate:today,startTime:type==='daily'?'19:30':time,recurrenceAnchor:today,repeat:{type,interval:1,...(type==='weekly'?{weekdays:[1,3]}:type==='monthly'?{monthDay:31}:{})},category:type==='weekly'?'work':'personal',important:true,urgent:false,entities:[{type:'person',name:'张三',tags:['同事']},{type:'place',name:type==='weekly'?'办公室':'家',tags:[]}],description:'重复示例：每一期独立完成，拖动只改这期截止时间。'});
    task.seriesTemplate=todoSchema.parse(task);current.document.todos.push(task);
  }
  await saveDiary(today,current.document,current.version,1);await writeJson('demo-schedule-v1',true,1);
}
if(process.argv.includes('--init-only')){mock.close();console.log('演示知识库已初始化（重复运行不会重复生成）');process.exit(0);}
const { buildServer }=await import('../apps/api/dist/server.js');
const app=await buildServer();
if(!await readJson('demo-social-v1',false,1)){
  const {socialSnapshot,socialProfile,requestFriend,respondFriend,createWindow,inviteMember,changeMember,changeSharedTask,listSharedTasks}=await import('../apps/api/dist/social.js');
  const {queryRows}=await import('../apps/api/dist/db.js');
  const peers=await Promise.all(['演示好友小林','演示好友小周'].map(async username=>(await queryRows('SELECT id FROM users WHERE username = ?',[username]))[0].id));
  for(const id of peers){
    const profile=await socialProfile(id);let state=await socialSnapshot(1);
    if(!state.friends.some(f=>f.code===profile.code)){
      if(!state.requests.some(r=>r.person.code===profile.code))await requestFriend(1,profile.code);
      state=await socialSnapshot(1);const request=state.requests.find(r=>r.person.code===profile.code);if(request)await respondFriend(request.direction==='outgoing'?id:1,request.id,'accept');
    }
  }
  const name='共享演示 · 一起安排';const win=(await socialSnapshot(1)).windows.find(w=>w.name===name)||await createWindow(1,{name,color:'#7963bd'});
  for(const [index,id]of peers.entries()){
    const code=(await socialProfile(id)).code,membership=(await socialSnapshot(1)).windows.find(w=>w.id===win.id).members.find(m=>m.code===code);
    if(!membership)await inviteMember(win.id,1,code,index===0?'editor':'viewer');
    if(index===0&&!(await socialSnapshot(id)).windows.some(w=>w.id===win.id))await changeMember(win.id,id,'accept');
  }
  const examples=[['demo-shared-reading','一起阅读与复盘','20:00',{type:'daily',interval:1}],['demo-shared-weekend','准备周末共同安排','15:00',null]];
  for(const [id,title,time,repeat]of examples)if(!(await listSharedTasks(1)).some(r=>r.task.id===id))await changeSharedTask(win.id,1,{mode:'create',date:dateAt(),version:'0',operationId:randomUUID(),task:todoSchema.parse({id,title,dueDate:dateAt(),dueTime:time,startDate:dateAt(),startTime:time,repeat,important:true,urgent:false,description:'本地共享演示：切换到“演示好友小林”可验证协作；小周需先接受邀请。'})});
  await writeJson('demo-social-v1',{windowId:win.id},1);
}
await app.listen({host:'127.0.0.1',port:4320});
console.log('演示入口：http://127.0.0.1:4320/ · 独立知识库 · 本地模拟 AI');
const shutdown=async()=>{await app.close();mock.close();process.exit(0);};
process.on('SIGINT',shutdown);process.on('SIGTERM',shutdown);
