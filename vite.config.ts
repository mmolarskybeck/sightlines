import { defineConfig } from "vite";
import { configDefaults } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { Readable } from "node:stream";
import type { Plugin } from "vite";
import { DROPBOX_SHARE_PROXY_PATH } from "./src/app/cloud/dropboxShare";
import { handleDropboxShareRequest } from "./worker/index";

// Production routes shared-package downloads through the Cloudflare Worker.
// Vite does not execute that Worker by default, so bridge the same handler into
// local development rather than letting POST /api/dropbox-share fall through
// to Vite's 404. This keeps local review on the production data path.
function dropboxShareDevRelay(): Plugin {
  return {
    name: "sightlines-dropbox-share-dev-relay",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use(DROPBOX_SHARE_PROXY_PATH, async (request, response) => {
        try {
          const headers = new Headers();
          for (const [name, value] of Object.entries(request.headers)) {
            if (value === undefined) continue;
            headers.set(name, Array.isArray(value) ? value.join(", ") : value);
          }
          const host = request.headers.host ?? "127.0.0.1:5173";
          const method = request.method ?? "GET";
          const body = method === "GET" || method === "HEAD"
            ? undefined
            : Readable.toWeb(request) as unknown as BodyInit;
          const relayRequest = new Request(`http://${host}${DROPBOX_SHARE_PROXY_PATH}`, {
            method,
            headers,
            body,
            duplex: body ? "half" : undefined
          } as RequestInit & { duplex?: "half" });
          const relayResponse = await handleDropboxShareRequest(relayRequest);

          response.statusCode = relayResponse.status;
          relayResponse.headers.forEach((value, name) => response.setHeader(name, value));
          if (!relayResponse.body) {
            response.end();
            return;
          }
          Readable.fromWeb(relayResponse.body as never)
            .on("error", () => response.destroy())
            .pipe(response);
        } catch {
          if (!response.headersSent) response.statusCode = 502;
          response.end();
        }
      });
    }
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), dropboxShareDevRelay()],
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
