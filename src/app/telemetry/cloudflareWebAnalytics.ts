import {
  privacyPreferenceStore,
  type PrivacyPreferenceStore
} from "./privacyPreferences";

const CLOUDFLARE_BEACON_URL =
  "https://static.cloudflareinsights.com/beacon.min.js";
const CLOUDFLARE_WEB_ANALYTICS_TOKEN =
  "921e0069e17642f481277baaf118a59f";
const PRODUCTION_HOSTNAME = "app.sightlines.art";
const SCRIPT_ID = "sightlines-cloudflare-web-analytics";

type CloudflareWebAnalyticsOptions = {
  preferenceStore: PrivacyPreferenceStore;
  document: Document;
  hostname: string;
  productionBuild: boolean;
  reload: () => void;
};

export function createCloudflareWebAnalyticsLoader({
  preferenceStore,
  document,
  hostname,
  productionBuild,
  reload
}: CloudflareWebAnalyticsOptions) {
  let scriptWasInserted = false;

  const removeScript = () => {
    document.getElementById(SCRIPT_ID)?.remove();
  };

  const insertScript = () => {
    if (scriptWasInserted || document.getElementById(SCRIPT_ID)) return;
    const script = document.createElement("script");
    script.id = SCRIPT_ID;
    script.type = "module";
    script.src = CLOUDFLARE_BEACON_URL;
    script.dataset.cfBeacon = JSON.stringify({
      token: CLOUDFLARE_WEB_ANALYTICS_TOKEN
    });
    document.body.append(script);
    scriptWasInserted = true;
  };

  const start = (): (() => void) => {
    // A production Vite build can also be deployed to a preview hostname. Both
    // checks are required so preview, local, and test sessions stay inert.
    if (!productionBuild || hostname !== PRODUCTION_HOSTNAME) return () => {};

    let usageEnabled =
      preferenceStore.getSnapshot().preferences.usageAnalytics;
    if (usageEnabled) insertScript();

    return preferenceStore.subscribe(() => {
      const nextEnabled =
        preferenceStore.getSnapshot().preferences.usageAnalytics;
      if (nextEnabled === usageEnabled) return;
      usageEnabled = nextEnabled;

      if (nextEnabled) {
        insertScript();
      } else if (scriptWasInserted) {
        // Cloudflare exposes no supported unload API. The preference store
        // persists before notifying subscribers, so reload into the disabled
        // state to guarantee its lifecycle listeners cannot send again.
        removeScript();
        reload();
      }
    });
  };

  return { start };
}

export function startCloudflareWebAnalytics(): () => void {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return () => {};
  }
  return createCloudflareWebAnalyticsLoader({
    preferenceStore: privacyPreferenceStore,
    document,
    hostname: window.location.hostname,
    productionBuild: import.meta.env.PROD,
    reload: () => window.location.reload()
  }).start();
}
