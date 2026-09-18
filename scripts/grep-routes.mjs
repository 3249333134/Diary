import { Client } from "ssh2";
const c = new Client();
c.on("ready", () => {
  c.exec("grep -c 'upload' /opt/diary/apps/api/dist/server.js 2>&1; echo '==='; docker exec diary-app grep -c 'upload' /app/apps/api/dist/server.js 2>&1; echo '==='; docker exec diary-app grep -o '/api/[a-z-]*' /app/apps/api/dist/server.js | sort -u 2>&1", (e, s) => {
    let o = "";
    s.on("data", (d) => (o += d));
    s.on("close", () => { console.log(o); c.end(); });
  });
}).connect({ host: "47.115.220.98", port: 22, username: "root", password: "MdHJCDMyYDtK4P", readyTimeout: 15000 });
