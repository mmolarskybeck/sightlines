import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPrivacyPreferenceStore } from "./privacyPreferences";
import { createAppOpenedTelemetry } from "./appOpenedTelemetry";

describe("app-opened telemetry", () => {
  beforeEach(() => window.localStorage.clear());

  it("waits for consent and sends appVersion exactly once", () => {
    const preferenceStore = createPrivacyPreferenceStore(window.localStorage);
    const track = vi.fn(() => true);
    const stop = createAppOpenedTelemetry({
      appVersion: "0.1.0",
      preferenceStore,
      track
    }).start();
    expect(track).not.toHaveBeenCalled();
    preferenceStore.set({
      decision: "accepted",
      preferences: { usageAnalytics: true, crashReports: false }
    });
    preferenceStore.set({
      decision: "accepted",
      preferences: { usageAnalytics: false, crashReports: false }
    });
    preferenceStore.set({
      decision: "accepted",
      preferences: { usageAnalytics: true, crashReports: false }
    });
    expect(track).toHaveBeenCalledTimes(1);
    expect(track).toHaveBeenCalledWith("app_opened", { appVersion: "0.1.0" });
    stop();
  });
});
