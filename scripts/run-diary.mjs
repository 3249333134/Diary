import { Client } from 'ssh2';

const PASSWORD = 'MdHJCDMyYDtK4P';
const HOST = '47.115.220.98';
const USER = 'root';

const conn = new Client();

conn.on('ready', async () => {
  console.log('=== SSH CONNECTED ===');

  // Step 1: Build diary docker image
  console.log('\n=== Step 1: Build docker image ===');
  await exec(conn, 'cd /opt/diary && docker build -t diary-app . 2>&1');

  // Step 2: Run diary container with host network
  console.log('\n=== Step 2: Run diary container ===');
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
  diary-app
`);

  await new Promise(r => setTimeout(r, 3000));
  await exec(conn, 'docker ps | grep diary');
  await exec(conn, 'docker logs diary-app --tail 20 2>&1');

  // Step 3: Test
  console.log('\n=== Step 3: Test local API ===');
  await exec(conn, 'curl -s http://127.0.0.1:4319/api/health');

  console.log('\n=== Step 4: Test via nginx local ===');
  await exec(conn, 'curl -sk -u hongcheng:xumin999 https://127.0.0.1:3399/api/health');

  console.log('\n=== Step 5: Test external ===');
  await exec(conn, 'curl -sk -u hongcheng:xumin999 https://47.115.220.98:3399/api/health');

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
