import { defineCollection, z } from "astro:content";
import { glob } from "astro/loaders";

// Each content page maps to /<file-name>; frontmatter supplies its metadata.
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
