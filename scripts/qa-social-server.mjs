import path from 'node:path';
const database=process.env.SOCIAL_QA_DB;if(!database)throw new Error('An isolated QA database is required');
Object.assign(process.env,{HOST:'127.0.0.1',DIARY_DEMO_DB:database,DIARY_DATA_DIR:path.dirname(database),AI_API_KEY:'',AI_AUTO_SUMMARY:'false',DIARY_TIMEZONE:'Asia/Shanghai'});
const {buildServer}=await import('../apps/api/dist/server.js');
const app=await buildServer();await app.listen({host:'127.0.0.1',port:Number(process.env.SOCIAL_QA_PORT||4321)});
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>void app.close().then(()=>process.exit(0)));
