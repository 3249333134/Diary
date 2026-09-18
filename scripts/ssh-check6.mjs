import { Client } from 'ssh2';

const conn = new Client();
conn.on('ready', () => {
  const cmd = `
echo '=== project-ark-gateway ==='; docker ps -a --filter name=project-ark-gateway --format "{{.ID}} {{.Names}} {{.Image}}"
docker inspect project-ark-gateway --format '{{.Config.Image}} {{.HostConfig.Binds}}' 2>/dev/null
echo '=== GATEWAY NGINX CONF ==='; docker exec project-ark-gateway cat /etc/nginx/nginx.conf 2>/dev/null | head -60
docker exec project-ark-gateway ls /etc/nginx/conf.d/ 2>/dev/null
echo '=== HTPASSWD ==='; docker exec project-ark-gateway cat /etc/nginx/diary.htpasswd 2>/dev/null
echo '=== GATEWAY PORTS ==='; docker port project-ark-gateway 2>/dev/null
echo '=== CHECK 14319 ==='; ss -tlnp | grep 14319; echo "(empty means nothing listening)"
echo '=== CURL GATEWAY 14319 ==='; curl -s --connect-timeout 3 http://127.0.0.1:14319/api/health 2>&1 || echo "14319 not reachable"
echo '=== LETSENCRYPT CERTS ==='; ls -la /etc/letsencrypt/live/ 2>/dev/null; docker exec project-ark-gateway ls -la /etc/letsencrypt/ 2>/dev/null | head -10
echo '=== NODE V22 CONTAINER ==='; docker inspect 69d9a61a9aeb --format "{{.Name}} {{.Config.Image}}" 2>/dev/null
`;
  conn.exec(cmd, (err, stream) => {
    if (err) { console.error(err); conn.end(); return; }
    stream.on('close', () => conn.end())
           .on('data', d => process.stdout.write(d));
    stream.stderr.on('data', d => process.stderr.write(d));
  });
}).on('error', err => console.error('SSH ERROR:', err.message))
  .connect({ host: '47.115.220.98', port: 22, username: 'root', password: 'MdHJCDMyYDtK4P', readyTimeout: 10000 });
