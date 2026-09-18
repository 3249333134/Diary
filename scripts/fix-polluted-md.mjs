import fs from "node:fs";
import path from "node:path";

const dir = "D:\\prj\\obsidian\\00_INPUT-输入池\\每日记录";
const files = fs.readdirSync(dir).filter((f) => f.endsWith(".md"));

// 被旧 bug 污染的模式：空字段吞掉了下一行的字段名
// 例如 "- 和谁：- 在哪：十所" → "- 和谁：\n- 在哪：十所"
const fixPattern = /^- (和谁|在哪|做了什么|吃了什么)[：:]- (和谁|在哪|做了什么|吃了什么)[：:]/gm;

let fixed = 0;
for (const file of files) {
  const p = path.join(dir, file);
  const content = fs.readFileSync(p, "utf8");
  if (!fixPattern.test(content)) continue;
  const repaired = content.replace(fixPattern, (_, a, b) => `- ${a}：\n- ${b}：`);
  fs.writeFileSync(p, repaired, "utf8");
  const matches = content.match(fixPattern) || [];
  fixed += matches.length;
  console.log(`${file}: fixed ${matches.length} line(s)`);
}
console.log(`\nTotal fixed: ${fixed} line(s)`);
