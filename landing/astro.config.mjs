// @ts-check
import { defineConfig } from "astro/config";

export default defineConfig({
  site: "https://sightlines.art",
  trailingSlash: "never",
  build: {
    format: "file",
  },
});
