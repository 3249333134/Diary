import { Client } from "ssh2";
import fs from "fs";
import path from "path";

const c = new Client();
c.on("ready", async () => {
  const sftp = await new Promise((res, rej) => c.sftp((e, s) => e ? rej(e) : res(s)));

  // Upload contracts dist
  const contractDist = path.resolve("node_modules/@diary/contracts/dist");
  const files = fs.readdirSync(contractDist);
  for (const f of files) {
    const src = path.join(contractDist, f);
    const stat = fs.statSync(src);
    if (stat.isFile() && (f.endsWith(".js") || f.endsWith(".d.ts") || f.endsWith(".json"))) {
      await new Promise((res, rej) => sftp.fastPut(src, `/opt/diary/node_modules/@diary/contracts/dist/${f}`, e => e ? rej(e) : res()));
      console.log(`contracts: ${f} (${stat.size}B)`);
    }
  }
  // Also package.json
  const pkgJson = path.resolve("node_modules/@diary/contracts/package.json");
  if (fs.existsSync(pkgJson)) {
    await new Promise((res, rej) => sftp.fastPut(pkgJson, `/opt/diary/node_modules/@diary/contracts/package.json`, e => e ? rej(e) : res()));
    console.log(`contracts: package.json`);
  }
  c.end();
});
c.connect({ host: "47.115.220.98", port: 22, username: "root", password: "MdHJCDMyYDtK4P", readyTimeout: 15000 });
