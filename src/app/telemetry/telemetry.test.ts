import { describe, expect, it, vi } from "vitest";
import type { PrivacyPreferenceState } from "./privacyPreferences";
import { createFirstPartyAnalyticsTransport, createTelemetryGateway } from "./telemetry";

const enabled: PrivacyPreferenceState = {
  decision: "accepted",
  preferences: { usageAnalytics: true, crashReports: false }
};

describe("telemetry gateway", () => {
  it("does not dispatch before consent or when usage reporting is disabled", () => {
    let preferences: PrivacyPreferenceState = { ...enabled, preferences: { ...enabled.preferences, usageAnalytics: false } };
    const transport = vi.fn();
    const gateway = createTelemetryGateway({ getPreferences: () => preferences, transport });

    expect(gateway.track("project_created", {})).toBe(false);
    preferences = enabled;
    expect(gateway.track("project_created", {})).toBe(true);
    preferences = { ...enabled, preferences: { usageAnalytics: false, crashReports: true } };
    expect(gateway.track("project_created", {})).toBe(false);
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it("keeps only allowlisted fields", () => {
    const transport = vi.fn();
    const gateway = createTelemetryGateway({ getPreferences: () => enabled, transport });

    gateway.track("view_opened", { view: "3d", projectTitle: "Secret" } as never);
    expect(transport).toHaveBeenCalledWith({ name: "view_opened", properties: { view: "3d" } });
    expect(JSON.stringify(transport.mock.calls)).not.toContain("Secret");
  });

  it("drops invalid event values at runtime", () => {
    const transport = vi.fn();
    const gateway = createTelemetryGateway({ getPreferences: () => enabled, transport });

    expect(gateway.track("view_opened", { view: "gallery" } as never)).toBe(false);
    expect(gateway.track("app_opened", { appVersion: "private title" })).toBe(false);
    expect(transport).not.toHaveBeenCalled();
  });

  it("contains transport failures", async () => {
    const gateway = createTelemetryGateway({
      getPreferences: () => enabled,
      transport: async () => { throw new Error("offline"); }
    });
    expect(gateway.track("pdf_export_completed", {})).toBe(true);
    await Promise.resolve();
  });
});

describe("first-party analytics transport", () => {
  it.each([
    { productionBuild: false, hostname: "app.sightlines.art" },
    { productionBuild: true, hostname: "preview.sightlines.art" },
    { productionBuild: true, hostname: "localhost" }
  ])("is inert outside the exact production app", async (environment) => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    const transport = createFirstPartyAnalyticsTransport({ ...environment, fetch });
    await transport({ name: "project_created", properties: {} });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("posts once without retries or extra metadata", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockRejectedValue(new Error("offline"));
    const transport = createFirstPartyAnalyticsTransport({
      productionBuild: true,
      hostname: "app.sightlines.art",
      fetch
    });
    await transport({ name: "view_opened", properties: { view: "3d" } });
    await Promise.resolve();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith("/api/analytics", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "view_opened", properties: { view: "3d" } }),
      credentials: "omit",
      referrerPolicy: "no-referrer",
      keepalive: true
    });
  });
});
