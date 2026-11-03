import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vite";

const server = "http://localhost:8080";

export default defineConfig({
  plugins: [vue()],
  base: "/admin/",
  build: {
    outDir: "../ambient-forge-web/admin",
    emptyOutDir: true,
    target: "es2020",
  },
  server: {
    port: 5173,
    proxy: {
      "/api": server,
      "/ws": { target: server, ws: true },
    },
  },
});
