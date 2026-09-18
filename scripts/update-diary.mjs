import { Client } from 'ssh2';
import fs from 'node:fs';
import path from 'node:path';

const PASSWORD = 'MdHJCDMyYDtK4P';
const HOST = '47.115.220.98';
const USER = 'root';

const conn = new Client();

conn.on('ready', async () => {
  console.log('=== SSH CONNECTED ===');

  // Upload zip
  console.log('\n=== Uploading dist-update.zip ===');
  await new Promise((resolve, reject) => {
    conn.sftp((err, sftp) => {
      if (err) { reject(err); return; }
      sftp.fastPut(path.resolve('dist-update.zip'), '/opt/diary/dist-update.zip', (err) => {
        if (err) { reject(err); } else { console.log('Uploaded'); resolve(); }
        sftp.end();
      });
    });
  });

  // Unzip to api/dist and web/dist
  console.log('\n=== Unzipping ===');
  await exec(conn, 'cd /opt/diary && rm -rf apps/api/dist apps/web/dist && mkdir -p apps/api/dist apps/web/dist');
  // The zip has api dist and web dist mixed at root
  // We need to figure out which files go where
  await exec(conn, 'cd /tmp && rm -rf dist-update && mkdir dist-update && cd dist-update && unzip -q /opt/diary/dist-update.zip && ls');
  
  // Based on our zip, the contents are the api dist files and web dist files
  // Move .js, .d.ts (api) and index.html, assets/ (web)
  await exec(conn, `
cd /tmp/dist-update
# API dist: .js files, .d.ts files (not in assets)
mv -f *.js /opt/diary/apps/api/dist/ 2>/dev/null
mv -f *.d.ts /opt/diary/apps/api/dist/ 2>/dev/null
mv -f .gitkeep /opt/diary/apps/api/dist/ 2>/dev/null
# Web dist: index.html and assets/
mv -f index.html /opt/diary/apps/web/dist/ 2>/dev/null
mv -f assets /opt/diary/apps/web/dist/ 2>/dev/null
echo "=== api dist ==="; ls /opt/diary/apps/api/dist/
echo "=== web dist ==="; ls -R /opt/diary/apps/web/dist/ | head -10
`);

  // Rebuild docker image
  console.log('\n=== Rebuild diary image ===');
  await exec(conn, 'cd /opt/diary && docker build --no-cache -t diary-app . 2>&1 | tail -3');

  // Restart container
  console.log('\n=== Restart diary container ===');
  await exec(conn, 'docker stop diary-app && docker rm diary-app');
  await exec(conn, `
docker run -d \\
  --name diary-app \\
  --restart=unless-stopped \\
  --network host \\
  --env-file /opt/diary/.env \\
  -e OBSIDIAN_DIR=/app/vault \\
  -e HOST=127.0.0.1 \\
  -v /opt/diary/vault:/app/vault \\
  diary-app
`);

  await new Promise(r => setTimeout(r, 3000));
  await exec(conn, 'docker ps | grep diary');
  await exec(conn, 'docker logs diary-app --tail 3 2>&1');

  // Verify
  console.log('\n=== Verify ===');
  await exec(conn, 'curl -s http://127.0.0.1:4319/api/health');
  await exec(conn, 'curl -sk -u hongcheng:xumin999 https://47.115.220.98:3399/api/health');

  // Cleanup
  await exec(conn, 'rm -f /opt/diary/dist-update.zip && rm -rf /tmp/dist-update');

  conn.end();
  console.log('\n=== UPDATE DONE ===');
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
