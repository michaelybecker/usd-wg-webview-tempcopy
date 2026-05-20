import { defineConfig } from "vite";

export default defineConfig({
  optimizeDeps: {
    exclude: ["@sparkjsdev/spark"],
  },
  server: {
    host: "127.0.0.1",
    port: 8000,
    strictPort: true,
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
      "Cross-Origin-Resource-Policy": "same-origin",
    },
  },
  preview: {
    host: "127.0.0.1",
    port: 8000,
    strictPort: true,
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
      "Cross-Origin-Resource-Policy": "same-origin",
    },
  },
});
