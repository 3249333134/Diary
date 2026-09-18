import { Client } from 'ssh2';

const conn = new Client();
conn.on('ready', () => {
  const cmd = `
echo '=== DIARY NGINX CONF ==='; cat /tmp/diary-nginx.conf
echo '=== DOCKER PS ==='; docker ps --format "table {{.Names}}\\t{{.Image}}\\t{{.Ports}}\\t{{.Status}}" 2>/dev/null
echo '=== HOST NGINX ==='; cat /proc/2508/cmdline 2>/dev/null | tr '\\0' ' '; echo; ls -l /proc/2508/exe 2>/dev/null; cat /proc/2508/cgroup 2>/dev/null | head -5
echo '=== HOST NGINX CONF PATH ==='; cat /proc/2508/mountinfo 2>/dev/null | grep nginx | head -5
echo '=== DOCKER NGINX CONT ==='; docker ps -q 2>/dev/null | xargs -I{} docker exec {} nginx -T 2>&1 | grep -A5 "3399" | head -20
echo '=== DOCKER LOGS ==='; docker logs --tail 20 $(docker ps -q) 2>&1 | head -40
echo '=== CHECK NODE IN DOCKER ==='; docker ps -q 2>/dev/null | xargs -I{} sh -c 'echo "--- {} ---"; docker exec {} which node 2>/dev/null; docker exec {} node -v 2>/dev/null'
`;
  conn.exec(cmd, (err, stream) => {
    if (err) { console.error(err); conn.end(); return; }
    stream.on('close', () => conn.end())
           .on('data', d => process.stdout.write(d));
    stream.stderr.on('data', d => process.stderr.write(d));
  });
}).on('error', err => console.error('SSH ERROR:', err.message))
  .connect({ host: '47.115.220.98', port: 22, username: 'root', password: 'MdHJCDMyYDtK4P', readyTimeout: 10000 });
