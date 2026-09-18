import { Client } from "ssh2";
const c = new Client();
c.on("ready", () => {
  c.exec("docker exec diary-app curl -s http://127.0.0.1:4319/api/diaries/2026-09-10 | head -c 200; echo '---'; docker exec diary-app node -e \"import('./dist/server.js').then(m=>{m.buildServer().then(a=>{a.ready().then(()=>{console.log('routes:',a.printRoutes());process.exit(0);});});});\" 2>&1 | tail -20", (e, s) => {
    let o = "";
    s.on("data", (d) => (o += d));
    s.on("close", () => { console.log(o); c.end(); });
  });
}).connect({ host: "47.115.220.98", port: 22, username: "root", password: "MdHJCDMyYDtK4P", readyTimeout: 15000 });
