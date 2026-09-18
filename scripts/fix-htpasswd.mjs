import { Client } from 'ssh2';

const PASSWORD = 'MdHJCDMyYDtK4P';
const HOST = '47.115.220.98';
const USER = 'root';

const conn = new Client();

conn.on('ready', async () => {
  console.log('=== SSH CONNECTED ===');

  // Step 1: Check htpasswd content
  console.log('\n=== htpasswd content ===');
  await exec(conn, 'cat /opt/project-ark/auth/.htpasswd');
  await exec(conn, 'cat /tmp/diary.htpasswd 2>/dev/null');

  // Step 2: Update template - fix htpasswd path
  console.log('\n=== Fix htpasswd path in template ===');
  let content = '';
  await new Promise((resolve) => {
    conn.exec('cat /opt/project-ark/source/deploy/remote/nginx.conf.template', (err, stream) => {
      stream.on('close', () => resolve())
            .on('data', d => content += d);
    });
  });
  
  const fixed = content.replace(
    'auth_basic_user_file /etc/nginx/diary.htpasswd;',
    'auth_basic_user_file /etc/project-ark/auth/.htpasswd;'
  );
  
  if (fixed === content) {
    console.log('Already fixed or no match');
    console.log('Current auth line:', content.match(/auth_basic_user_file.*/));
  } else {
    await new Promise((resolve, reject) => {
      conn.sftp((err, sftp) => {
        if (err) { reject(err); return; }
        sftp.writeFile('/opt/project-ark/source/deploy/remote/nginx.conf.template', fixed, (err) => {
          if (err) { reject(err); } else { console.log('Template updated'); resolve(); }
          sftp.end();
        });
      });
    });
  }

  // Step 3: Restart gateway
  console.log('\n=== Restart gateway ===');
  await exec(conn, 'docker restart project-ark-gateway');
  await new Promise(r => setTimeout(r, 2000));
  await exec(conn, 'docker logs project-ark-gateway --tail 5');

  // Step 4: Create proper htpasswd file matching expected credential
  // The user wants hongcheng:xumin999
  // Let's check if /opt/project-ark/auth/.htpasswd has the right creds
  // If not, we need to generate a proper one
  console.log('\n=== Generate correct htpasswd ===');
  // Check if htpasswd command available
  await exec(conn, 'which htpasswd 2>/dev/null; which openssl 2>/dev/null');
  
  // Use openssl to generate htpasswd for hongcheng:xumin999
  await exec(conn, 'printf "hongcheng:%s\\n" "$(openssl passwd -apr1 xumin999)" > /opt/project-ark/auth/.htpasswd.new && mv /opt/project-ark/auth/.htpasswd.new /opt/project-ark/auth/.htpasswd && cat /opt/project-ark/auth/.htpasswd');

  // Restart gateway again
  await exec(conn, 'docker restart project-ark-gateway');
  await new Promise(r => setTimeout(r, 2000));

  // Step 5: Test!
  console.log('\n=== Test with Basic Auth ===');
  await exec(conn, 'curl -sk -u hongcheng:xumin999 https://127.0.0.1:3399/api/health');
  await exec(conn, 'curl -sk -u hongcheng:xumin999 https://47.115.220.98:3399/api/health');

  console.log('\n=== Test without auth ===');
  await exec(conn, 'curl -sk https://47.115.220.98:3399/api/health | head -3');

  console.log('\n=== Test homepage ===');
  await exec(conn, 'curl -sk -u hongcheng:xumin999 https://47.115.220.98:3399/ | head -10');

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
