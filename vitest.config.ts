import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: { "@diary/contracts": fileURLToPath(new URL("./packages/contracts/src/index.ts", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["apps/**/*.test.ts", "packages/**/*.test.ts"],
    testTimeout: 10_000,
  },
});
