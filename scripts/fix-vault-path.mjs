import { Client } from 'ssh2';

const conn = new Client();
conn.on('ready', async () => {
  const exec = (cmd) => new Promise((resolve) => {
    conn.exec(cmd, (err, stream) => {
      let out = '';
      stream.on('data', d => out += d);
      stream.stderr.on('data', d => process.stderr.write(d));
      stream.on('close', () => { console.log(out); resolve(); });
    });
  });

  console.log('=== Fix OBSIDIAN_DIR ===');
  await exec('docker stop diary-app 2>/dev/null; docker rm diary-app 2>/dev/null');
  await exec([
    'docker run -d',
    '--name diary-app',
    '--restart=unless-stopped',
    '--network host',
    '-e HOST=127.0.0.1',
    '-e PORT=4319',
    '-e OBSIDIAN_DIR=/app/vault',
    '-e DIARY_TIMEZONE=Asia/Shanghai',
    '-v /opt/diary/vault:/app/vault',
    'diary-app'
  ].join(' '));

  await new Promise(r => setTimeout(r, 2500));
  console.log('\n=== Verify dates ===');
  await exec('curl -s http://127.0.0.1:4319/api/diaries');

  conn.end();
}).connect({ host: '47.115.220.98', port: 22, username: 'root', password: 'MdHJCDMyYDtK4P', readyTimeout: 10000 });
