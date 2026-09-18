import { Client } from "ssh2";
const c = new Client();
c.on("ready", () => {
  c.exec("docker exec diary-app sh -c 'node /app/apps/api/dist/index.js & PID=$!; sleep 3; curl -s http://127.0.0.1:4319/api/health 2>&1; kill $PID 2>/dev/null; wait $PID 2>/dev/null' 2>&1 | head -20", (e, s) => {
    let o = ""; s.on("data", d => o += d); s.on("close", () => { console.log(o); c.end(); });
  });
}).connect({ host: "47.115.220.98", port: 22, username: "root", password: "MdHJCDMyYDtK4P", readyTimeout: 15000 });
