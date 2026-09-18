import { Client } from "ssh2";
const c = new Client();
c.on("ready", async () => {
  const run = (cmd) => new Promise((res) => c.exec(cmd, (e, s) => {
    let o = ""; s.on("data", d => o += d); s.stderr.on("data", d => o += d);
    s.on("close", () => { console.log(">>> " + cmd.substring(0, 120) + "\n" + o); res(); });
  }));
  await run("docker rm -f diary-app diary-build 2>/dev/null");
  await run("docker run -d --name diary-build 06c4a21184d9 tail -f /dev/null");
  await new Promise(r => setTimeout(r, 1500));
  await run("docker exec diary-build rm -rf /app/apps/api/dist/*");
  await run("docker exec diary-build rm -rf /app/apps/web/dist/*");
  await run("docker cp /opt/diary/apps/api/dist/. diary-build:/app/apps/api/dist/");
  await run("docker cp /opt/diary/apps/web/dist/. diary-build:/app/apps/web/dist/");
  await run("docker exec diary-build grep -c multipart /app/apps/api/dist/server.js");
  await run("docker exec diary-build node apps/api/dist/index.js &");
  await new Promise(r => setTimeout(r, 3000));
  // test from inside container
  await run("docker exec diary-build sh -c 'curl -s http://127.0.0.1:4319/api/health 2>&1 || echo NO_LISTEN'");
  await run("docker stop diary-build");
  await run("docker commit diary-build diary-app:latest");
  await run("docker rm -f diary-build");
  await run("docker run -d --name diary-app --restart=unless-stopped --network host --env-file /opt/diary/.env -e OBSIDIAN_DIR=/app/vault -e HOST=127.0.0.1 -v /opt/diary/vault:/app/vault diary-app");
  await new Promise(r => setTimeout(r, 4000));
  await run("docker logs diary-app --tail 5");
  c.end();
});
c.connect({ host: "47.115.220.98", port: 22, username: "root", password: "MdHJCDMyYDtK4P", readyTimeout: 15000 });
