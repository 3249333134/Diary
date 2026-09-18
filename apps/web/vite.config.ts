import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const proxy = { "/api": { target: "http://127.0.0.1:4319", changeOrigin: false } };

export default defineConfig({
  plugins: [react()],
  server: { host: "127.0.0.1", port: 5173, proxy },
  preview: { host: "127.0.0.1", port: 4173, proxy },
});
