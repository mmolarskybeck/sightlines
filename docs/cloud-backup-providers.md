# Cloud Backup Providers — approval landscape and rollout

Notes for the roadmap item "additional cloud services" (first provider: Dropbox, shipped from plan 2026-07-19). Compiled 2026-07-19.

**Current status (2026-07-19):** Dropbox shipped — now in **technical-pilot** stage. Phase 0 spike passed and is now retired (`public/dropbox-spike.html` deleted, its redirect URI removed from the Dropbox app). Callback path `/auth/dropbox/callback` (exact-match redirect URIs registered for `https://app.sightlines.art`, the Vercel mirror, and localhost dev); App Folder access only; scopes `account_info.read`, `files.metadata.read`, `files.content.write` — no chooser/saver/embedder domains or webhooks.

**Deployment note:** OAuth redirect URIs are exact-match per origin. The Dropbox app must list every origin the app is served from — currently `https://app.sightlines.art/`, the temporary Vercel mirror `https://sightlines-three.vercel.app/` (corporate-firewall workaround while the domain is <30 days old; no CSP applies there since `public/_headers` is Cloudflare-only), and `http://localhost:5173/` for dev. Browser storage is per-origin, but backups from all origins land in the same Dropbox app folder — cloud backup is the bridge between origins and the migration path when the mirror is retired (~Aug 2026).


There are really three different "approval" layers, and the providers emphasize different ones:

1. Provider review of your application.
2. OAuth verification/branding—proving Sightlines is who it says it is.
3. A museum's own IT administrator deciding whether employees may connect it.

Dropbox emphasizes #1. Google emphasizes #2. Microsoft and Box make #3 especially important.

| Provider | Pilot stage | Public rollout gate | Browser-only background access | Institutional friction |
|---|---|---|---|---|
| Dropbox | Development app; initially your account, then additional users | At 50 lifetime linked users, a two-week production-approval clock begins; development apps otherwise cap at 500 links | Technically promising, but Dropbox's OAuth guidance for pure-JS apps still needs a prototype | Usually relatively low with App Folder access |
| Google Drive | External Testing; up to 100 named test users | Publish and complete OAuth verification appropriate to the requested scopes | Durable refresh-token flows are designed around backend exchange/storage | Workspace admins can still block verified apps |
| OneDrive | App registration can serve personal and organizational accounts | No Dropbox-style user-count review; publisher verification is the trust gate | SPA refresh tokens expire after 24 hours, requiring renewed top-level authorization | Potentially high in managed Microsoft 365 tenants |
| Box | Developer app | Often organization-by-organization enablement | Possible, but enterprise administration dominates | High; frequently requires a Box administrator |
| iCloud | CloudKit development container | Promote an app-owned CloudKit schema to production | CloudKit JS exists | Not a normal user-visible iCloud Drive backup integration |

### What Dropbox production approval means

A Dropbox app starts in development status. You can enable additional users and operate normally while testing.

The important thresholds are:

- Maximum 500 linked Dropbox accounts while in development.
- Once the app reaches 50 linked accounts, Dropbox gives you two weeks to apply for and receive production approval.
- If approval is not completed, existing integrations are not described as being disabled; the app is frozen from linking additional users.
- Unlinking users does not reset the situation.
- Dropbox usually waits until approximately 50 users to review, although it accepts requests for early review when there is a compelling reason. [Dropbox production-approval documentation](https://www.dropbox.com/developers/reference/developer-guide)

This is not an App Store review of Sightlines as a whole. Dropbox primarily checks:

- What the integration does.
- Whether requested permissions are proportionate.
- Whether branding and consent are clear.
- Whether the privacy policy accurately describes Dropbox data use.
- Whether the app complies with Dropbox's platform terms.

For Sightlines, requesting App Folder access is a strong approval posture because Sightlines cannot inspect the rest of someone's Dropbox.

The one awkward feature of Dropbox's system is the deadline: you cannot treat user 50 as the moment to start preparing. Everything—privacy language, app icon, domain, screenshots, flow explanation, support contact, and scope justification—should already be ready.

### A sensible Dropbox rollout

1. **Technical pilot: 1–3 accounts** — Your Dropbox account plus a couple of controlled test accounts. Prove OAuth, refresh, Safari behavior, large uploads, pruning, revoked access, and reconnection after local storage is cleared.
2. **Curator-friends pilot: roughly 5–20 accounts** — Keep the app in development. This is comfortably below the threshold and gives enough real-world evidence about institutional Dropbox accounts and network filtering.
3. **Production preparation: before 30–40 links** — Finalize the public privacy/security language, Dropbox branding, support contact, permission rationale, and a short demonstration of the integration.
4. **Approval submission** — Request early review if Dropbox accepts the data-safety rationale. Otherwise, be ready to submit immediately when the app reaches 50 links.

"Linked users" should be treated as a cumulative adoption count, not monthly active users. So even a quiet rollout can eventually reach the threshold.

### How Google Drive differs

Google does not use Dropbox's 50-user production trigger.

An external OAuth app in Testing can have up to 100 named test users. More importantly for automatic backup, refresh tokens issued while the app remains in Testing generally expire after seven days. [Google OAuth application states](https://developers.google.com/identity/protocols/oauth2/production-readiness/overview), [Google refresh-token behavior](https://developers.google.com/identity/protocols/oauth2)

For Sightlines, two scopes are relevant:

- `drive.appdata`: hidden application data. Least intrusive, but users cannot conveniently see or retrieve their backup in normal Drive UI.
- `drive.file`: lets Sightlines create and manage files it created or that the user explicitly opened/shared with it. This can support a visible "Sightlines Backups" folder.

Both are currently categorized as non-sensitive scopes, requiring the simpler/basic form of OAuth verification rather than restricted-scope security assessment. Broad access to all Drive files would be restricted and should be avoided. [Google Drive scope classifications](https://developers.google.com/workspace/drive/api/guides/api-specific-auth)

The larger architectural difference is token handling. Google's supported web code model expects a backend to exchange the authorization code and securely store the refresh token. [Google Identity Services code model](https://developers.google.com/identity/oauth2/web/guides/use-code-model)

So Google Drive is likely feasible with the proposed stateless Worker exchange, but returning and storing the refresh token in browser JavaScript is not Google's documented preferred model. That deserves its own security/approval check.

Google Workspace administrators can also block an app regardless of Google verification. Verification makes Sightlines credible; it does not override museum IT policy.

### How OneDrive differs

Microsoft does not document a Dropbox-style "reach N users, then apply for production" process. You register Sightlines in Microsoft Entra, choose whether it supports personal accounts, organizational accounts, or both, and configure its permissions.

The closest equivalent to public approval is **publisher verification**:

- It adds Microsoft's verified-publisher badge.
- It requires a verified Microsoft AI Cloud Partner Program identity.
- It matters strongly for multitenant organizational apps.
- Many organizations restrict user consent to verified publishers or require administrator approval. [Microsoft publisher verification](https://learn.microsoft.com/en-us/entra/identity-platform/publisher-verification-overview), [Microsoft tenant consent controls](https://learn.microsoft.com/en-us/entra/identity/enterprise-apps/configure-user-consent)

OneDrive has a very appealing least-privilege permission, `Files.ReadWrite.AppFolder`. It confines the application to its own folder, works with personal Microsoft accounts, and does not require administrator consent as a delegated permission. However, Microsoft's current permissions reference still labels the delegated permission as preview, which makes it a less settled production foundation than Dropbox App Folder. [OneDrive App Folder](https://learn.microsoft.com/en-us/graph/onedrive-sharepoint-appfolder), [Microsoft Graph permission reference](https://learn.microsoft.com/en-us/graph/permissions-reference)

Microsoft supports SPA authorization-code flow with PKCE directly, but SPA refresh tokens have a 24-hour absolute lifetime. After that, the browser must revisit Microsoft authorization in a top-level frame. The user may not need to type credentials, but Sightlines must be prepared for reauthorization. [Microsoft refresh-token lifetimes](https://learn.microsoft.com/en-us/entra/identity-platform/refresh-tokens)

### Other providers

Box is primarily enterprise-oriented. Unpublished OAuth applications may need to be enabled by each customer's Box administrator, and its app-approval flow is centered on enterprise admins. That makes it a reasonable future institutional request, but a poor general second provider. [Box platform app approval](https://developer.box.com/guides/authorization/platform-app-approval)

iCloud is not really comparable. CloudKit JS stores data in a Sightlines-owned CloudKit container; it does not simply write a visible `.sightlines` file into a user-selected iCloud Drive folder. That would move Sightlines toward operating a cloud data service rather than sending backups to a user-controlled file provider. [Apple CloudKit JS](https://developer.apple.com/documentation/CloudKitJS)

### Recommendation

Dropbox remains the best first provider for Sightlines:

- Visible, user-owned backup files.
- Mature App Folder permissions.
- A manageable friends-and-curators pilot before approval.
- The strongest prospect of durable browser-only authorization, subject to the planned technical spike.

Build the provider seam, launch Dropbox, and let actual user demand decide whether Drive or OneDrive comes second. For future providers, the seam should explicitly represent `connected`, `reauthorizationRequired`, and `lastSuccessfulBackup`; "connected" alone is not enough when Google testing tokens expire after seven days or Microsoft SPA authorization must renew after 24 hours.
