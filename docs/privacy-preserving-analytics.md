# Privacy-Preserving Analytics and Observability

**Status:** Phase 2 local privacy boundary implemented; Cloudflare analytics launch approved and in progress; Sentry deferred
**Last updated:** 2026-07-19

This document is the source of truth for Sightlines analytics, uptime
monitoring, and automated error reporting. It defines what may be measured,
what must never leave the user's device or Dropbox account, how users control
optional reporting, and which public disclosures must change before telemetry
ships.

The governing principle is:

> Sightlines measures the app, not the person. Project content, artwork, files,
> and Dropbox data remain private. We collect only the minimum aggregate usage
> and technical signals needed to improve reliability and understand whether
> the product works.

Analytics events are still data. Public copy must not claim that Sightlines
collects "no user data" once telemetry ships. The accurate promise is that
Sightlines does not collect user content, build identifiable profiles, or tie
product activity to a person.

## 1. Non-Negotiable Privacy Contract

Sightlines must never send any of the following through analytics or error
reporting:

- Project files, room geometry, layouts, wall placements, or saved views.
- Artwork images, thumbnails, metadata, titles, artists, accession numbers,
  dimensions, lenders, or locations.
- Project titles, room names, wall names, filenames, import column names, or
  other user-authored text.
- Dropbox account labels, access tokens, file paths, file contents, or backup
  metadata.
- Exported PDFs, images, `.sightlines` packages, attachments, or screenshots.
- Names, email addresses, account identifiers, advertising identifiers, or a
  persistent analytics identifier.
- Full URLs, query strings, request bodies, headers, console logs, DOM content,
  keystrokes, pointer trails, or session recordings.
- Arbitrary/free-form event properties. Every event name and property value
  must come from a reviewed allowlist.

Additional rules:

- No Session Replay. Enabling it would require a new privacy decision, a new
  threat review, and explicit user consent; it is not part of this plan.
- No analytics, error SDK, or custom event request may initialize before the
  relevant local preference permits it.
- Declining telemetry must not disable, degrade, or repeatedly interrupt the
  app.
- A field may be collected only if the privacy policy can name it and the team
  can identify the concrete product or maintenance decision it supports.
- New events require review of their payload, disclosure impact, retention,
  and tests before release.

## 2. Three Separate Measurement Layers

These systems answer different questions and must remain independently
configurable.

### 2.1 Uptime monitoring: is the public app reachable?

An external synthetic monitor should request the production app without
loading any client telemetry. This monitor represents Sightlines, not a user,
so it does not require an in-app preference.

The check should verify more than a generic HTTP `200`:

- `https://app.sightlines.art/` returns `200` and `Content-Type: text/html`.
- The response contains a stable Sightlines marker such as
  `<title>Sightlines</title>`.
- A known built JavaScript asset returns JavaScript rather than the SPA HTML
  fallback.
- DNS, TLS, timeout, and unexpected redirect failures trigger an alert.

Sentry Uptime or another external provider is acceptable. A monitor running
inside the same Cloudflare deployment is insufficient as the only check,
because a provider-wide routing failure could prevent both the app and its
monitor from running.

### 2.2 Anonymous usage analytics: which product capabilities are useful?

Use two deliberately limited sources:

1. **Cloudflare Web Analytics, manually loaded after consent** for visits,
   page views, device/browser categories, and Core Web Vitals.
2. **A same-origin first-party event endpoint backed by Cloudflare Workers
   Analytics Engine** for aggregate feature events that Cloudflare Web
   Analytics does not support.

Cloudflare's automatic Web Analytics injection must not be used because it
cannot honor a per-device Sightlines preference. Configure manual snippet
installation and load the beacon only when anonymous usage analytics are
enabled.

Cloudflare currently retains unsampled Web Analytics beacon data for seven
days, then aggregates it for longer-term storage; the previous six months are
available in the dashboard. Workers Analytics Engine stores product-event data
for three months. Re-check these provider-controlled periods before each
privacy-policy update.

Do not claim an exact number of individual users without an identifier.
Initial reporting should use visits and aggregate event counts as reach and
adoption proxies. A persistent or pseudonymous device ID would materially
change the privacy contract and is not authorized by this plan.

#### Initial product-event allowlist

| Event | Allowed properties | Decision it supports |
| --- | --- | --- |
| `app_opened` | app version only | Is the app being reached successfully? |
| `project_created` | none | Are new users reaching a meaningful starting point? |
| `artwork_import_completed` | source category: `images`, `spreadsheet`, or `combined` | Which intake paths need investment? |
| `view_opened` | view: `plan`, `elevation`, or `3d` | Which planning representations are used? |
| `pdf_export_completed` | none | Is document export delivering value? |
| `package_import_completed` | none | Is project portability used? |
| `cloud_backup_connected` | provider: `dropbox` | Is optional backup being adopted? |

Events should record successful outcomes rather than every click. Do not use
time-on-site, click volume, or interaction frequency as proxies for user value;
they can reward confusion instead of successful planning.

### 2.3 Anonymous crash reports: is the browser app failing?

Sentry may be added later because Cloudflare delivery metrics cannot reveal a
React crash, IndexedDB failure, failed dynamic import, or browser-only error.
The first Sentry integration must be errors-only and must remain separately
controllable from usage analytics.

Required Sentry configuration and review:

- Initialize only when **Anonymous crash reports** is enabled.
- Set `sendDefaultPii: false` and disable server-side IP storage in the Sentry
  project.
- Do not enable Session Replay, tracing, profiling, logs, attachments, user
  feedback attachments, or automatic user context.
- Drop automatic UI-click, keypress, navigation, console, and network
  breadcrumbs. Add only reviewed, predefined technical breadcrumbs if a real
  debugging need emerges.
- Use `beforeSend` to remove user, request, URL/query, headers, contexts,
  extras, breadcrumbs, and attachments unless a field is explicitly allowed.
- Audit error construction before launch. Error messages can accidentally
  contain filenames, project titles, imported values, or provider responses.
- Allow only sanitized exception type/category, stack frames, release/app
  version, environment, and coarse browser/OS category.
- Upload source maps during the build/release flow; never attach project state
  to make an error easier to reproduce.
- Configure short retention appropriate to the chosen Sentry plan and state
  that period in the public privacy policy before enabling collection.

## 3. Consent and In-App Controls

Use a one-time privacy notice, not a generic "cookie banner." The planned
analytics do not require analytics cookies, but they still involve optional
network reporting and should be explained before it begins.

Recommended first-use copy:

> **Help improve Sightlines**
>
> Sightlines can send anonymous usage, performance, and technical error
> information so we can understand which features are useful and where the app
> needs work. We never collect project content, artwork information, images,
> files, filenames, or Dropbox data.

Actions:

- **Allow anonymous reporting**
- **No thanks**
- **Learn more** → `https://sightlines.art/privacy`

The choice must be neutral: no preselected option, misleading color hierarchy,
or repeated prompting after refusal. Store only the preference needed to honor
the choice on that device.

Settings must expose two independent controls under **Storage & data**:

- **Anonymous usage analytics** — "Share aggregate feature-use and performance
  information. Never includes project or artwork content."
- **Anonymous crash reports** — "Send sanitized technical errors when
  Sightlines stops working. Never includes project content, images, filenames,
  or Dropbox data."

Turning either control off must stop future reporting immediately. Uptime
monitoring remains independent because it checks Sightlines' public URL rather
than observing a user's session.

## 4. Recommended Public Policy

The public privacy policy should retain the local-first explanation and add a
plain-language section substantially like this:

### Anonymous analytics and diagnostics

Sightlines is local-first: your projects, room layouts, artwork information,
images, and exports remain on your device. If you connect Dropbox, backups move
directly between your browser and your own Dropbox app folder; Sightlines does
not receive a copy.

With your permission, Sightlines sends limited anonymous analytics and
technical diagnostics so we can understand whether the app is working and
which major features are useful. Usage analytics may include visits, general
browser or device categories, performance measurements, and predefined events
such as completing an artwork import, opening Plan, Elevation, or 3D, exporting
a PDF, or connecting optional backup. Crash reports may include a sanitized
error type, code location, app version, and general browser information.

These reports never include project content, artwork details or images,
filenames, room or project names, exported files, Dropbox contents or tokens,
keystrokes, session recordings, or advertising identifiers. Sightlines does
not use this information to build individual profiles or sell it. Analytics
and crash reporting can be declined on first use or changed later in Settings;
declining does not affect the app.

Cloudflare processes site delivery, privacy-preserving web measurements, and
aggregate first-party product events on Sightlines' behalf. If Sentry error
reporting is enabled in a future release, the policy must name Sentry, describe
the exact fields sent, state the configured retention period, and link to its
privacy information before that release ships.

The final policy must separately state:

- Which processors are active at that time; do not describe planned Sentry as
  already collecting.
- Current retention periods for Cloudflare Web Analytics, Workers Analytics
  Engine, and Sentry.
- That ordinary hosting/security infrastructure necessarily processes request
  metadata such as IP addresses to deliver and protect the service, while
  Sightlines does not write IP addresses or request metadata into its custom
  product-event dataset.
- How to withdraw permission and where to ask a privacy question.
- The policy effective date and a concise change summary when analytics first
  ships.

This document is product guidance, not jurisdiction-specific legal advice.
Review the final public policy for the launch regions and institutional users
Sightlines supports.

## 5. Public-Facing Content Update Checklist

The following updates are release blockers for the first analytics-enabled
deployment.

### Landing site

- [x] `landing/src/content/pages/privacy.md`
  - Replace "no tracking" and "no analytics" claims.
  - Add the analytics/diagnostics section above, active processors, retention,
    controls, contact route, effective date, and change summary.
- [x] `landing/src/pages/index.astro`
  - Replace "No analytics, advertising, or tracking" with a precise claim such
    as "No project uploads, advertising, or personal profiles."
- [x] `landing/src/content/pages/security.md`
  - Replace "No third-party scripts load" and "No third-party analytics"
    claims.
  - Document the narrowly allowed Cloudflare beacon and, only after it ships,
    Sentry ingestion. Keep the CSP source list exact.
- [x] `landing/src/content/pages/it.md`
  - Replace claims that there are no third-party requests or tracking beacons.
  - Give institutional reviewers a concise data-flow table covering Cloudflare
    Web Analytics, the same-origin product-event endpoint, optional Sentry, and
    direct-to-Dropbox backup.
- [x] `landing/public/llms.txt`
  - Replace "No third-party tracking scripts" with the current, content-free
    analytics and diagnostics boundary.

### Application

- [x] `public/llms.txt`
  - Replace "No third-party tracking" with the same accurate summary.
- [x] `src/app/components/dialogs/SettingsDialog.tsx`
  - Add separate usage-analytics and crash-report controls with links to the
    privacy page.
- [x] First-use application surface
  - Add the neutral consent notice and ensure it is keyboard and screen-reader
    accessible.
- [x] `src/app/components/dialogs/HelpDialog.tsx` and `helpContent.ts`
  - Confirm the privacy summary and link remain accurate after analytics ship.
  - Qualify the former absolute "no uploads" summary for explicit exports and
    direct-to-Dropbox backup.
- [x] `public/_headers` and `landing/public/_headers`
  - Update CSP only for providers actually enabled. Do not add
    `'unsafe-inline'` to support analytics or Cloudflare JavaScript Detections.

### Repository and release communication

- [x] `README.md`
  - Replace any absolute privacy claim that becomes inaccurate.
- [x] `docs/status.md`
  - Record the shipped providers, controls, event allowlist, verification, and
    public-policy update date.
- [ ] Release notes/changelog
  - Announce telemetry before or with the release, including how to decline it
    and an explicit statement that project/artwork/Dropbox content is excluded.
- [ ] Cloudflare dashboard
  - Disable automatic Web Analytics injection; use manual installation so the
    app preference is authoritative.
  - Keep Bot Fight Mode off. Because the free dashboard does not expose a
    separate JavaScript Detections switch, serve app HTML with
    `Cache-Control: no-transform` so Cloudflare does not inject an incompatible
    inline challenge script. Speed Brain may remain enabled. Do not weaken CSP
    merely to silence an injected inline-script warning.
- [ ] Sentry dashboard, if adopted
  - Disable IP storage, configure retention and scrubbing, exclude replays and
    attachments, and configure error/uptime alerts.

## 6. Implementation Plan

Each phase is independently reviewable and should remain uncommitted for manual
review under the repository workflow.

### Phase 0 — Finalize the contract

- [x] Use consent-first reporting. A fresh or malformed local preference keeps
  both categories disabled until the user makes an explicit choice.
- [x] Approve the initial event allowlist and reject any event without a named
  product decision.
- [x] Confirm launch providers and retention: Cloudflare Web Analytics (seven
  days unsampled, then aggregated; six months dashboard access) and Workers
  Analytics Engine (three months). Sentry is deferred and inactive. Privacy
  contact: `hello@sightlines.art`. Provider account configuration must still be
  verified before production enablement.
- [x] Update all public-facing disclosures listed in section 5 before enabling
  production collection.

### Phase 1 — External uptime monitoring

- [ ] Configure a production URL monitor with HTML marker and asset MIME
  assertions.
- [x] Send alerts to a tested owner channel.
- [x] Exercise a temporary failing assertion to prove alerts arrive, then
  restore and verify recovery notification.

### Phase 2 — Consent and shared telemetry boundary

- [x] Add a small typed privacy-preference module with separate usage and crash
  settings stored locally.
- [x] Add the first-use notice and Settings controls.
- [x] Create a single telemetry gateway; feature code must not call provider
  SDKs or `fetch` analytics endpoints directly.
- [x] Enforce compile-time event names/properties plus runtime payload
  validation and dropping of unknown fields.
- [x] Test default/declined/accepted preference behavior and changes made while
  the app is running.

### Phase 3 — Cloudflare Web Analytics

- [x] Switch Cloudflare to manual snippet installation.
- [x] Load the beacon only when usage analytics are enabled.
- [x] Update CSP with only the exact Cloudflare script/connect sources needed.
- [x] Verify that no beacon request occurs before consent or after opt-out.

### Phase 4 — First-party product events

- [x] Add a same-origin Worker endpoint and Analytics Engine binding.
- [x] Accept only `POST`, cap body size, validate origin/content type and the
  allowlist, and return without logging rejected payload content.
- [x] Write only event name, allowlisted properties (including app version only
  for `app_opened`), and the Analytics Engine server timestamp. Do not write
  request IP, user agent, referer, or identifiers.
- [x] Instrument successful outcomes at the narrow product seams listed in the
  allowlist.
- [ ] Add aggregate queries/dashboard notes that account for Analytics Engine
  sampling.

### Phase 5 — Optional Sentry errors-only integration

- [ ] Audit existing thrown errors for user-authored or provider content.
- [ ] Add the consent-gated, stripped-down SDK configuration from section 2.3.
- [ ] Upload source maps through the release build without publishing secrets.
- [ ] Test representative error envelopes and assert forbidden keys/values are
  absent before any live DSN is enabled.
- [ ] Configure issue alerts and verify one deliberate test exception end to
  end.

### Phase 6 — Browser and release verification

- [x] Playwright: fresh device sees the notice and sends no optional telemetry.
- [x] Playwright: decline persists locally and no provider endpoints are called.
- [x] Playwright: each control enables only its own telemetry category and
  turning it off stops future sends.
- [ ] Payload tests: seeded project titles, filenames, artist names, Dropbox
  labels, and imported values never appear in any outgoing body.
- [ ] CSP/browser smoke: no unexpected console violations and no automatic
  Cloudflare injection.
- [ ] Production smoke: uptime alerting, Cloudflare aggregate events, and
  optional Sentry test error work without exposing project content.

## 7. Ongoing Governance

- Review the event allowlist and public policy at every telemetry-related
  release.
- Quarterly, remove events that no longer support an active decision.
- Treat provider feature toggles such as Session Replay, AI-assisted debugging,
  expanded breadcrumbs, profiling, or user identification as new data
  collection—not harmless dashboard configuration.
- Keep provider access limited, use MFA, and periodically review team members,
  tokens, retention, and export permissions.
- If a telemetry incident could have included user content, stop collection,
  preserve only what is necessary to investigate, document impact, and update
  affected users as required.

## 8. Primary References

- [Cloudflare Web Analytics overview](https://developers.cloudflare.com/web-analytics/about/)
- [Cloudflare Web Analytics FAQ](https://developers.cloudflare.com/web-analytics/faq/)
- [Cloudflare Analytics Engine](https://developers.cloudflare.com/analytics/analytics-engine/)
- [Cloudflare Analytics Engine limits and retention](https://developers.cloudflare.com/analytics/analytics-engine/limits/)
- [Sentry uptime monitors](https://sentry.io/changelog/uptime-monitors-expanded-alert-configuration/)
- [Sentry JavaScript breadcrumbs](https://docs.sentry.io/platforms/javascript/guides/svelte/enriching-events/breadcrumbs/)
- [UK ICO guidance on cookies and similar technologies](https://ico.org.uk/for-organisations/direct-marketing-and-privacy-and-electronic-communications/guide-to-pecr/cookies-and-similar-technologies/)
