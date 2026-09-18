import { Client } from "ssh2";
const c = new Client();
c.on("ready", () => {
  const cmd = "find /opt/diary/vault -name '2026-09-10.md' 2>/dev/null";
  c.exec(cmd, (e, s) => {
    let o = ""; s.on("data", d => o += d);
    s.on("close", () => {
      console.log("FOUND:", o || "not found");
      if (o.trim()) {
        const catCmd = `head -30 "${o.trim()}"`;
        c.exec(catCmd, (e2, s2) => {
          let o2 = ""; s2.on("data", d => o2 += d);
          s2.on("close", () => { console.log("--- CONTENT ---"); console.log(o2); c.end(); });
        });
      } else { c.end(); }
    });
  });
});
c.connect({ host: "47.115.220.98", port: 22, username: "root", password: "MdHJCDMyYDtK4P", readyTimeout: 15000 });
