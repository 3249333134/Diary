import { Client } from "ssh2";
import fs from "fs";
import path from "path";

const c = new Client();
c.on("ready", async () => {
  const sftp = await new Promise((res, rej) => c.sftp((e, s) => e ? rej(e) : res(s)));

  // Upload api dist
  const apiFiles = fs.readdirSync("apps/api/dist");
  for (const f of apiFiles) {
    if (f.endsWith(".js") || f.endsWith(".d.ts") || f === ".gitkeep") {
      const src = path.resolve("apps/api/dist", f);
      const stat = fs.statSync(src);
      await new Promise((res, rej) => sftp.fastPut(src, `/opt/diary/apps/api/dist/${f}`, e => e ? rej(e) : res()));
      console.log(`api: ${f} (${stat.size}B)`);
    }
  }

  const run = (cmd) => new Promise((res) => c.exec(cmd, (e, s) => {
    let o = ""; s.on("data", d => o += d); s.stderr.on("data", d => o += d);
    s.on("close", () => { console.log(">>> " + cmd.substring(0, 140) + "\n" + o); res(); });
  }));

  await run("docker rm -f diary-app diary-build 2>/dev/null");
  await run("docker run -d --name diary-build 58e0acdcdd09c2e71ce6a8a6df59fd43028885540f24b8e9dd830b3b2efd7c92 tail -f /dev/null");
  await new Promise(r => setTimeout(r, 1500));
  await run("docker cp /opt/diary/apps/api/dist/. diary-build:/app/apps/api/dist/");
  await run("docker commit diary-build diary-app:latest");
  await run("docker rm -f diary-build");
  await run("docker run -d --name diary-app --restart=unless-stopped --network host --env-file /opt/diary/.env -e OBSIDIAN_DIR=/app/vault -e HOST=127.0.0.1 -v /opt/diary/vault:/app/vault diary-app node apps/api/dist/index.js");
  await new Promise(r => setTimeout(r, 4000));
  await run("docker logs diary-app --tail 3");
  c.end();
});
c.connect({ host: "47.115.220.98", port: 22, username: "root", password: "MdHJCDMyYDtK4P", readyTimeout: 15000 });
