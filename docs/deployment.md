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

The first deploy creates the `sightlines` Worker in the Cloudflare account and publishes the contents of `dist/` to the generated `*.workers.dev` URL. Add a custom domain later in Cloudflare under Workers & Pages once the initial deployment is healthy.

## Build Settings

Use these values if enabling Cloudflare's Git-based builds:

| Setting | Value |
| --- | --- |
| Build command | `npm run build` |
| Deploy command | `npx wrangler deploy` |
| Output directory | `dist` |
| Production branch | `main` |

## Notes

- `assets.not_found_handling = "single-page-application"` serves `index.html` for navigation paths that do not match a built asset.
- Keep account IDs, API tokens, and secrets out of the repo. Use `wrangler login` locally or Cloudflare dashboard secrets/tokens in CI.
- If Sightlines later adds Cloudflare APIs, D1, R2, KV, or server-side auth, add a Worker entry point and bindings to `wrangler.jsonc`.
