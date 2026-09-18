import { config } from "./config.js";
import { buildServer } from "./server.js";
import { startWeeklyScheduler } from "./weekly.js";

const app = await buildServer();
const scheduler = startWeeklyScheduler();

const shutdown = async () => {
  clearInterval(scheduler);
  await app.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

await app.listen({ host: config.host, port: config.port });
