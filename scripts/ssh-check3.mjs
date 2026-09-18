import { Client } from 'ssh2';

const conn = new Client();
conn.on('ready', () => {
  const cmd = `
echo '=== FULL NGINX CONF ==='; cat /www/server/nginx/conf/nginx.conf 2>/dev/null | head -60
echo '=== NGINX CONF INCLUDE ==='; grep -r "3399" /www/server/nginx/ 2>/dev/null
echo '=== NGINX BIN ==='; ls /www/server/nginx/ 2>/dev/null
echo '=== NODEJS SERVER ==='; ls -la /www/server/nodejs/ 2>/dev/null
echo '=== FIND NODE BIN ==='; find /www/server/nodejs -name "node" -type f 2>/dev/null
echo '=== SITE WITH 3399 ==='; grep -rl "3399" /www/server/ 2>/dev/null
echo '=== NGINX -T ==='; /www/server/nginx/sbin/nginx -T 2>&1 | head -80
`;
  conn.exec(cmd, (err, stream) => {
    if (err) { console.error(err); conn.end(); return; }
    stream.on('close', () => conn.end())
           .on('data', d => process.stdout.write(d));
    stream.stderr.on('data', d => process.stderr.write(d));
  });
}).on('error', err => console.error('SSH ERROR:', err.message))
  .connect({ host: '47.115.220.98', port: 22, username: 'root', password: 'MdHJCDMyYDtK4P', readyTimeout: 10000 });
