import { Client } from "ssh2";
const c = new Client();
c.on("ready", async () => {
  const run = (cmd) => new Promise((res) => c.exec(cmd, (e, s) => { let o = ""; s.on("data", d => o += d); s.stderr.on("data", d => o += d); s.on("close", () => { console.log(">>> " + cmd.substring(0, 120) + "\n" + o); res(); }); }));
  // 找到 23h 前的好镜像
  await run("docker rm -f diary-app 2>/dev/null; docker rm -f save-good 2>/dev/null; docker run -d --name save-good 06c4a21184d9 tail -f /dev/null");
  await new Promise(r => setTimeout(r, 2000));
  // 把好镜像里的所有东西覆盖到当前镜像
  await run("docker cp save-good:/app/node_modules /opt/diary/good-node_modules 2>&1 | tail -3");
  await run("docker exec save-good ls /app/node_modules | head -5");
  await run("docker rm -f save-good");
  // 用 good node_modules 更新当前镜像
  await run("docker run -d --name diary-app-good ddc314d538c6 tail -f /dev/null");
  await new Promise(r => setTimeout(r, 1500));
  await run("docker cp /opt/diary/good-node_modules/. diary-app-good:/app/node_modules/");
  await run("docker cp /opt/diary/apps/api/dist/. diary-app-good:/app/apps/api/dist/");
  await run("docker cp /opt/diary/apps/web/dist/. diary-app-good:/app/apps/web/dist/");
  await run("docker commit diary-app-good diary-app:latest");
  await run("docker rm -f diary-app-good");
  await run("docker run -d --name diary-app --restart=unless-stopped --network host --env-file /opt/diary/.env -e OBSIDIAN_DIR=/app/vault -e HOST=127.0.0.1 -v /opt/diary/vault:/app/vault diary-app");
  await new Promise(r => setTimeout(r, 4000));
  await run("docker logs diary-app --tail 8");
  c.end();
});
c.connect({ host: "47.115.220.98", port: 22, username: "root", password: "MdHJCDMyYDtK4P", readyTimeout: 15000 });
