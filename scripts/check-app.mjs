import { Client } from "ssh2";
const c = new Client();
c.on("ready", async () => {
  const run = (cmd) => new Promise((res) => c.exec(cmd, (e, s) => {
    let o = ""; s.on("data", d => o += d); s.stderr.on("data", d => o += d);
    s.on("close", () => { console.log(cmd, "\n" + o); res(); });
  }));
  await run("docker exec diary-app ls /app/node_modules | head -10");
  await run("docker exec diary-app node -e \"import('./apps/api/dist/index.js').catch(e=>console.error('ERR:',e.message))\" 2>&1 | head -10");
  await run("docker ps | grep diary");
  c.end();
});
c.connect({ host: "47.115.220.98", port: 22, username: "root", password: "MdHJCDMyYDtK4P", readyTimeout: 15000 });
