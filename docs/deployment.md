# Cloudflare Deployment

Sightlines deploys as a static Vite React single-page app on Cloudflare Workers static assets. There is no Worker script yet; `wrangler.jsonc` only points Cloudflare at the Vite build output and enables the SPA fallback.

## One-Time Cloudflare Setup

1. Log in locally:

   ```sh
   npm run cf:login
   ```

2. Confirm Wrangler can see the account:

   ```sh
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

The first deploy creates the `sightlines` Worker in the Cloudflare account and publishes the contents of `dist/` to the generated `*.workers.dev` URL. Production is attached to `sightlines.art` through the custom domain route in `wrangler.jsonc`.

## Production and Branch Previews

Cloudflare Workers Builds should be the deployment authority for Sightlines. GitHub Actions, if added later, should run checks only.

Use these values in Cloudflare under `Workers & Pages > sightlines > Settings > Build`:

| Setting | Value |
| --- | --- |
| Production branch | `main` |
| Builds for non-production branches | Enabled |
| Root directory | `/` |
| Build command | `npm run build` |
| Deploy command | `npm run cf:deploy:prod` |
| Non-production branch deploy command / Version command | `npm run cf:deploy:preview` |

What this does:

- Pushes to `main` run `wrangler deploy`, promoting the build to production at `https://sightlines.art/`.
- Pushes to other branches run `wrangler versions upload --preview-alias <branch>`, creating a preview version without changing production.
- Branch names are sanitized before becoming aliases. For example, `feature/3d-preview` becomes `feature-3d-preview-sightlines.<workers-subdomain>.workers.dev`.
- The generated `sightlines.mmolarskybeck.workers.dev` URL can remain available as a fallback Worker URL, but the production user-facing URL is `sightlines.art`.

## Manual Commands

Local commands:

- `npm run deploy:dry-run` builds and validates the production Worker upload without publishing.
- `npm run deploy` builds and deploys production manually.
- `WORKERS_CI_BRANCH=my-branch npm run cf:deploy:preview` uploads a manual preview version for a branch-style alias.

## Notes

- `assets.not_found_handling = "single-page-application"` serves `index.html` for navigation paths that do not match a built asset.
- `public/_headers` is copied into `dist/_headers` during `npm run build` and is interpreted by Cloudflare Workers static assets. It sets baseline security headers, a conservative CSP, and long-lived caching for hashed `assets/*` files. The CSP keeps `style-src 'unsafe-inline'` because the React app uses measured inline styles for parts of the editor UI.
- `public/robots.txt`, `public/sitemap.xml`, `public/site.webmanifest`, `public/favicon.svg`, `public/llms.txt`, `public/.well-known/security.txt`, and the static trust pages (`about.html`, `privacy.html`, `security.html`, `it.html`) are lightweight trust/crawler signals for the production domain.
- Custom Domains on Workers match an exact hostname. Add `www.sightlines.art` separately or create a redirect rule if the `www` hostname should work.
- Keep account IDs, API tokens, and secrets out of the repo. Use `wrangler login` locally or Cloudflare dashboard secrets/tokens in CI.
- Runtime secrets and variables belong in the Worker settings, not in Workers Builds build variables.
- If Sightlines later adds Cloudflare APIs, D1, R2, KV, or server-side auth, add a Worker entry point and bindings to `wrangler.jsonc`.
