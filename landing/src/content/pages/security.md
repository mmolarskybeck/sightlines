---
title: "A small, static surface"
description: "Sightlines security overview: static architecture, HTTPS with strict security headers, local-only data storage, and how to report a vulnerability."
kicker: "Security"
lede: "Sightlines keeps its attack surface deliberately small: a static web application with no server-side database, no user accounts, and no hosted user content. The most sensitive data in the system — your exhibition plans and artwork images — never leaves your device."
---

## Architecture

The application at [app.sightlines.art](https://app.sightlines.art/) is a static React application served from Cloudflare's edge network. This page and the rest of sightlines.art are a separate static informational site whose only script is the cookie-less Cloudflare Web Analytics beacon; Cloudflare's edge may additionally inject an anti-bot snippet into responses, but this site's Content-Security-Policy prevents that snippet from executing. Neither origin maintains server-side session state or hosts user projects or images. Project data is held in the browser's local storage and leaves the device only when the user explicitly exports a file or connects their own Dropbox account for automatic backup — in which case backups go directly from the browser to the user's Dropbox app folder, never through Sightlines.

The app's optional anonymous usage reporting is a separate, content-free data flow. After permission, a manually loaded Cloudflare Web Analytics beacon sends page-performance measurements and the app may send predefined aggregate events to a same-origin Cloudflare Worker. Sentry and other crash-reporting services are not active.

## Transport and headers

- All traffic is served over HTTPS, with `Strict-Transport-Security` enforcing it for a year.
- A restrictive `Content-Security-Policy` limits scripts, styles, fonts, images, and network connections to an explicit allowlist. Beyond its own origin, the app allows only the consent-gated Cloudflare Web Analytics beacon, the same-origin product-event endpoint, and the Dropbox API endpoints used by optional cloud backup; this site allows only the beacon. Neither origin permits `'unsafe-inline'` scripts.
- `X-Frame-Options: DENY` and `frame-ancestors 'none'` prevent the app from being embedded in other sites.
- `X-Content-Type-Options`, `Referrer-Policy`, a locked-down `Permissions-Policy`, and `Cross-Origin-Opener-Policy` are also set on every response.
- These headers are applied on every response from both sightlines.art and app.sightlines.art.

## What is not here

- No executable installers or desktop binaries are distributed from either domain.
- No advertising, cross-site tracking, session replay, or user profiling. In-app analytics load only after permission; this site's analytics are cookie-less and aggregate.
- No password handling: there are no accounts to compromise.
- No payment processing.

## Reporting a vulnerability

If you believe you've found a security issue in Sightlines, we want to hear about it. Current contact details are published in the machine-readable record at [/.well-known/security.txt](/.well-known/security.txt), following RFC 9116. Please report issues privately and allow reasonable time for a fix before public disclosure. We appreciate good-faith research and will credit reporters who want credit.
