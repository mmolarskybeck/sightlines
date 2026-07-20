---
title: "Reviewing or allowlisting sightlines.art and app.sightlines.art"
description: "Information for IT and network administrators reviewing or allowlisting sightlines.art and app.sightlines.art: category, network behavior, and security posture."
kicker: "For IT teams"
lede: "This page is for network and IT administrators evaluating Sightlines for use on a managed network. Sightlines is professional productivity software used by museum, gallery, and exhibition staff to plan artwork layouts. A staff member at your organization has likely requested access to it. Sightlines spans two hostnames, sightlines.art and app.sightlines.art, and both should be reviewed and allowlisted together."
---

## At a glance

<table>
  <tbody>
    <tr>
      <th scope="row">Hostnames</th>
      <td>
        <code>sightlines.art</code> — this informational site<br />
        <code>app.sightlines.art</code> — the application<br />
        <code>www.sightlines.art</code> — redirects to <code>sightlines.art</code>
      </td>
    </tr>
    <tr>
      <th scope="row">Protocol / port</th>
      <td>HTTPS on port 443 only, on both hostnames</td>
    </tr>
    <tr>
      <th scope="row">Category</th>
      <td>Business / productivity / design tool (arts and culture sector)</td>
    </tr>
    <tr>
      <th scope="row">Hosting</th>
      <td>Cloudflare (static assets on Cloudflare Workers, both hostnames)</td>
    </tr>
    <tr>
      <th scope="row">Downloads</th>
      <td>None. No executables, installers, or binaries are served from either hostname.</td>
    </tr>
    <tr>
      <th scope="row">User data flow</th>
      <td>Local-first. Projects and images stay in the user's browser storage; optional anonymous reporting excludes that content.</td>
    </tr>
  </tbody>
</table>

## What it is

Sightlines lets exhibition staff draw gallery floor plans to scale, place artworks on wall elevations, and preview the result in 3D. Editing and project storage run in the browser; optional, consent-gated analytics report only aggregate product and performance data. See the [about page](/about) for a fuller description.

It is not a file-sharing service, social network, streaming site, advertising network, gambling site, or download portal, and it hosts no user-generated public content.

## Network behavior

- The browser fetches application assets (HTML, JS, CSS, fonts) from `app.sightlines.art` over HTTPS. This informational site's pages are served separately from `sightlines.art`.
- Each origin's Content-Security-Policy restricts connections to an explicit allowlist. Beyond its own origin, the application permits only the Cloudflare Web Analytics beacon (loaded after consent), its same-origin product-event endpoint, and the Dropbox API endpoints used by optional cloud backup.
- No user project content is sent to Sightlines. There is no Sightlines project-upload endpoint on either hostname.
- No account, authentication, or session traffic exists in the current version, on either hostname.
- No advertising, cross-site tracking, session replay, or personal analytics profiles. Optional usage analytics is off until the user permits it.

## Data flows

<table>
  <thead>
    <tr>
      <th scope="col">Service</th>
      <th scope="col">When used</th>
      <th scope="col">Data boundary</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <th scope="row">Cloudflare delivery and security</th>
      <td>Necessary when either site is requested</td>
      <td>Cloudflare processes ordinary request metadata, including IP addresses, to route and protect traffic. This is infrastructure processing, not optional product analytics.</td>
    </tr>
    <tr>
      <th scope="row">Cloudflare Web Analytics</th>
      <td>Only after Anonymous usage analytics is enabled</td>
      <td>Visits, coarse browser/device categories, and page-performance measurements; no project or artwork content and no persistent Sightlines analytics identifier.</td>
    </tr>
    <tr>
      <th scope="row">Sightlines product events</th>
      <td>Only after Anonymous usage analytics is enabled</td>
      <td>Predefined successful outcomes sent to a same-origin Worker and stored in Cloudflare Analytics Engine. Sightlines does not write IP address, user agent, referrer, or project content to this dataset.</td>
    </tr>
    <tr>
      <th scope="row">Dropbox app-folder backup</th>
      <td>Only after the user connects Dropbox</td>
      <td>Project backups move directly between the browser and the user's Dropbox app folder; Sightlines does not receive a copy.</td>
    </tr>
    <tr>
      <th scope="row">Crash reporting</th>
      <td>Not active</td>
      <td>The app includes a separate local preference, but Sentry is deferred and no crash-reporting provider currently receives reports.</td>
    </tr>
  </tbody>
</table>

## Security posture

Both hostnames set HSTS, a restrictive CSP, `X-Frame-Options: DENY`, and related hardening headers on every response. Details are on the [security page](/security), and a vulnerability-disclosure contact is published at [/.well-known/security.txt](/.well-known/security.txt) per RFC 9116.

## If the site is miscategorized

If your web filter currently classifies `sightlines.art` or `app.sightlines.art` as uncategorized, parked, or newly registered, we'd ask that you recategorize both as business or productivity software. This page, the [about page](/about), and the [security page](/security) can serve as supporting documentation for a recategorization request with your filtering vendor.
