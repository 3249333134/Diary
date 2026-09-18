import { Client } from "ssh2";
const c = new Client();
c.on("ready", async () => {
  const run = (cmd) => new Promise((res) => c.exec(cmd, (e, s) => { let o = ""; s.on("data", d => o += d); s.stderr.on("data", d => o += d); s.on("close", () => { console.log(">>> " + cmd.substring(0, 120) + "\n" + o); res(); }); }));
  // Use the good base image 06c4a21184d9 as starting point
  await run("docker rm -f diary-app 2>/dev/null; docker run -d --name diary-build 06c4a21184d9 tail -f /dev/null");
  await new Promise(r => setTimeout(r, 1500));
  // Verify node_modules works
  await run("docker exec diary-build node -e \"import('./node_modules/dotenv/lib/main.js').then(()=>console.log('dotenv OK')).catch(e=>console.error('FAIL',e.message))\" 2>&1");
  // Copy new dist files over
  await run("docker cp /opt/diary/apps/api/dist/. diary-build:/app/apps/api/dist/");
  await run("docker cp /opt/diary/apps/web/dist/. diary-build:/app/apps/web/dist/");
  // Verify upload route is present
  await run("docker exec diary-build grep -c 'upload' /app/apps/api/dist/server.js 2>&1");
  await run("docker commit diary-build diary-app:latest");
  await run("docker rm -f diary-build");
  // Run
  await run("docker run -d --name diary-app --restart=unless-stopped --network host --env-file /opt/diary/.env -e OBSIDIAN_DIR=/app/vault -e HOST=127.0.0.1 -v /opt/diary/vault:/app/vault diary-app");
  await new Promise(r => setTimeout(r, 5000));
  await run("docker logs diary-app --tail 5");
  c.end();
});
c.connect({ host: "47.115.220.98", port: 22, username: "root", password: "MdHJCDMyYDtK4P", readyTimeout: 15000 });
