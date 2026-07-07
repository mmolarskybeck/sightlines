import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    // Named manual chunks get entry-level modulepreload hints even when only
    // reachable via dynamic import; without this filter the browser would
    // eagerly fetch the ~834 kB three chunk on first load.
    modulePreload: {
      resolveDependencies: (_url, deps) => deps.filter((dep) => !/assets\/three-/.test(dep)),
    },
    rollupOptions: {
      output: {
        manualChunks(id) {
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
