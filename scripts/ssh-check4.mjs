import { Client } from 'ssh2';

const conn = new Client();
conn.on('ready', () => {
  const cmd = `
echo '=== FIND NGINX ==='; find / -name "nginx" -type f 2>/dev/null | head -10
echo '=== WHICH NGINX ==='; which nginx 2>/dev/null
echo '=== PROCESS ==='; ps aux | grep nginx | grep -v grep | head -5
echo '=== NGINX CONF FROM PROCESS ==='; cat /proc/$(pgrep -o nginx)/cmdline 2>/dev/null | tr '\\0' ' '; echo
ls -l /proc/$(pgrep -o nginx)/exe 2>/dev/null
echo '=== NODEJS VHOST ==='; ls -la /www/server/nodejs/vhost/ 2>/dev/null
echo '=== ALL VHOST CONF ==='; find /www/server -name "*.conf" -path "*vhost*" 2>/dev/null; find /www/server -name "*.conf" -path "*nginx*" 2>/dev/null | head -10
echo '=== SYS NGINX ==='; ls -la /etc/nginx/ 2>/dev/null; cat /etc/nginx/nginx.conf 2>/dev/null | head -30
echo '=== 3399 CONF ==='; grep -rl "3399" /etc/nginx/ 2>/dev/null; grep -rl "3399" /www/server/nginx/ 2>/dev/null; find / -name "*.conf" -exec grep -l "3399" {} \\; 2>/dev/null | head -5
`;
  conn.exec(cmd, (err, stream) => {
    if (err) { console.error(err); conn.end(); return; }
    stream.on('close', () => conn.end())
           .on('data', d => process.stdout.write(d));
    stream.stderr.on('data', d => process.stderr.write(d));
  });
}).on('error', err => console.error('SSH ERROR:', err.message))
  .connect({ host: '47.115.220.98', port: 22, username: 'root', password: 'MdHJCDMyYDtK4P', readyTimeout: 10000 });
