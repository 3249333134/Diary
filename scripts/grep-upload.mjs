import { Client } from "ssh2";
const c = new Client();
c.on("ready", () => {
  c.exec("docker exec diary-app grep -l 'upload' /app/apps/api/dist/*.js; echo '==='; docker exec diary-app node -e \"const http=require('http');const r=http.request({host:'127.0.0.1',port:4319,path:'/',method:'GET'},res=>{let d='';res.on('data',c=>d+=c);res.on('end',()=>console.log('status:',res.statusCode,'first 200:',d.slice(0,200)));});r.end();\" 2>&1", (e, s) => {
    let o = "";
    s.on("data", (d) => (o += d));
    s.on("close", () => { console.log(o); c.end(); });
  });
}).connect({ host: "47.115.220.98", port: 22, username: "root", password: "MdHJCDMyYDtK4P", readyTimeout: 15000 });
