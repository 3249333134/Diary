import { Client } from "ssh2";
const c = new Client();
c.on("ready", async () => {
  const run = (cmd) => new Promise((res) => c.exec(cmd, (e, s) => {
    let o = ""; s.on("data", d => o += d); s.stderr.on("data", d => o += d);
    s.on("close", () => { console.log(">>> " + cmd.substring(0, 140) + "\n" + o); res(); });
  }));
  await run("docker rm -f diary-app diary-build 2>/dev/null");
  await run("docker run -d --name diary-build 5b916fca1cfdd21f5c7b0832ca225fdcb816da578b913549f149aa4f1f3317f5 tail -f /dev/null");
  await new Promise(r => setTimeout(r, 1500));
  // Upload api web dists
  await run("docker cp /opt/diary/apps/api/dist/. diary-build:/app/apps/api/dist/");
  await run("docker cp /opt/diary/apps/web/dist/. diary-build:/app/apps/web/dist/");
  // CRITICAL: also update @diary/contracts in node_modules!
  await run("docker cp /opt/diary/node_modules/@diary/contracts/dist/. diary-build:/app/node_modules/@diary/contracts/dist/");
  await run("docker cp /opt/diary/node_modules/@diary/contracts/package.json diary-build:/app/node_modules/@diary/contracts/package.json");
  // Verify
  await run("docker exec diary-build grep attachments /app/node_modules/@diary/contracts/dist/index.js | head -3");
  await run("docker commit diary-build diary-app:latest");
  await run("docker rm -f diary-build");
  await run("docker run -d --name diary-app --restart=unless-stopped --network host --env-file /opt/diary/.env -e OBSIDIAN_DIR=/app/vault -e HOST=127.0.0.1 -v /opt/diary/vault:/app/vault diary-app node apps/api/dist/index.js");
  await new Promise(r => setTimeout(r, 4000));
  await run("docker logs diary-app --tail 3");
  c.end();
});
c.connect({ host: "47.115.220.98", port: 22, username: "root", password: "MdHJCDMyYDtK4P", readyTimeout: 15000 });
