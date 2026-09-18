import { Client } from 'ssh2';
import fs from 'node:fs';

const PASSWORD = 'MdHJCDMyYDtK4P';
const HOST = '47.115.220.98';
const USER = 'root';

const conn = new Client();

conn.on('ready', async () => {
  console.log('=== SSH CONNECTED ===');

  // Step 1: Restore gateway to host network mode (like before)
  console.log('\n=== Step 1: Restore gateway to host network ===');
  await exec(conn, `
docker stop project-ark-gateway && docker rm project-ark-gateway
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

  // Verify 3399 is listening again
  await exec(conn, 'ss -tlnp | grep 3399');

  // Step 2: Now check - since gateway is on host network, 127.0.0.1 is the HOST machine
  // So proxy_pass http://127.0.0.1:4319 would work if diary runs on host 4319
  // But we can't run node on host. Alternative: run diary in Docker container with --network host too
  
  console.log('\n=== Step 2: Run diary in Docker container ===');
  // The docker image "current-api" (cosworks-api) has node v22.23.2
  // Or we can use node:22-alpine which definitely has the right GLIBC
  
  // Create Dockerfile for diary
  const dockerfile = `FROM node:22-alpine
WORKDIR /app
COPY package.json ./
COPY apps/api/package.json ./apps/api/package.json
COPY apps/web/package.json ./apps/web/package.json
COPY packages/contracts/package.json ./packages/contracts/package.json
COPY packages/contracts/dist ./packages/contracts/dist
RUN npm install --omit=dev
COPY apps/api/dist ./apps/api/dist
COPY apps/web/dist ./apps/web/dist
EXPOSE 4319
CMD ["node", "apps/api/dist/index.js"]
`;

  await new Promise((resolve, reject) => {
    conn.sftp((err, sftp) => {
      if (err) { reject(err); return; }
      sftp.writeFile('/opt/diary/Dockerfile', dockerfile, (err) => {
        if (err) { reject(err); } else { resolve(); }
        sftp.end();
      });
    });
  });
  console.log('Dockerfile written');

  // Step 3: Build diary image on host
  console.log('\n=== Step 3: Build docker image ===');
  await exec(conn, 'cd /opt/diary && docker build -t diary-app . 2>&1 | tail -20');

  // Step 4: Run diary container with host network
  console.log('\n=== Step 4: Run diary container ===');
  await exec(conn, 'docker stop diary-app 2>/dev/null; docker rm diary-app 2>/dev/null');
  await exec(conn, `
docker run -d \\
  --name diary-app \\
  --restart=unless-stopped \\
  --network host \\
  -e HOST=127.0.0.1 \\
  -e PORT=4319 \\
  -e OBSIDIAN_DIR=/opt/diary/vault \\
  -e DIARY_TIMEZONE=Asia/Shanghai \\
  -e AI_API_KEY=${process.env.AI_API_KEY || ''} \\
  -v /opt/diary/vault:/app/vault \\
  diary-app
`);

  await new Promise(r => setTimeout(r, 3000));
  await exec(conn, 'docker ps | grep diary');
  await exec(conn, 'docker logs diary-app --tail 10 2>&1');

  // Step 5: Verify local API
  console.log('\n=== Step 5: Test API ===');
  await exec(conn, 'curl -s http://127.0.0.1:4319/api/health');

  // Step 6: Verify via nginx (local)
  console.log('\n=== Step 6: Test via local nginx ===');
  await exec(conn, 'curl -sk -u hongcheng:xumin999 https://127.0.0.1:3399/api/health 2>&1');

  // Step 7: Verify via external
  console.log('\n=== Step 7: Test external ===');
  await exec(conn, 'curl -sk -u hongcheng:xumin999 https://47.115.220.98:3399/api/health 2>&1');
  await exec(conn, 'curl -sk -u hongcheng:xumin999 https://47.115.220.98:3399/ 2>&1 | head -5');

  // Check the proxy_pass in template
  console.log('\n=== Template proxy_pass check ===');
  await exec(conn, 'grep proxy_pass /opt/project-ark/source/deploy/remote/nginx.conf.template');

  conn.end();
  console.log('\n=== DONE ===');
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
