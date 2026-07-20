import { defineConfig } from "vite";
import { configDefaults } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    // stats-gl (via drei) nests its own three@0.170.0; force everything onto
    // the root copy so tests and the app never load two Three.js instances.
    dedupe: ["three"]
  },
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
          // Fontkit is independently large. Keep it beside, rather than inside,
          // the PDF writer chunk; Vite can preload both in parallel when export
          // begins while the global warning still catches eager-chunk growth.
          if (id.includes("node_modules/@pdf-lib/fontkit/")) {
            return "fontkit";
          }
          // The PDF stack is reachable only through the dynamic import in
          // handleExportPdf.
          if (/node_modules\/(pdf-lib|@pdf-lib)\//.test(id)) {
            return "pdf";
          }
          // SheetJS is only reached through the dynamic import in
          // parseImportWorkbook. Force it into its own chunk so it isn't
          // pulled into the eager vendor bundle — the spreadsheet parser
          // should download only when someone imports an Excel file.
          if (/node_modules\/xlsx\//.test(id)) {
            return "xlsx";
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
    // Keep agent worktrees and Playwright's browser suite out of Vitest.
    exclude: [...configDefaults.exclude, "**/.claude/**", "**/e2e/**"]
  }
});
