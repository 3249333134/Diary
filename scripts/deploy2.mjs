import { Client } from 'ssh2';
import fs from 'node:fs';

const PASSWORD = 'MdHJCDMyYDtK4P';
const HOST = '47.115.220.98';
const USER = 'root';

const conn = new Client();

conn.on('ready', async () => {
  console.log('=== SSH CONNECTED ===');

  // Step 1: Manual Node.js install (download binary)
  console.log('\n=== Step 1: Node.js 22 binary install ===');
  await exec(conn, `
# Download Node.js 22 binary
curl -fsSL https://nodejs.org/dist/v22.15.0/node-v22.15.0-linux-x64.tar.xz -o /tmp/node.tar.xz && \\
tar -xJf /tmp/node.tar.xz -C /usr/local --strip-components=1 && \\
rm /tmp/node.tar.xz && \\
ln -sf /usr/local/bin/node /usr/bin/node && \\
ln -sf /usr/local/bin/npm /usr/bin/npm && \\
ln -sf /usr/local/bin/npx /usr/bin/npx && \\
node -v && npm -v
`);

  // Step 2: Install pm2
  console.log('\n=== Step 2: pm2 install ===');
  await exec(conn, 'npm install -g pm2 && pm2 -v');

  // Step 3: Install dependencies
  console.log('\n=== Step 3: npm install ===');
  await exec(conn, 'cd /opt/diary && npm install --omit=dev 2>&1 | tail -10');

  // Step 4: pm2 start
  console.log('\n=== Step 4: pm2 start diary ===');
  await exec(conn, 'pm2 stop diary 2>/dev/null; pm2 delete diary 2>/dev/null');
  await exec(conn, 'cd /opt/diary && pm2 start apps/api/dist/index.js --name diary -o /opt/diary/logs/out.log -e /opt/diary/logs/err.log');
  await exec(conn, 'pm2 save');
  
  // Wait and check
  await new Promise(r => setTimeout(r, 2000));
  await exec(conn, 'pm2 list');
  await exec(conn, 'curl -s http://127.0.0.1:4319/api/health 2>&1');

  // Step 5: Fix nginx - host.docker.internal
  console.log('\n=== Step 5: Fix gateway nginx ===');
  
  // First check what IP host is from container's perspective
  await exec(conn, 'docker exec project-ark-gateway cat /etc/resolv.conf 2>/dev/null; echo "---"; docker inspect project-ark-gateway --format "{{range .NetworkSettings.Networks}}{{.Gateway}}{{end}}" 2>/dev/null');
  
  // Get the nginx template path and modify it
  const templateContent = await new Promise((resolve) => {
    conn.exec('cat /opt/project-ark/source/deploy/remote/nginx.conf.template', (err, stream) => {
      let out = '';
      stream.on('close', () => resolve(out))
            .on('data', d => out += d);
    });
  });
  
  console.log('Template found, size:', templateContent.length);
  
  // Replace proxy_pass
  const newTemplate = templateContent.replace(
    'proxy_pass http://127.0.0.1:14319;',
    'proxy_pass http://host.docker.internal:4319;'
  );
  
  // Also need to add --add-host to docker run
  // First write new template
  await new Promise((resolve, reject) => {
    conn.sftp((err, sftp) => {
      if (err) { reject(err); return; }
      sftp.writeFile('/opt/project-ark/source/deploy/remote/nginx.conf.template', newTemplate, (err) => {
        if (err) { reject(err); } else { resolve(); }
        sftp.end();
      });
    });
  });
  console.log('Template updated');

  // Need to recreate container with --add-host
  // Get current docker run command via inspect
  const runCmd = await new Promise((resolve) => {
    conn.exec('docker inspect project-ark-gateway --format \'{{json .HostConfig}}\'', (err, stream) => {
      let out = '';
      stream.on('close', () => resolve(out))
            .on('data', d => out += d);
    });
  });
  
  console.log('Old hostconfig key points:');
  const parsed = JSON.parse(runCmd);
  console.log('  Binds:', JSON.stringify(parsed.Binds));
  console.log('  PortBindings:', JSON.stringify(parsed.PortBindings));
  console.log('  NetworkMode:', parsed.NetworkMode);
  console.log('  RestartPolicy:', JSON.stringify(parsed.RestartPolicy));

  // Recreate container with --add-host host.docker.internal:host-gateway
  console.log('\n=== Step 6: Recreate gateway container ===');
  const recreateCmd = `
# Stop and remove old
docker stop project-ark-gateway && docker rm project-ark-gateway
# Recreate with --add-host
docker run -d \\
  --name project-ark-gateway \\
  --restart=always \\
  --add-host host.docker.internal:host-gateway \\
  -p 3399:3399 \\
  -v /opt/project-ark/source/deploy/remote/nginx.conf.template:/etc/nginx/nginx.conf:ro \\
  -v /opt/project-ark/source/deploy/remote/host-offline.html:/usr/share/nginx/html/host-offline.html:ro \\
  -v /opt/project-ark/auth:/etc/project-ark/auth:ro \\
  -v /opt/project-ark/letsencrypt:/etc/letsencrypt:ro \\
  nginx:alpine
`;
  await exec(conn, recreateCmd);

  // Verify
  await new Promise(r => setTimeout(r, 3000));
  await exec(conn, 'docker ps | grep gateway');
  await exec(conn, 'docker exec project-ark-gateway getent hosts host.docker.internal 2>&1');
  await exec(conn, 'docker exec project-ark-gateway nginx -t 2>&1');

  // Step 7: Final test
  console.log('\n=== Step 7: Final verification ===');
  await new Promise(r => setTimeout(r, 2000));
  await exec(conn, 'curl -s --connect-timeout 5 http://127.0.0.1:4319/api/health');
  await exec(conn, 'curl -sk --connect-timeout 5 -u hongcheng:xumin999 https://127.0.0.1:3399/api/health');
  await exec(conn, 'curl -sk --connect-timeout 5 -u hongcheng:xumin999 https://47.115.220.98:3399/api/health');

  conn.end();
  console.log('\n=== ALL DONE ===');
}).on('error', err => console.error('SSH ERROR:', err.message))
  .connect({ host: HOST, port: 22, username: USER, password: PASSWORD, readyTimeout: 15000 });

function exec(conn, cmd) {
  return new Promise((resolve, reject) => {
    conn.exec(cmd, { pty: false }, (err, stream) => {
      if (err) { reject(err); return; }
      stream.on('close', () => resolve())
            .on('data', d => process.stdout.write(d));
      stream.stderr.on('data', d => process.stderr.write(d));
    });
  });
}
