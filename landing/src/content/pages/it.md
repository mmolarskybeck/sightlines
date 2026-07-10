---
title: "Reviewing or allowlisting sightlines.art"
description: "Information for IT and network administrators reviewing or allowlisting sightlines.art: category, network behavior, and security posture."
kicker: "For IT teams"
lede: "This page is for network and IT administrators evaluating Sightlines for use on a managed network. Sightlines is professional productivity software used by museum, gallery, and exhibition staff to plan artwork layouts. A staff member at your organization has likely requested access to it."
---

## At a glance

<table>
  <tbody>
    <tr>
      <th scope="row">Hostname</th>
      <td><code>sightlines.art</code> (<code>www.sightlines.art</code> redirects here)</td>
    </tr>
    <tr>
      <th scope="row">Protocol / port</th>
      <td>HTTPS on port 443 only</td>
    </tr>
    <tr>
      <th scope="row">Category</th>
      <td>Business / productivity / design tool (arts and culture sector)</td>
    </tr>
    <tr>
      <th scope="row">Hosting</th>
      <td>Cloudflare (static assets on Cloudflare Workers)</td>
    </tr>
    <tr>
      <th scope="row">Downloads</th>
      <td>None. No executables, installers, or binaries are served.</td>
    </tr>
    <tr>
      <th scope="row">User data flow</th>
      <td>Local-only. Projects and images stay in the user's browser storage.</td>
    </tr>
  </tbody>
</table>

## What it is

Sightlines lets exhibition staff draw gallery floor plans to scale, place artworks on wall elevations, and preview the result in 3D. It's comparable in risk profile to any static documentation site: after the application files load, editing runs entirely in the browser. See the [about page](/about) for a fuller description.

It is not a file-sharing service, social network, streaming site, advertising network, gambling site, or download portal, and it hosts no user-generated public content.

## Network behavior

- The browser fetches static application assets (HTML, JS, CSS, fonts) from `sightlines.art` over HTTPS.
- The Content-Security-Policy restricts all connections to the site's own origin; no third-party requests are made.
- No user project content is transmitted over the network. There is no upload endpoint.
- No account, authentication, or session traffic exists in the current version.
- No analytics, advertising, or tracking beacons.

## Security posture

The site sets HSTS, a restrictive CSP, `X-Frame-Options: DENY`, and related hardening headers on every response. Details are on the [security page](/security), and a vulnerability-disclosure contact is published at [/.well-known/security.txt](/.well-known/security.txt) per RFC 9116.

## If the site is miscategorized

If your web filter currently classifies `sightlines.art` as uncategorized, parked, or newly registered, we'd ask that you recategorize it as business or productivity software. This page, the [about page](/about), and the [security page](/security) can serve as supporting documentation for a recategorization request with your filtering vendor.
