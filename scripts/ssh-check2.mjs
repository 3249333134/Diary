import { Client } from 'ssh2';

const conn = new Client();
conn.on('ready', () => {
  const cmd = `
echo '=== NGINX MAIN CONF ==='; cat /etc/nginx/nginx.conf 2>/dev/null | head -40
echo '=== NGINX CONF.D ==='; ls /etc/nginx/conf.d/ 2>/dev/null; for f in /etc/nginx/conf.d/*.conf; do echo "--- $f ---"; cat "$f"; done
echo '=== NGINX VHOST ==='; ls /www/server/panel/vhost/nginx/ 2>/dev/null; for f in /www/server/panel/vhost/nginx/*.conf; do echo "--- $f ---"; cat "$f"; done
echo '=== NODE POSSIBLE LOCATIONS ==='; find / -name "node" -type f 2>/dev/null | head -10
echo '=== WHICH NODE ALL ==='; which -a node 2>/dev/null; find /usr -name "node" 2>/dev/null; find /opt -name "node" 2>/dev/null; ls /usr/local/bin/ 2>/dev/null | head -20
echo '=== BT PANEL PATH ==='; ls /www/server/ 2>/dev/null
`;
  conn.exec(cmd, (err, stream) => {
    if (err) { console.error(err); conn.end(); return; }
    stream.on('close', () => conn.end())
           .on('data', d => process.stdout.write(d));
    stream.stderr.on('data', d => process.stderr.write(d));
  });
}).on('error', err => console.error('SSH ERROR:', err.message))
  .connect({ host: '47.115.220.98', port: 22, username: 'root', password: 'MdHJCDMyYDtK4P', readyTimeout: 10000 });
