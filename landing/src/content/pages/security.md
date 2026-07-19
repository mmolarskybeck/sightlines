---
title: "A small, static surface"
description: "Sightlines security overview: static architecture, HTTPS with strict security headers, local-only data storage, and how to report a vulnerability."
kicker: "Security"
lede: "Sightlines keeps its attack surface deliberately small: a static web application with no server-side database, no user accounts, and no hosted user content. The most sensitive data in the system — your exhibition plans and artwork images — never leaves your device."
---

## Architecture

The application at [app.sightlines.art](https://app.sightlines.art/) is a static React application served from Cloudflare's edge network. This page and the rest of sightlines.art are a separate static informational site, with no client-side JavaScript at all. Neither origin runs an application server processing user input, maintains server-side session state, or hosts user projects or images. Project data is held in the browser's local storage and leaves the device only when the user explicitly exports a file or connects their own Dropbox account for automatic backup — in which case backups go directly from the browser to the user's Dropbox app folder, never through Sightlines.

## Transport and headers

- All traffic is served over HTTPS, with `Strict-Transport-Security` enforcing it for a year.
- A restrictive `Content-Security-Policy` limits scripts, styles, fonts, and images to the site's own origin, and network connections to the site's own origin plus the Dropbox API endpoints used by optional cloud backup. No third-party scripts load at all.
- `X-Frame-Options: DENY` and `frame-ancestors 'none'` prevent the app from being embedded in other sites.
- `X-Content-Type-Options`, `Referrer-Policy`, a locked-down `Permissions-Policy`, and `Cross-Origin-Opener-Policy` are also set on every response.
- These headers are applied on every response from both sightlines.art and app.sightlines.art.

## What is not here

- No executable installers or desktop binaries are distributed from either domain.
- No third-party analytics, advertising, or tracking scripts.
- No password handling: there are no accounts to compromise.
- No payment processing.

## Reporting a vulnerability

If you believe you've found a security issue in Sightlines, we want to hear about it. Current contact details are published in the machine-readable record at [/.well-known/security.txt](/.well-known/security.txt), following RFC 9116. Please report issues privately and allow reasonable time for a fix before public disclosure. We appreciate good-faith research and will credit reporters who want credit.
