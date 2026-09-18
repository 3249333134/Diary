import { Client } from "ssh2";
const c = new Client();
c.on("ready", () => {
  c.exec("docker exec diary-app sh -c 'pwd; ls; node apps/api/dist/index.js 2>&1 | head -20'", (e, s) => {
    let o = "";
    s.on("data", d => o += d);
    s.on("close", () => { console.log(o); c.end(); });
  });
}).connect({ host: "47.115.220.98", port: 22, username: "root", password: "MdHJCDMyYDtK4P", readyTimeout: 15000 });
