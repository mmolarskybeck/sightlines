import { defineConfig } from "vite";
import { configDefaults } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    // Three.js is intentionally large but lazy; warn above its ~830 kB baseline.
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        manualChunks(id) {
          // Keep Vite's shared preload helper out of the lazy Three.js chunk.
          if (id.includes("vite/preload-helper")) return "vendor";
          if (!id.includes("node_modules")) return undefined;
          // Keep the full 3D stack off the critical path.
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
    setupFiles: "./src/test/setup.ts",
    // Avoid collecting duplicate suites from in-repo Claude worktrees.
    exclude: [...configDefaults.exclude, "**/.claude/**"]
  }
});
