import { Client } from "ssh2";
const c = new Client();
c.on("ready", () => {
  c.exec("ls -la /opt/diary/apps/api/dist/server.js /opt/diary/apps/api/dist/markdown.js; echo '==='; unzip -p /opt/diary/dist-update.zip server.js 2>/dev/null | grep -c 'upload'; echo 'count done'", (e, s) => {
    let o = "";
    s.on("data", (d) => (o += d));
    s.on("close", () => { console.log(o); c.end(); });
  });
}).connect({ host: "47.115.220.98", port: 22, username: "root", password: "MdHJCDMyYDtK4P", readyTimeout: 15000 });
