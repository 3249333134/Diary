import { Client } from 'ssh2';
import fs from 'node:fs';
import path from 'node:path';

const PASSWORD = 'MdHJCDMyYDtK4P';
const HOST = '47.115.220.98';
const USER = 'root';

const conn = new Client();

conn.on('ready', async () => {
  console.log('=== SSH CONNECTED ===');

  const localVault = 'D:/prj/obsidian/00_INPUT-输入池/每日记录';
  const remoteVault = '/opt/diary/vault/00_INPUT-输入池/每日记录';

  // Ensure remote dir exists
  await exec(conn, `mkdir -p "${remoteVault}"`);

  const files = fs.readdirSync(localVault).filter(f => f.endsWith('.md'));
  console.log(`Found ${files.length} diary files:`, files.join(', '));

  await new Promise((resolve, reject) => {
    conn.sftp(async (err, sftp) => {
      if (err) { reject(err); return; }
      try {
        for (const file of files) {
          const localPath = path.join(localVault, file);
          const remotePath = `${remoteVault}/${file}`;
          await new Promise((res, rej) => {
            sftp.fastPut(localPath, remotePath, (err) => {
              if (err) rej(err); else { console.log(`Uploaded: ${file}`); res(); }
            });
          });
        }
        sftp.end();
        resolve();
      } catch (e) { reject(e); }
    });
  });

  // Verify
  console.log('\n=== Verify remote files ===');
  await exec(conn, `ls -la "${remoteVault}"`);

  // Restart diary container to pick up files
  console.log('\n=== Restart diary container ===');
  await exec(conn, 'docker restart diary-app');
  await new Promise(r => setTimeout(r, 2000));

  // Verify API returns the dates
  console.log('\n=== Verify API ===');
  await exec(conn, 'curl -s http://127.0.0.1:4319/api/dates | head -c 500');

  conn.end();
  console.log('\n=== SYNC DONE ===');
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
