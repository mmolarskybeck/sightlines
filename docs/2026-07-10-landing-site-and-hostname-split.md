# Session Log — Landing Site & Hostname Split

Date: 2026-07-10 · Session: Claude Code (Fable 5) with Opus/Sonnet subagents
Outcome: **Astro landing site built and deployed live to sightlines.art; app moved to app.sightlines.art. Split verified end-to-end in production.**

## What shipped

### 1. Public landing site (`landing/`)

New self-contained Astro 5 project, deployed as its own assets-only Cloudflare Worker (`sightlines-landing`) bound to `sightlines.art` + `www.sightlines.art`.

- **Six pages**: landing index, About, Privacy, Security, For IT teams, 404.
- **Content is editable markdown**: the four trust pages live in `landing/src/content/pages/*.md` (frontmatter: `kicker`, `title`, `lede`, `description`, optional `updated`), rendered by `src/pages/[slug].astro` through a shared `BaseLayout.astro`. Dropping a new `.md` file into that folder creates a new page automatically.
- **Site-wide values** (app URL, nav links, default meta) in `landing/src/consts.ts`.
- **Design** extends the app's existing language rather than inventing a marketing look: white ground, square corners, hairline rules, petrol accent, Figtree display / Geist body (fonts self-hosted). Zero client-side JavaScript; no external requests; responsive to 360 px.
- **Hero illustration** is an inline SVG wall elevation: three framed works on a dashed petrol eye-line over a drafting grid. Dimension lines were revised mid-session to mirror real app behavior — edge-to-edge between works (460 mm), work-to-wall-end (800 mm), full wall length (4570 mm), floor-to-eye-line (1450 mm) — never center-to-center. Plan-view feature glyph shows straight walls only (door-swing arc removed; the app has no curved walls).
- Copy lightly tightened from the old `public/*.html` trust pages; all technical claims preserved verbatim. Privacy "last updated" date moved to frontmatter.

### 2. Hostname split

| Hostname | Serves | Worker |
|---|---|---|
| `sightlines.art` | Landing + trust pages | `sightlines-landing` (`landing/wrangler.jsonc`) |
| `app.sightlines.art` | The application | `sightlines` (root `wrangler.jsonc`) |
| `www.sightlines.art` | 301 → apex (dashboard Redirect Rule) | bound to landing worker for DNS/cert |

Decision context: an `app.` subdomain was chosen over `sightlines.art/app` because there are no existing users yet — the localStorage/IndexedDB origin change (which would strand every user's local-first project data) costs nothing today and buys the cleaner long-term architecture: independent deploys, per-origin headers, no merged Astro+Vite build.

### 3. App-side changes (repo root)

- `wrangler.jsonc` routes → `app.sightlines.art` only.
- `index.html`: canonical/OG → `https://app.sightlines.art/`; robots → `noindex` (the landing site is the single indexed surface).
- Deleted from `public/`: `about/privacy/security/it.html`, `trust.css`, `sitemap.xml`, `llms.txt` (all owned by the landing site now). Old `.html` URLs survive via Cloudflare's extensionless handling (`/about.html` → 307 → `/about`).
- `public/.well-known/security.txt` updated: Canonical → app origin, Contact/Policy → `https://sightlines.art/security`. Both origins publish security.txt.
- `public/_headers` unchanged; the landing carries an equivalent `_headers` so the security page's "on every response" claims hold on both origins.

### 4. Trust-page copy updated for two hostnames

The IT page now lists all three hostnames in its at-a-glance table and tells administrators to allowlist **both** `sightlines.art` and `app.sightlines.art`; privacy/security/about pages updated so "the app is served from…" statements stay accurate. Each origin's CSP restricts connections to itself; no cross-origin or third-party requests from either.

## Bugs found and fixed along the way

- Built canonicals pointed at `/about.html`, which Cloudflare 307-redirects — canonicals must not point at redirects. `BaseLayout.astro` now strips `.html` for canonicals and nav `aria-current` (which had never matched at build time).
- A subagent-invented hero claim ("works on desktop and tablet") was removed as unverified; replaced with "no sign-up."

## Deploy flip (executed this session)

1. App deployed to `app.sightlines.art` (Marina) — verified serving the new build (noindex, correct canonical, headers intact).
2. Apex + www custom domains detached from the app worker; their DNS records were deleted with them, so the apex went dark briefly.
3. `sightlines-landing` deployed, claiming apex + www and recreating DNS/certs.
4. Verified live from the public internet: apex 200 (landing), `/about` 200, `/about.html` → 307 → `/about`, HSTS/CSP/XFO present, unknown paths → real 404, security.txt 200, www → 301 apex.

## Gotchas worth remembering

- **Marina's local network sinkholes the whole domain** (Palo Alto newly-registered-domain filter rewrites DNS, even direct queries to 1.1.1.1). Local `curl`/`dig` against sightlines.art hostnames is meaningless. Verify via DNS-over-HTTPS (`curl -H "accept: application/dns-json" "https://cloudflare-dns.com/dns-query?name=<host>&type=A"`) plus `curl --resolve <host>:443:<cloudflare-ip>`. Ages out ~August 2026; `app.` may restart the clock with some filter vendors.
- `wrangler deploy` does **not** detach custom domains removed from config — dashboard step.
- Cloudflare serves built `.html` files extensionless and 307s the `.html` form, so Astro's `build.format: "file"` keeps every pre-split trust-page URL working.
- The impeccable design hook flags Geist as an "overused font" on every touch of `landing/src/styles/global.css` — standing false positive (Geist/Figtree are the brand fonts); left unsuppressed pending an explicit ignore.

## Open items

- **Marina's own project data** is stranded on the old apex origin's browser storage; re-import the exported project at `app.sightlines.art` (or recover via DevTools if never exported).
- `docs/deployment.md` still describes the single-worker apex deployment — needs updating for the two-worker split (landing README's Deployment section is current in the meantime).
- Landing worker deploys are manual (`cd landing && npm run build && npx wrangler deploy`); no CI.
- IT allowlist guidance now covers both hostnames; institutions that had allowlisted only the apex will need `app.sightlines.art` added.
