import { Client } from 'ssh2';

const PASSWORD = 'MdHJCDMyYDtK4P';
const HOST = '47.115.220.98';
const USER = 'root';

const conn = new Client();

conn.on('ready', async () => {
  console.log('=== SSH CONNECTED ===');

  // Check gateway status and logs
  console.log('\n=== Gateway status ===');
  await exec(conn, 'docker ps -a | grep gateway');
  await exec(conn, 'docker logs project-ark-gateway 2>&1 | tail -30');
  
  // Check nginx test
  console.log('\n=== Nginx test ===');
  await exec(conn, 'docker exec project-ark-gateway nginx -t 2>&1');
  await exec(conn, 'cat /opt/project-ark/source/deploy/remote/nginx.conf.template');
  
  // Check port 3399
  console.log('\n=== Port 3399 ===');
  await exec(conn, 'ss -tlnp | grep 3399');

  // The template currently has proxy_pass http://host.docker.internal:4319
  // But with host network, nginx sees 127.0.0.1 as host itself
  // We need proxy_pass http://127.0.0.1:4319
  console.log('\n=== Fix template back to 127.0.0.1:4319 ===');
  let content = '';
  await new Promise((resolve) => {
    conn.exec('cat /opt/project-ark/source/deploy/remote/nginx.conf.template', (err, stream) => {
      stream.on('close', () => resolve())
            .on('data', d => content += d);
    });
  });
  
  const fixed = content.replace(
    'proxy_pass http://host.docker.internal:4319;',
    'proxy_pass http://127.0.0.1:4319;'
  );
  
  if (fixed === content) {
    console.log('Template unchanged (already 127.0.0.1 or other)');
    console.log('Current proxy_pass line:', content.match(/proxy_pass.*/));
  } else {
    await new Promise((resolve, reject) => {
      conn.sftp((err, sftp) => {
        if (err) { reject(err); return; }
        sftp.writeFile('/opt/project-ark/source/deploy/remote/nginx.conf.template', fixed, (err) => {
          if (err) { reject(err); } else { console.log('Template fixed'); resolve(); }
          sftp.end();
        });
      });
    });
  }

  // Restart gateway
  console.log('\n=== Restart gateway ===');
  await exec(conn, 'docker stop project-ark-gateway && docker rm project-ark-gateway');
  await exec(conn, `
docker run -d \\
  --name project-ark-gateway \\
  --restart=unless-stopped \\
  --network host \\
  -v /opt/project-ark/source/deploy/remote/nginx.conf.template:/etc/nginx/nginx.conf:ro \\
  -v /opt/project-ark/source/deploy/remote/host-offline.html:/usr/share/nginx/html/host-offline.html:ro \\
  -v /opt/project-ark/auth:/etc/project-ark/auth:ro \\
  -v /opt/project-ark/letsencrypt:/etc/letsencrypt:ro \\
  nginx:alpine
`);

  await new Promise(r => setTimeout(r, 2000));
  await exec(conn, 'docker ps | grep gateway');
  await exec(conn, 'ss -tlnp | grep 3399');
  await exec(conn, 'docker logs project-ark-gateway 2>&1 | tail -10');

  conn.end();
  console.log('\n=== GATEWAY FIXED ===');
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
