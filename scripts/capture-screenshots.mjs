import { mkdir } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright-core";

const edge = process.env.EDGE_PATH || "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const target = process.env.QA_URL || "http://127.0.0.1:4173";
const tabName = process.env.QA_TAB || "关联";
const output = path.resolve("qa");
await mkdir(output, { recursive: true });

const browser = await chromium.launch({ executablePath: edge, headless: true });
try {
  for (const [name, viewport] of Object.entries({ desktop: { width: 1440, height: 1000 }, mobile: { width: 375, height: 812 } })) {
    const page = await browser.newPage({ viewport, colorScheme: "light" });
    await page.goto(target, { waitUntil: "networkidle" });
    await page.getByRole("tab", { name: tabName }).click();
    await page.waitForFunction((name) => document.querySelector('[role="tab"][aria-selected="true"]')?.textContent?.includes(name), tabName);
    await page.waitForTimeout(650);
    await page.screenshot({ path: path.join(output, `${name}.png`), fullPage: false });
    await page.close();
  }
} finally {
  await browser.close();
}
