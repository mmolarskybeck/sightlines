# Cloudflare Deployment

Sightlines deploys as two separate Cloudflare Workers: a static Astro landing site at the apex (`sightlines.art`) and a Vite React single-page app at the app subdomain (`app.sightlines.art`).

## Architecture

| Component | Location | Serves | URL |
| --- | --- | --- | --- |
| Landing site | `landing/` (Astro) | Marketing, docs, markdown-based content | `https://sightlines.art/` |
| App | `app/` (Vite React SPA) | Interactive editor | `https://app.sightlines.art/` |

Each has its own `wrangler.jsonc` configuration and custom domain binding in Cloudflare.

## One-Time Cloudflare Setup

### Landing Site

1. Log in locally:

   ```sh
   npm run cf:login
   ```

2. Navigate to the landing directory and confirm Wrangler can see the account:

   ```sh
   cd landing
   npm run cf:whoami
   ```

3. Run a dry deployment check:

   ```sh
   npm run deploy:dry-run
   ```

4. Deploy:

   ```sh
   npm run deploy
   ```

This creates the `sightlines-landing` Worker in Cloudflare and attaches it to `sightlines.art` via custom domain binding.

### App

Repeat the above steps in the `app/` directory:

```sh
cd app
npm run deploy
```

This creates the `sightlines-app` Worker and attaches it to `app.sightlines.art` via custom domain binding.

## Production and Branch Previews

Cloudflare Workers Builds should be the deployment authority for Sightlines. GitHub Actions, if added later, should run checks only.

### Landing Site

Use these values in Cloudflare under `Workers & Pages > sightlines-landing > Settings > Build`:

| Setting | Value |
| --- | --- |
| Production branch | `main` |
| Builds for non-production branches | Enabled |
| Root directory | `/landing` |
| Build command | `npm run build` |
| Deploy command | `npm run cf:deploy:prod` |
| Non-production branch deploy command | `npm run cf:deploy:preview` |

### App

Use these values in Cloudflare under `Workers & Pages > sightlines-app > Settings > Build`:

| Setting | Value |
| --- | --- |
| Production branch | `main` |
| Builds for non-production branches | Enabled |
| Root directory | `/app` |
| Build command | `npm run build` |
| Deploy command | `npm run cf:deploy:prod` |
| Non-production branch deploy command | `npm run cf:deploy:preview` |

What this does:

- Pushes to `main` run `wrangler deploy` in each worker directory, promoting builds to production.
- Pushes to other branches run `wrangler versions upload --preview-alias <branch>`, creating preview versions without changing production.
- Branch names are sanitized before becoming aliases.

## Manual Commands

Local commands for the landing site:

```sh
cd landing
npm run deploy:dry-run  # Validate production upload without publishing
npm run deploy          # Deploy production manually
```

Local commands for the app:

```sh
cd app
npm run deploy:dry-run  # Validate production upload without publishing
npm run deploy          # Deploy production manually
```

## DNS and Custom Domains

The production domain `sightlines.art` has two custom domain bindings:

- `sightlines.art` → `sightlines-landing` Worker
- `app.sightlines.art` → `sightlines-app` Worker
- `www.sightlines.art` → `sightlines-landing` Worker (via Cloudflare Redirect Rule)

The `www` subdomain is redirected to the apex via Cloudflare's dashboard Redirect Rules; all HTTP traffic is redirected to HTTPS.

**Note:** If your network DNS sinkholes `sightlines.art`, you can verify the deployment using DNS-over-HTTPS (DoH) or `curl --resolve`:

```sh
curl --resolve sightlines.art:443:192.0.2.1 https://sightlines.art/
```

## Notes

### Landing Site (Astro)

- `landing/public/_headers` sets baseline security headers, CSP, and caching rules for the landing site.
- `landing/public/robots.txt`, `sitemap.xml`, `site.webmanifest`, etc., are trust signals for SEO and crawler indexing.
- Astro outputs static HTML; there is no Worker script, just static asset serving.

### App (Vite React SPA)

- `assets.not_found_handling = "single-page-application"` in `app/wrangler.jsonc` serves `index.html` for navigation paths that do not match a built asset.
- `app/public/_headers` is copied into `dist/_headers` during build. The CSP keeps `style-src 'unsafe-inline'` because the React app uses measured inline styles for parts of the editor UI.
- `app/public/robots.txt` and `app/public/.well-known/security.txt` are trust signals.

### General

- Custom Domains on Workers match an exact hostname. Each worker's `wrangler.jsonc` specifies its custom domain.
- Keep account IDs, API tokens, and secrets out of the repo. Use `wrangler login` locally or Cloudflare dashboard secrets/tokens in CI.
- Runtime secrets and variables belong in the Worker settings, not in Workers Builds build variables.
- If either worker needs Cloudflare APIs (D1, R2, KV, etc.), add bindings to the respective `wrangler.jsonc`.
