import { Client } from "ssh2";
const c = new Client();
c.on("ready", async () => {
  const run = (cmd) => new Promise((res) => c.exec(cmd, (e, s) => {
    let o = ""; s.on("data", d => o += d); s.stderr.on("data", d => o += d);
    s.on("close", () => { console.log(">>> " + cmd.substring(0, 100) + "\n" + o); res(); });
  }));
  await run("docker stop diary-app 2>/dev/null; docker rm diary-app 2>/dev/null; docker run -d --name diary-app --restart=unless-stopped --network host --env-file /opt/diary/.env -e OBSIDIAN_DIR=/app/vault -e HOST=127.0.0.1 -v /opt/diary/vault:/app/vault diary-app");
  await new Promise(r => setTimeout(r, 4000));
  await run("docker logs diary-app --tail 5");
  c.end();
});
c.connect({ host: "47.115.220.98", port: 22, username: "root", password: "MdHJCDMyYDtK4P", readyTimeout: 15000 });
