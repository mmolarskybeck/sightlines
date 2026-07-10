import { defineCollection, z } from "astro:content";
import { glob } from "astro/loaders";

// Each markdown file in src/content/pages becomes a page at /<file-name>.
// Frontmatter supplies everything above the body: kicker, title, lede, meta.
const pages = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/pages" }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    kicker: z.string(),
    lede: z.string(),
    updated: z.coerce.date().optional(),
  }),
});

export const collections = { pages };
