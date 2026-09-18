import { Client } from "ssh2";
import fs from "fs";
import path from "path";
const c = new Client();
c.on("ready", async () => {
  const files = fs.readdirSync("apps/api/dist");
  const sftp = await new Promise((res, rej) => c.sftp((e, s) => e ? rej(e) : res(s)));
  for (const f of files) {
    if (f.endsWith(".js") || f.endsWith(".d.ts") || f === ".gitkeep") {
      const src = path.resolve("apps/api/dist", f);
      const stat = fs.statSync(src);
      await new Promise((res, rej) => sftp.fastPut(src, `/opt/diary/apps/api/dist/${f}`, e => e ? rej(e) : res()));
      console.log(`OK api: ${f} (${stat.size}B)`);
    }
  }
  // Web dist
  const webFiles = ["index.html"];
  for (const f of webFiles) {
    const src = path.resolve("apps/web/dist", f);
    if (fs.existsSync(src)) {
      await new Promise((res, rej) => sftp.fastPut(src, `/opt/diary/apps/web/dist/${f}`, e => e ? rej(e) : res()));
      console.log(`OK web: ${f}`);
    }
  }
  const assetsPath = path.resolve("apps/web/dist/assets");
  if (fs.existsSync(assetsPath)) {
    for (const f of fs.readdirSync(assetsPath)) {
      const src = path.join(assetsPath, f);
      await new Promise((res, rej) => sftp.fastPut(src, `/opt/diary/apps/web/dist/assets/${f}`, e => e ? rej(e) : res()));
      console.log(`OK asset: ${f}`);
    }
  }
  sftp.end();
  console.log("=== Verify multipart on server ===");
  c.exec("grep -n multipart /opt/diary/apps/api/dist/server.js | head -3 || echo 'NO MULTIPART - OK'", (e, s) => {
    let o = "";
    s.on("data", d => o += d);
    s.on("close", () => { console.log(o); c.end(); });
  });
}).connect({ host: "47.115.220.98", port: 22, username: "root", password: "MdHJCDMyYDtK4P", readyTimeout: 15000 });
