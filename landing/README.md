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

## Deployment

This site deploys as its own assets-only Cloudflare Worker (`sightlines-landing`, see `wrangler.jsonc`) bound to `sightlines.art` and `www.sightlines.art`. The application deploys separately from the repo root to `app.sightlines.art`.

```sh
npm run build
npx wrangler deploy
```

`public/` carries the origin-level files for the apex: `_headers` (HSTS, same-origin CSP, etc. — keep in sync with the app's `public/_headers` so the security page's claims stay true), `robots.txt`, `sitemap.xml`, `llms.txt`, and `.well-known/security.txt`.

## Notes

- Builds with `format: "file"` (`/about` → `about.html`); Cloudflare serves these extensionless and redirects `.html` URLs, so pre-split links like `/about.html` keep working.
- Design language mirrors the app and existing trust pages: white ground, square corners, hairlines, petrol accent, Figtree (display) + Geist (body).
