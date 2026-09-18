import { Client } from "ssh2";
const c = new Client();
c.on("ready", () => {
  c.exec("docker exec diary-app sed -n '195,202p;236,242p' /app/apps/api/dist/markdown.js", (e, s) => {
    let o = ""; s.on("data", d => o += d);
    s.on("close", () => { console.log(o); c.end(); });
  });
});
c.connect({ host: "47.115.220.98", port: 22, username: "root", password: "MdHJCDMyYDtK4P", readyTimeout: 15000 });
