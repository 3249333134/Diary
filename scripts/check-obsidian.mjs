import { Client } from "ssh2";
const c = new Client();
c.on("ready", () => {
  const run = (cmd) => new Promise((res) => c.exec(cmd, (e, s) => {
    let o = ""; s.on("data", d => o += d); s.stderr.on("data", d => o += d);
    s.on("close", () => { console.log(">>> " + cmd.substring(0, 140) + "\n" + o); res(); });
  }));
  (async () => {
    await run("find /opt/diary/vault -name '2026-09-09.md' -exec cat {} \\;");
    await run("echo ==== ASSETS DIR ==== && ls -laR /opt/diary/vault/assets/ 2>&1 | head -30");
    c.end();
  })();
});
c.connect({ host: "47.115.220.98", port: 22, username: "root", password: "MdHJCDMyYDtK4P", readyTimeout: 15000 });
