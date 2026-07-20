import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPrivacyPreferenceStore } from "./privacyPreferences";
import { createCloudflareWebAnalyticsLoader } from "./cloudflareWebAnalytics";

const SCRIPT_SELECTOR = "#sightlines-cloudflare-web-analytics";

function createHarness({ productionBuild = true, hostname = "app.sightlines.art" } = {}) {
  const preferenceStore = createPrivacyPreferenceStore(window.localStorage);
  const reload = vi.fn();
  const loader = createCloudflareWebAnalyticsLoader({
    preferenceStore,
    document,
    hostname,
    productionBuild,
    reload
  });
  return { preferenceStore, reload, stop: loader.start() };
}

describe("Cloudflare Web Analytics loader", () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.querySelector(SCRIPT_SELECTOR)?.remove();
  });

  it("does not load before consent", () => {
    const { stop } = createHarness();
    expect(document.querySelector(SCRIPT_SELECTOR)).toBeNull();
    stop();
  });

  it.each([
    { productionBuild: false, hostname: "app.sightlines.art" },
    { productionBuild: true, hostname: "preview.sightlines.art" },
    { productionBuild: true, hostname: "localhost" }
  ])("stays inert outside the production app origin", ({ productionBuild, hostname }) => {
    const preferenceStore = createPrivacyPreferenceStore(window.localStorage);
    preferenceStore.set({
      decision: "accepted",
      preferences: { usageAnalytics: true, crashReports: false }
    });
    const reload = vi.fn();
    const stop = createCloudflareWebAnalyticsLoader({
      preferenceStore,
      document,
      hostname,
      productionBuild,
      reload
    }).start();
    expect(document.querySelector(SCRIPT_SELECTOR)).toBeNull();
    expect(reload).not.toHaveBeenCalled();
    stop();
  });

  it("loads the official manual beacon only after usage consent", () => {
    const { preferenceStore, stop } = createHarness();
    preferenceStore.set({
      decision: "accepted",
      preferences: { usageAnalytics: true, crashReports: false }
    });

    const script = document.querySelector<HTMLScriptElement>(SCRIPT_SELECTOR);
    expect(script?.type).toBe("module");
    expect(script?.src).toBe("https://static.cloudflareinsights.com/beacon.min.js");
    expect(JSON.parse(script?.dataset.cfBeacon ?? "{}")).toEqual({
      token: "921e0069e17642f481277baaf118a59f"
    });
    stop();
  });

  it("reloads after a persisted opt-out to stop an initialized beacon", () => {
    const { preferenceStore, reload, stop } = createHarness();
    preferenceStore.set({
      decision: "accepted",
      preferences: { usageAnalytics: true, crashReports: false }
    });
    expect(document.querySelector(SCRIPT_SELECTOR)).not.toBeNull();

    preferenceStore.set({
      decision: "accepted",
      preferences: { usageAnalytics: false, crashReports: false }
    });
    expect(document.querySelector(SCRIPT_SELECTOR)).toBeNull();
    expect(reload).toHaveBeenCalledTimes(1);
    expect(preferenceStore.getSnapshot().preferences.usageAnalytics).toBe(false);
    stop();
  });
});
