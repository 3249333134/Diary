import dotenv from "dotenv";
import path from "node:path";

const projectRoot = path.resolve(import.meta.dirname, "../../..");
dotenv.config({ path: path.join(projectRoot, ".env"), quiet: true });

export const config = {
  host: process.env.HOST || "127.0.0.1",
  port: Number(process.env.PORT || 4319),
  vaultRoot: path.resolve(process.env.OBSIDIAN_DIR || "D:/prj/obsidian"),
  dataDir: process.env.DIARY_DATA_DIR ? path.resolve(process.env.DIARY_DATA_DIR) : path.join(projectRoot, "data"),
  timezone: process.env.DIARY_TIMEZONE || "Asia/Shanghai",
  ai: {
    url: (process.env.AI_API_URL || "https://api.openai.com/v1").replace(/\/$/, ""),
    key: process.env.AI_API_KEY || "",
    model: process.env.AI_MODEL || "gpt-4o-mini",
    automatic: process.env.AI_AUTO_SUMMARY === "true",
    proxy: process.env.AI_PROXY || "",
  },
} as const;

export const vaultPaths = {
  daily: "00_INPUT-输入池/每日记录",
  weekly: "01_UNDERSTAND-理解层/周复盘/独立日记",
  material: "02_CONTENT-内容引擎/素材库/独立日记",
  system: "07_SYSTEM-系统/独立日记",
} as const;
