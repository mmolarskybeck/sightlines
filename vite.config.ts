import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    // The three chunk is intentionally large; it loads only via the lazy
    // ThreeDView import (enforced by scripts/assert-chunk-graph.mjs). Warn
    // only if it grows well past its current ~830 kB.
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        manualChunks(id) {
          // Vite's preload helper is used by both the eager entry and the lazy 3D
          // stack; without pinning it eagerly, Rollup can place it inside the three
          // chunk, giving index a static import of all of three.js.
          if (id.includes("vite/preload-helper")) return "vendor";
          if (!id.includes("node_modules")) return undefined;
          // 3D stack is reachable only from the lazy ThreeDView import; its own chunk
          // keeps it off the critical path. Includes fiber/drei transitive deps.
          if (/node_modules\/(three|@react-three|three-stdlib|react-reconciler|its-fine|suspend-react|maath)\//.test(id)) {
            return "three";
          }
          return "vendor";
        }
      }
    }
  },
  server: {
    port: process.env.PORT ? Number(process.env.PORT) : 5173,
    strictPort: false
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: "./src/test/setup.ts"
  }
});
