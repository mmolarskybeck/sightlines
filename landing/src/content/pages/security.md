---
title: "Less to attack, by design"
description: "Sightlines security overview: static architecture, HTTPS, local-first project storage, and vulnerability reporting."
kicker: "Security"
lede: "Sightlines is deliberately simple, and that simplicity is its main protection: there are no user accounts, no central database of projects, and no user content stored on our side. Your exhibition plans and artwork images stay on your device unless you choose to export or back them up."
---

## Architecture

The application at [app.sightlines.art](https://app.sightlines.art/) and this informational site are static sites — pre-built pages with no server-side application code — served through Cloudflare. Neither hosts user projects, images, accounts, or server-side sessions.

Project data is stored in the browser. It leaves the device only when you export it or connect your own Dropbox account, in which case backups travel directly between the browser and a dedicated folder in your Dropbox account. Optional, content-free usage reporting runs only after you allow it. See the [privacy page](/privacy) for the data flows and retention periods.

## Security controls

- Both sites use HTTPS and HTTP Strict Transport Security.
- Content Security Policies restrict which scripts and network connections may run.
- Browser protections prevent framing, limit referrer information and permissions, and block content-type sniffing.
- There are no passwords, payment details, installers, or public user uploads to protect.
- There is no advertising, cross-site tracking, session replay, or personal profiling.

These controls reduce risk, but no software can be guaranteed free of vulnerabilities.

## Report a vulnerability

If you believe you have found a security issue, please report it privately using the current contact information at [/.well-known/security.txt](/.well-known/security.txt). Please allow reasonable time for investigation and a fix before public disclosure. We appreciate good-faith research and will credit reporters who want credit.
