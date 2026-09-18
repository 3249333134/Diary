import { Client } from "ssh2";
const c = new Client();
c.on("ready", () => {
  c.exec("cat /opt/diary/Dockerfile; echo '==='; docker exec diary-app ls /app/apps/api/dist/ | head; echo '==='; docker exec diary-app find /app -name 'server.js' 2>/dev/null", (e, s) => {
    let o = "";
    s.on("data", (d) => (o += d));
    s.on("close", () => { console.log(o); c.end(); });
  });
}).connect({ host: "47.115.220.98", port: 22, username: "root", password: "MdHJCDMyYDtK4P", readyTimeout: 15000 });
