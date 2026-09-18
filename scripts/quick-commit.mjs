import { Client } from "ssh2";
const c = new Client();
c.on("ready", async () => {
  const run = (cmd) => new Promise((res) => c.exec(cmd, (e, s) => {
    let o = ""; s.on("data", d => o += d); s.stderr.on("data", d => o += d);
    s.on("close", () => { console.log(">>> " + cmd.substring(0, 120) + "\n" + o); res(); });
  }));
  await run("docker rm -f diary-app diary-build 2>/dev/null");
  // Use current good image as base
  await run("docker run -d --name diary-build 2e478827a071 tail -f /dev/null");
  await new Promise(r => setTimeout(r, 1500));
  // Update dist files from host (upload-dist.mjs already put them in /opt/diary)
  await run("docker cp /opt/diary/apps/api/dist/. diary-build:/app/apps/api/dist/");
  await run("docker cp /opt/diary/apps/web/dist/. diary-build:/app/apps/web/dist/");
  await run("docker commit diary-build diary-app:latest");
  await run("docker rm -f diary-build");
  await run("docker run -d --name diary-app --restart=unless-stopped --network host --env-file /opt/diary/.env -e OBSIDIAN_DIR=/app/vault -e HOST=127.0.0.1 -v /opt/diary/vault:/app/vault diary-app node apps/api/dist/index.js");
  await new Promise(r => setTimeout(r, 4000));
  await run("docker logs diary-app --tail 3");
  c.end();
});
c.connect({ host: "47.115.220.98", port: 22, username: "root", password: "MdHJCDMyYDtK4P", readyTimeout: 15000 });
