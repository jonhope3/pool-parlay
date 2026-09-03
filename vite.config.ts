import { defineConfig } from "vite";

export default defineConfig({
  base: "/",
  server: {
    host: true,
    strictPort: false,
  },
  preview: {
    host: true,
    strictPort: false,
  },
  build: {
    outDir: "dist",
    sourcemap: false,
    rollupOptions: {
      input: {
        main: "index.html",
        legal: "legal.html",
      },
    },
  },
});
