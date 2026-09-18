import { Client } from "ssh2";
const c = new Client();
c.on("ready", async () => {
  const run = (cmd) => new Promise((res) => c.exec(cmd, (e, s) => {
    let o = ""; s.on("data", d => o += d); s.stderr.on("data", d => o += d);
    s.on("close", () => { console.log(">>> " + cmd.substring(0, 140) + "\n" + o); res(); });
  }));
  await run(`docker exec diary-app node --input-type=module -e "
  import { serializeDiaryMarkdown } from '/app/apps/api/dist/markdown.js';
  const d = JSON.parse(process.argv[1]);
  try { serializeDiaryMarkdown(d); console.log('OK'); } catch(e) { console.log('ERR:', e.message, 'at line'); }
  " '{"date":"2026-09-10","weather":"小雨","sleep":"5.9","mood":"不错","facts":{"events":[{"id":"bb127c2a-c00b-4b01-9902-cd21dd43efb5","time":"07:58","note":"在家练习八段锦和五禽戏","remark":"","people":[],"places":[],"activities":[],"foods":[],"attachments":[{"path":"assets/2026-09/test.txt","name":"test.txt"}]}],"note":""},"learn":{"sources":[],"content":""},"input":{"kind":"书","names":[],"excerpt":""},"idea":{"tags":[],"content":""}}'`);
  c.end();
});
c.connect({ host: "47.115.220.98", port: 22, username: "root", password: "MdHJCDMyYDtK4P", readyTimeout: 15000 });
