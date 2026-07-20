---
title: "Reviewing or allowlisting Sightlines"
description: "Concise network, data-flow, and security information for IT teams reviewing sightlines.art and app.sightlines.art."
kicker: "For IT teams"
lede: "Sightlines is browser-based exhibition-planning software for museums, galleries, artists, and curators. It uses two hostnames, sightlines.art and app.sightlines.art, which should be reviewed and allowlisted together."
---

## At a glance

<table>
  <tbody>
    <tr>
      <th scope="row">Allowlist</th>
      <td><code>sightlines.art</code> and <code>app.sightlines.art</code>, HTTPS on port 443</td>
    </tr>
    <tr>
      <th scope="row">Category</th>
      <td>Business / productivity / design software for the arts and culture sector</td>
    </tr>
    <tr>
      <th scope="row">Hosting</th>
      <td>Static sites delivered through Cloudflare</td>
    </tr>
    <tr>
      <th scope="row">Installation</th>
      <td>None. Sightlines runs in the browser and serves no executables or installers.</td>
    </tr>
    <tr>
      <th scope="row">Accounts</th>
      <td>None. There is no authentication or session traffic.</td>
    </tr>
    <tr>
      <th scope="row">Project storage</th>
      <td>Local-first. Projects and images are stored in the user's browser.</td>
    </tr>
  </tbody>
</table>

## Purpose and network behavior

Sightlines lets exhibition staff draw floor plans to scale, place artworks on wall elevations, and preview layouts in 3D. It is not a file-sharing service, social network, streaming site, advertising network, or download portal, and it hosts no public user content.

The browser downloads static application assets from `app.sightlines.art`. Content Security Policies restrict both Sightlines hostnames to explicit network destinations. There is no Sightlines project-upload endpoint.

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
      <td>When either site is requested</td>
      <td>Processes ordinary request metadata to route and protect traffic.</td>
    </tr>
    <tr>
      <th scope="row">Anonymous analytics</th>
      <td>On the informational site; in the app only after permission</td>
      <td>Aggregate visits, performance, and fixed product milestones. No project content or persistent Sightlines identifier.</td>
    </tr>
    <tr>
      <th scope="row">Dropbox backup</th>
      <td>Only when connected by the user</td>
      <td>Files travel directly between the browser and the user's Dropbox app folder. Sightlines receives no copy.</td>
    </tr>
  </tbody>
</table>

Sightlines does not use advertising, cross-site tracking, session replay, or personal analytics profiles. More detail is available on the [privacy page](/privacy).

## Security and recategorization

Both hostnames use HTTPS, HSTS, a restrictive Content Security Policy, framing protection, and related browser security headers. Vulnerability-reporting information is available on the [security page](/security) and at [/.well-known/security.txt](/.well-known/security.txt).

If either hostname is classified as uncategorized, parked, or newly registered, please recategorize it as business or productivity software and allowlist both hostnames together.
