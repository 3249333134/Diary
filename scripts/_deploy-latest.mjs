import { Client } from 'ssh2';
import fs from 'node:fs';
import path from 'node:path';

const HOST = '47.115.220.98';
const USER = 'root';
const PASSWORD = 'MdHJCDMyYDtK4P';
const ZIP_LOCAL = path.resolve('deploy-update.tar.gz');
const ZIP_REMOTE = '/opt/diary/deploy-update.tar.gz';

const conn = new Client();

function run(conn, cmd) {
  return new Promise((resolve) => {
    conn.exec(cmd, (err, stream) => {
      let out = '';
      stream.on('data', (d) => { out += d; process.stdout.write(d); });
      stream.stderr.on('data', (d) => { out += d; process.stderr.write(d); });
      stream.on('close', () => resolve(out));
    });
  });
}

conn.on('ready', async () => {
  console.log('=== SSH CONNECTED ===\n');

  // 1. Upload zip
  console.log('=== 1. Uploading deploy-update.zip ===');
  await new Promise((resolve, reject) => {
    conn.sftp((err, sftp) => {
      if (err) { reject(err); return; }
      console.log('SFTP connected, uploading...');
      sftp.fastPut(ZIP_LOCAL, ZIP_REMOTE, {
        step: (transferred, total) => {
          if (transferred === total) process.stdout.write(`\rUploaded: ${((transferred/total)*100).toFixed(1)}%\n`);
        }
      }, (err) => {
        sftp.end();
        if (err) reject(err); else { console.log('Upload done.'); resolve(); }
      });
    });
  });

  // 2. Unzip (overwrite dist dirs)
  console.log('\n=== 2. Unzip dist files ===');
  await run(conn, 'cd /opt/diary && rm -rf packages/contracts/dist apps/api/dist apps/web/dist && tar -xzf deploy-update.tar.gz && rm -f deploy-update.tar.gz && echo "extracted"');

  // 3. Rebuild docker image
  console.log('\n=== 3. Rebuild diary-app image ===');
  await run(conn, 'cd /opt/diary && docker build -t diary-app . 2>&1 | tail -5');

  // 4. Restart container
  console.log('\n=== 4. Restart diary-app container ===');
  await run(conn, 'docker stop diary-app 2>/dev/null; docker rm diary-app 2>/dev/null; echo "old removed"');
  await run(conn, `docker run -d \
    --name diary-app \
    --restart=unless-stopped \
    --network host \
    --env-file /opt/diary/.env \
    -e OBSIDIAN_DIR=/app/vault \
    -e HOST=127.0.0.1 \
    -v /opt/diary/vault:/app/vault \
    diary-app`);

  // 5. Wait & verify
  console.log('\n=== 5. Wait & verify ===');
  await new Promise((r) => setTimeout(r, 4000));
  await run(conn, 'docker ps --filter name=diary-app --format "{{.Names}} {{.Status}}"');
  await run(conn, 'docker logs diary-app --tail 5 2>&1');
  console.log('\n--- local API health ---');
  await run(conn, 'curl -s --connect-timeout 5 http://127.0.0.1:4319/api/health');
  console.log('\n--- quick-facts endpoint ---');
  await run(conn, 'curl -s --connect-timeout 5 "http://127.0.0.1:4319/api/quick-facts?days=30&limit=3" | head -c 300');

  conn.end();
  console.log('\n=== DEPLOY COMPLETE ===');
}).on('error', (err) => console.error('SSH ERROR:', err.message))
  .connect({ host: HOST, port: 22, username: USER, password: PASSWORD, readyTimeout: 15000 });
