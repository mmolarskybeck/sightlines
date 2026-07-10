# Sightlines landing site

Public-facing landing + trust pages for sightlines.art, built with [Astro](https://astro.build). Static output, zero client-side JavaScript, no external requests (fonts are self-hosted in `public/fonts`).

```sh
npm install
npm run dev      # local dev server at http://localhost:4321
npm run build    # static site → dist/
npm run preview  # serve the built site
```

## Editing content

- **Trust pages** (`/about`, `/privacy`, `/security`, `/it`) are plain markdown in `src/content/pages/`. Frontmatter supplies the header block (`kicker`, `title`, `lede`, `description`, optional `updated` date); the body below is ordinary markdown. Edit the `.md` file — no code changes needed.
- **Landing page** (`/`) lives in `src/pages/index.astro`. Copy is inline HTML; sections are labeled with comments.
- **Site-wide values** — the app URL for "Open the app" buttons, nav links, default meta description — are in `src/consts.ts`.
- **Shared chrome** (header, footer, `<head>` meta) is `src/layouts/BaseLayout.astro`; shared styles and design tokens are `src/styles/global.css`.

Adding a new markdown page: drop `something.md` into `src/content/pages/` with the same frontmatter fields and it becomes `/something` automatically (add it to `NAV_LINKS` in `src/consts.ts` if it belongs in the nav).

## Notes

- Builds with `format: "file"` (`/about` → `about.html`), matching how the current trust pages are served and how Cloudflare's static hosting resolves extensionless URLs.
- Design language mirrors the app and existing trust pages: white ground, square corners, hairlines, petrol accent, Figtree (display) + Geist (body).
