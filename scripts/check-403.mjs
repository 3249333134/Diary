import { Client } from 'ssh2';

const PASSWORD = 'MdHJCDMyYDtK4P';
const HOST = '47.115.220.98';
const USER = 'root';

const conn = new Client();

conn.on('ready', async () => {
  console.log('=== SSH CONNECTED ===');

  // Check htpasswd in container
  await exec(conn, 'docker exec project-ark-gateway ls -la /etc/nginx/ 2>&1');
  await exec(conn, 'docker exec project-ark-gateway cat /etc/nginx/diary.htpasswd 2>&1');
  await exec(conn, 'ls -la /opt/project-ark/auth/ 2>&1');
  await exec(conn, 'ls -la /etc/nginx/ 2>&1');

  // Check if htpasswd exists on host
  await exec(conn, 'find / -name "*.htpasswd" 2>/dev/null | head -10');
  await exec(conn, 'find /opt -name "*htpasswd*" -o -name "*auth*" 2>/dev/null | head -10');
  
  // Check what's mounted
  await exec(conn, 'docker inspect project-ark-gateway --format "{{json .Mounts}}" | python3 -m json.tool 2>/dev/null || docker inspect project-ark-gateway --format "{{json .Mounts}}"');

  // Test without auth - what does nginx return for /api/health?
  await exec(conn, 'curl -sk https://127.0.0.1:3399/ 2>&1 | head -10');
  await exec(conn, 'curl -sk https://127.0.0.1:3399/api/health 2>&1 | head -10');

  conn.end();
}).on('error', err => console.error('SSH ERROR:', err.message))
  .connect({ host: HOST, port: 22, username: USER, password: PASSWORD, readyTimeout: 15000 });

function exec(conn, cmd) {
  return new Promise((resolve, reject) => {
    conn.exec(cmd, (err, stream) => {
      if (err) { reject(err); return; }
      stream.on('close', () => resolve())
            .on('data', d => process.stdout.write(d));
      stream.stderr.on('data', d => process.stderr.write(d));
    });
  });
}
