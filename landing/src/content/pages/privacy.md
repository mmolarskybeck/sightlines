---
title: "Your exhibition stays on your device"
description: "How Sightlines keeps projects and artwork images on your device while limiting optional anonymous reporting."
kicker: "Privacy"
lede: "Unreleased exhibition plans, loan negotiations, and artwork images are sensitive material. Sightlines is built local-first, so none of that content has to leave your machine. There are no accounts, no hosted project storage, and optional anonymous reporting never includes your work."
updated: 2026-07-19
---

## What we store, and where

Everything you create in Sightlines (room layouts, wall elevations, artwork details, and the images you add to your checklist) is saved in your own browser's local storage, on your own device. We don't operate a project database, and Sightlines never receives or stores a copy of your work.

Because your data lives in the browser, clearing the browser's site data will erase your projects. Use the app's export feature to save backup files anywhere you like, and to move projects between machines or share them with colleagues.

## Optional cloud backup

Sightlines can back up your projects automatically to your own Dropbox account, which you connect yourself. Backups travel directly from your browser to your Dropbox, with no Sightlines server in the middle, so we never see the files. The connection is scoped to a single app folder, so Sightlines cannot read anything else in your account, and you can revoke access at any time from your Dropbox settings. If you never connect an account, no backup traffic occurs at all.

## What we don't do

- No account, sign-up, or login. We never ask for your name or email.
- No advertising, cross-site tracking, or personal analytics profiles.
- No cookies for tracking or profiling.
- No selling of data. We never have your projects, and analytics stay aggregate.

## Optional anonymous analytics

The Sightlines app sends usage information only if you allow it. It asks once, on first use. Nothing analytics-related loads before you answer, and declining costs you no feature. If you allow it, two things are reported:

- **Cloudflare Web Analytics** measures visits, coarse browser and device categories, and page performance.
- **Product events**, a short fixed list of milestones counted in aggregate: app opened (with app version), project created, artwork imported, a view opened (Plan, Elevation, or 3D), PDF exported, project package imported, and Dropbox backup connected. That is the complete list; the app cannot send events outside it.

These reports never include your work: no artwork details or images, filenames, room or project names, exported files, Dropbox contents or tokens, keystrokes, or session recordings. There is no persistent analytics identifier and no advertising ID, so the reports cannot be tied to you or used to build a profile, and we don't sell them.

You can change your mind anytime. **Anonymous usage analytics** and **Anonymous crash reports** are separate switches under **Settings → Storage & data**. Your choice is stored in your browser's local storage so the app can honor it on that device, and turning usage analytics off stops future reports.

**This website.** The informational site at sightlines.art, the pages you are reading now, uses Cloudflare Web Analytics. The beacon sets no cookies, stores nothing on your device, and does not fingerprint you or follow you across sites; it counts visits, page views, and page performance in aggregate. Your exhibition data is never in play here: the app is a separate origin, and its analytics stay behind your permission.

**Retention.** Cloudflare processes this data on our behalf. Web Analytics keeps unsampled beacon data for seven days, then stores aggregates; the previous six months are visible in its dashboard. Product events are kept in Cloudflare Workers Analytics Engine for three months, and Sightlines never writes IP addresses, user agents, referrers, or other request metadata into that dataset.

**Crash reports.** Crash reporting is not active yet; no provider currently receives anything. The switch exists so your preference is honored from day one. Before a provider (likely Sentry) is enabled, this policy will name it, list the exact fields sent, and state its retention.

## Your rights and legal bases

Optional analytics runs only with your consent. You can withdraw it at any time under **Settings → Storage & data**; withdrawal stops future reporting, though it cannot recall reports already sent.

Cloudflare's ordinary delivery and security processing, such as routing requests and blocking abuse, is necessary to operate the sites at all. We rely on our legitimate interest in running the service securely for that limited infrastructure processing; it is not used for advertising or profiling.

Sightlines makes no automated decisions about you. Depending on where you live, you may have rights to access, correct, delete, restrict, object to, or port personal data, and to complain to your local data-protection authority. Because there are no accounts and no persistent analytics identifier, we often cannot link aggregate analytics to a specific person; we will honor requests wherever the relevant data can be identified.

Cloudflare operates a global network, so infrastructure and analytics data may be processed outside your country or the European Economic Area. Where the law requires safeguards for an international transfer, the applicable provider terms and transfer mechanisms govern that processing.

## What the site actually loads

When you open the app at [app.sightlines.art](https://app.sightlines.art/), your browser downloads the application itself (HTML, JavaScript, stylesheets, and fonts) over HTTPS. After that, editing happens in your browser. The app never sends your project content back to us; the only outbound project data is the optional Dropbox backup described above. This site, at sightlines.art, serves static pages like this one plus the cookie-less Web Analytics beacon. The infrastructure processing Cloudflare performs to deliver and protect both sites is separate from consent-controlled analytics and never includes your project content.

## If this ever changes

Features like hosted sync, collaboration, or accounts would change this picture, and this page will be updated before any such feature ships. The date below tells you when this policy last changed.


## Questions

Sightlines is operated by Marina Molarsky-Beck, an individual based in New York, NY 10025, USA, who is the controller for the processing described here. To withdraw permission, change the reporting controls under **Settings → Storage & data**. To exercise a privacy right or ask a question, email [hello@sightlines.art](mailto:hello@sightlines.art). You may also complain to the data-protection authority where you live or work. Security reporting details are published on the [security page](/security) and at [/.well-known/security.txt](/.well-known/security.txt).

This policy was updated on July 19, 2026 to add the consent controls and describe the optional analytics they govern.
