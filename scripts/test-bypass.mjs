import { Client } from "ssh2";
const c = new Client();
c.on("ready", async () => {
  // 1. Test upload from host (bypassing nginx)
  console.log("=== Host: direct to 4319 (bypassing nginx) ===");
  await exec(c, "echo 'hello' > /tmp/test.txt && curl -s -X POST -F 'file=@/tmp/test.txt' 'http://127.0.0.1:4319/api/upload?date=2026-09-10' 2>&1");
  console.log("\n=== Host: through nginx 3399 ===");
  await exec(c, "curl -sk -X POST -F 'file=@/tmp/test.txt' 'https://127.0.0.1:3399/api/upload?date=2026-09-10' 2>&1");
  console.log("\n=== Check nginx container config ===");
  await exec(c, "docker inspect project-ark-gateway --format '{{range .Mounts}}{{.Source}} -> {{.Destination}}{{println}}{{end}}' 2>&1; echo ---; docker exec project-ark-gateway cat /etc/nginx/conf.d/default.conf 2>&1 || docker exec project-ark-gateway cat /etc/nginx/nginx.conf 2>&1 | head -40");
  c.end();
});
function exec(conn, cmd) {
  return new Promise((resolve) => {
    conn.exec(cmd, (err, stream) => {
      if (err) { console.error(err); resolve(); return; }
      stream.on("close", () => resolve());
      stream.on("data", (d) => process.stdout.write(d));
      stream.stderr.on("data", (d) => process.stderr.write(d));
    });
  });
}
c.connect({ host: "47.115.220.98", port: 22, username: "root", password: "MdHJCDMyYDtK4P", readyTimeout: 15000 });
