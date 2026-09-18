import { Client } from 'ssh2';

const conn = new Client();
conn.on('ready', () => {
  console.log('=== SSH CONNECTED ===');
  const cmd = `
echo '=== OS ==='; cat /etc/os-release | head -3
echo '=== ALL LISTEN PORTS ==='; ss -tlnp 2>/dev/null | head -30
echo '=== NGINX STATUS ==='; systemctl status nginx 2>/dev/null | head -10
echo '=== NGINX DIARY CONF ==='; cat /etc/nginx/conf.d/diary* 2>/dev/null; cat /etc/nginx/sites-enabled/diary* 2>/dev/null; cat /etc/nginx/sites-enabled/default 2>/dev/null | head -30
echo '=== PM2 ==='; pm2 list 2>/dev/null || echo 'no pm2'
echo '=== DIARY DIR ==='; ls -la /home/hongcheng/diary 2>/dev/null; ls -la /root/diary 2>/dev/null; ls -la /opt/diary 2>/dev/null
echo '=== NODE ==='; which node; node -v; which pm2
echo '=== HTPASSWD ==='; cat /etc/nginx/.diary_htpasswd 2>/dev/null || echo 'no htpasswd'
echo '=== NGINX ERROR LOG ==='; tail -20 /var/log/nginx/error.log 2>/dev/null
echo '=== NGINX ACCESS LOG (last 10) ==='; tail -10 /var/log/nginx/access.log 2>/dev/null
`;
  conn.exec(cmd, (err, stream) => {
    if (err) { console.error(err); conn.end(); return; }
    stream.on('close', () => conn.end())
           .on('data', d => process.stdout.write(d));
    stream.stderr.on('data', d => process.stderr.write(d));
  });
}).on('error', err => console.error('SSH ERROR:', err.message))
  .connect({ host: '47.115.220.98', port: 22, username: 'root', password: 'MdHJCDMyYDtK4P', readyTimeout: 10000 });
