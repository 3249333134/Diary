import { Client } from "ssh2";
const c = new Client();
c.on("ready", () => {
  c.exec("ls /opt/diary/; echo '---'; docker ps --format '{{.Names}} {{.Image}} {{.Ports}}'; echo '---'; which nginx 2>/dev/null; find / -name 'nginx.conf' 2>/dev/null | head -5", (e, s) => {
    let o = "";
    s.on("data", (d) => (o += d));
    s.stderr.on("data", (d) => process.stderr.write(d));
    s.on("close", () => { console.log(o); c.end(); });
  });
}).connect({ host: "47.115.220.98", port: 22, username: "root", password: "MdHJCDMyYDtK4P", readyTimeout: 15000 });
