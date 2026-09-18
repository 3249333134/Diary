import { Client } from 'ssh2';
import fs from 'node:fs';
import path from 'node:path';

const PASSWORD = 'MdHJCDMyYDtK4P';
const HOST = '47.115.220.98';
const PORT = 22;
const USER = 'root';

const conn = new Client();

conn.on('ready', async () => {
  console.log('=== SSH CONNECTED ===');

  // Step 1: Check/install Node.js 22
  console.log('\n=== Step 1: Node.js setup ===');
  let nodeOk = false;
  await new Promise((resolve) => {
    conn.exec('node -v && npm -v', (err, stream) => {
      if (err) { resolve(); return; }
      let out = '';
      stream.on('close', () => {
        if (out.includes('v22') || out.includes('v23') || out.includes('v24')) {
          console.log('Node.js already installed:', out.trim());
          nodeOk = true;
        } else {
          console.log('Existing Node.js:', out.trim(), 'but need v22+');
        }
        resolve();
      }).on('data', d => out += d);
      stream.stderr.on('data', () => {});
    });
  });

  if (!nodeOk) {
    console.log('Installing Node.js 22 via nvm...');
    await new Promise((resolve) => {
      const script = `
curl -fsSL https://rpm.nodesource.com/setup_22.x | bash - && yum install -y nodejs
`;
      conn.exec(script, { pty: true }, (err, stream) => {
        if (err) { console.error(err); resolve(); return; }
        stream.on('close', () => resolve())
              .on('data', d => process.stdout.write(d));
        stream.stderr.on('data', d => process.stderr.write(d));
      });
    });
    // Verify
    await new Promise((resolve) => {
      conn.exec('node -v && npm -v', (err, stream) => {
        let out = '';
        stream.on('close', () => { console.log('Node.js:', out.trim()); resolve(); })
              .on('data', d => out += d);
      });
    });
  }

  // Step 2: Install pm2
  console.log('\n=== Step 2: pm2 setup ===');
  await new Promise((resolve) => {
    conn.exec('which pm2 && pm2 -v', (err, stream) => {
      let out = '';
      stream.on('close', () => {
        if (out.includes('pm2') && !out.includes('not found')) {
          console.log('pm2 already installed:', out.trim());
          resolve();
        } else {
          console.log('Installing pm2...');
          conn.exec('npm install -g pm2', (err2, stream2) => {
            stream2.on('close', () => resolve())
                   .on('data', d => process.stdout.write(d));
            stream2.stderr.on('data', d => process.stderr.write(d));
          });
        }
      }).on('data', d => out += d);
    });
  });

  // Step 3: Prepare directory
  console.log('\n=== Step 3: Prepare /opt/diary ===');
  await exec(conn, 'mkdir -p /opt/diary && rm -rf /opt/diary/*');

  // Step 4: Upload deploy.zip
  console.log('\n=== Step 4: Upload deploy package ===');
  const localZip = path.resolve('diary-deploy.zip');
  if (!fs.existsSync(localZip)) {
    console.error('diary-deploy.zip not found! Run build first.');
    conn.end();
    return;
  }
  await new Promise((resolve, reject) => {
    conn.sftp((err, sftp) => {
      if (err) { reject(err); return; }
      console.log('SFTP connected, uploading...');
      sftp.fastPut(localZip, '/opt/diary/deploy.zip', {
        step: (transferred, total) => {
          if (transferred % 10000 === 0 || transferred === total) {
            process.stdout.write(`\rUploading: ${((transferred/total)*100).toFixed(1)}%`);
          }
        }
      }, (err) => {
        console.log('');
        if (err) { reject(err); } else { console.log('Upload done!'); resolve(); }
        sftp.end();
      });
    });
  });

  // Step 5: Unzip and install dependencies
  console.log('\n=== Step 5: Unzip + npm install ===');
  await exec(conn, 'cd /opt/diary && unzip -o deploy.zip && rm deploy.zip');
  await exec(conn, 'cd /opt/diary && npm install --omit=dev 2>&1 | tail -5');

  // Step 6: Create .env
  console.log('\n=== Step 6: Create .env ===');
  const envContent = `HOST=0.0.0.0
PORT=4319
OBSIDIAN_DIR=/opt/diary/vault
DIARY_TIMEZONE=Asia/Shanghai
AI_API_KEY=${process.env.AI_API_KEY || ''}
`;
  await new Promise((resolve, reject) => {
    conn.sftp((err, sftp) => {
      if (err) { reject(err); return; }
      sftp.writeFile('/opt/diary/.env', envContent, (err) => {
        if (err) { reject(err); } else { console.log('.env created'); resolve(); }
        sftp.end();
      });
    });
  });

  // Create vault dir
  await exec(conn, 'mkdir -p /opt/diary/vault');

  // Step 7: Start with pm2
  console.log('\n=== Step 7: pm2 start ===');
  // Stop any existing diary process
  await exec(conn, 'pm2 stop diary 2>/dev/null; pm2 delete diary 2>/dev/null');
  
  const startScript = `cd /opt/diary && pm2 start apps/api/dist/index.js --name diary && pm2 save && pm2 startup systemd -u root --hp /root 2>&1 | tail -10`;
  await exec(conn, startScript);

  // Check
  await new Promise((resolve) => {
    setTimeout(() => {
      conn.exec('pm2 list && curl -s http://127.0.0.1:4319/api/health', (err, stream) => {
        stream.on('close', () => resolve())
              .on('data', d => process.stdout.write(d));
        stream.stderr.on('data', d => process.stderr.write(d));
      });
    }, 2000);
  });

  // Step 8: Update nginx config in Docker container
  console.log('\n=== Step 8: Update gateway nginx config ===');
  
  // Read the current nginx config from container
  let currentConf = '';
  await new Promise((resolve) => {
    conn.exec('docker exec project-ark-gateway cat /etc/nginx/nginx.conf', (err, stream) => {
      stream.on('close', () => resolve())
            .on('data', d => currentConf += d);
    });
  });

  // Replace proxy_pass from 127.0.0.1:14319 to host.docker.internal:4319
  const newConf = currentConf.replace(
    'proxy_pass http://127.0.0.1:14319;',
    'proxy_pass http://host.docker.internal:4319;'
  );

  console.log('proxy_pass updated to host.docker.internal:4319');

  // Also check if host.docker.internal is resolvable - if not, add --add-host
  await new Promise((resolve) => {
    conn.exec('getent hosts host.docker.internal 2>/dev/null || echo "NOT_RESOLVED"', (err, stream) => {
      let out = '';
      stream.on('close', () => {
        console.log('host.docker.internal resolves:', out.trim());
        resolve();
      }).on('data', d => out += d);
    });
  });

  // Write new config to host file
  await new Promise((resolve, reject) => {
    conn.sftp((err, sftp) => {
      if (err) { reject(err); return; }
      sftp.writeFile('/tmp/diary-nginx-new.conf', newConf, (err) => {
        if (err) { reject(err); } else { resolve(); }
        sftp.end();
      });
    });
  });

  // Copy to container and reload
  await exec(conn, 'docker cp /tmp/diary-nginx-new.conf project-ark-gateway:/etc/nginx/nginx.conf');
  await exec(conn, 'docker exec project-ark-gateway nginx -t');
  await exec(conn, 'docker exec project-ark-gateway nginx -s reload');
  console.log('Gateway nginx reloaded!');

  // Step 9: Verify
  console.log('\n=== Step 9: Final verification ===');
  await new Promise((resolve) => {
    setTimeout(() => {
      conn.exec('curl -s --connect-timeout 5 http://127.0.0.1:4319/api/health && echo "" && curl -sk --connect-timeout 5 -u hongcheng:xumin999 https://127.0.0.1:3399/api/health 2>&1', (err, stream) => {
        stream.on('close', () => { resolve(); conn.end(); })
              .on('data', d => process.stdout.write(d));
        stream.stderr.on('data', d => process.stderr.write(d));
      });
    }, 2000);
  });

  console.log('\n=== DEPLOY COMPLETE ===');
}).on('error', err => {
  console.error('SSH ERROR:', err.message);
}).connect({ host: HOST, port: PORT, username: USER, password: PASSWORD, readyTimeout: 15000 });

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
