import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_PRIVACY_PREFERENCE_STATE,
  PRIVACY_PREFERENCES_STORAGE_KEY,
  createPrivacyPreferenceStore,
  readPrivacyPreferences
} from "./privacyPreferences";

describe("privacy preferences", () => {
  beforeEach(() => window.localStorage.clear());

  it("defaults to consent-first settings", () => {
    expect(readPrivacyPreferences()).toEqual(DEFAULT_PRIVACY_PREFERENCE_STATE);
  });

  it("sanitizes partial and malformed stored records", () => {
    window.localStorage.setItem(
      PRIVACY_PREFERENCES_STORAGE_KEY,
      JSON.stringify({ decision: "accepted", preferences: { usageAnalytics: true, crashReports: "yes" } })
    );
    expect(readPrivacyPreferences()).toEqual({
      decision: "accepted",
      preferences: { usageAnalytics: true, crashReports: false }
    });

    window.localStorage.setItem(PRIVACY_PREFERENCES_STORAGE_KEY, "{bad json");
    expect(readPrivacyPreferences()).toEqual(DEFAULT_PRIVACY_PREFERENCE_STATE);
  });

  it("never restores enabled reporting without a recorded decision", () => {
    window.localStorage.setItem(
      PRIVACY_PREFERENCES_STORAGE_KEY,
      JSON.stringify({
        decision: "unset",
        preferences: { usageAnalytics: true, crashReports: true }
      })
    );
    expect(readPrivacyPreferences()).toEqual(DEFAULT_PRIVACY_PREFERENCE_STATE);
  });

  it("persists changes and notifies same-page subscribers", () => {
    const store = createPrivacyPreferenceStore(window.localStorage);
    const listener = vi.fn();
    store.subscribe(listener);

    expect(store.set({ decision: "accepted", preferences: { usageAnalytics: false, crashReports: true } })).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(JSON.parse(window.localStorage.getItem(PRIVACY_PREFERENCES_STORAGE_KEY)!)).toEqual(
      store.getSnapshot()
    );
  });

  it("fails closed when an enabling preference cannot be persisted", () => {
    const storage = {
      getItem: vi.fn(() => null),
      setItem: vi.fn(() => { throw new Error("full"); })
    };
    const store = createPrivacyPreferenceStore(storage);

    expect(store.set({ decision: "accepted", preferences: { usageAnalytics: true, crashReports: true } })).toBe(false);
    expect(store.getSnapshot()).toEqual(DEFAULT_PRIVACY_PREFERENCE_STATE);
  });

  it("turns reporting off in memory even when the disabling write fails", () => {
    let fail = false;
    const storage = {
      getItem: vi.fn(() => null),
      setItem: vi.fn(() => { if (fail) throw new Error("full"); })
    };
    const store = createPrivacyPreferenceStore(storage);
    expect(store.set({ decision: "accepted", preferences: { usageAnalytics: true, crashReports: true } })).toBe(true);
    fail = true;
    expect(store.set({ decision: "accepted", preferences: { usageAnalytics: false, crashReports: false } })).toBe(false);
    expect(store.getSnapshot().preferences).toEqual({ usageAnalytics: false, crashReports: false });
  });
});
