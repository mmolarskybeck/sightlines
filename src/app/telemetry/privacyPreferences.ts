import { useSyncExternalStore } from "react";

export const PRIVACY_PREFERENCES_STORAGE_KEY =
  "sightlines.privacyPreferences.v1";

export type PrivacyDecision = "unset" | "accepted" | "declined";

export type PrivacyPreferences = {
  usageAnalytics: boolean;
  crashReports: boolean;
};

export type PrivacyPreferenceState = {
  decision: PrivacyDecision;
  preferences: PrivacyPreferences;
};

export const DEFAULT_PRIVACY_PREFERENCE_STATE: PrivacyPreferenceState = {
  decision: "unset",
  preferences: {
    usageAnalytics: false,
    crashReports: false
  }
};

type PrivacyPreferenceStorage = Pick<Storage, "getItem" | "setItem">;

export function sanitizePrivacyPreferences(value: unknown): PrivacyPreferenceState {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return structuredClone(DEFAULT_PRIVACY_PREFERENCE_STATE);
  }

  const record = value as Record<string, unknown>;
  const rawPreferences =
    record.preferences && typeof record.preferences === "object" && !Array.isArray(record.preferences)
      ? record.preferences as Record<string, unknown>
      : record;
  const decision: PrivacyDecision =
    record.decision === "accepted" || record.decision === "declined"
      ? record.decision
      : "unset";
  return {
    decision,
    preferences: {
      usageAnalytics:
        decision !== "unset" && typeof rawPreferences.usageAnalytics === "boolean"
          ? rawPreferences.usageAnalytics
          : false,
      crashReports:
        decision !== "unset" && typeof rawPreferences.crashReports === "boolean"
          ? rawPreferences.crashReports
          : false
    }
  };
}

export function readPrivacyPreferences(
  storage: PrivacyPreferenceStorage | undefined = getBrowserStorage()
): PrivacyPreferenceState {
  if (!storage) return structuredClone(DEFAULT_PRIVACY_PREFERENCE_STATE);
  try {
    const raw = storage.getItem(PRIVACY_PREFERENCES_STORAGE_KEY);
    return raw
      ? sanitizePrivacyPreferences(JSON.parse(raw) as unknown)
      : structuredClone(DEFAULT_PRIVACY_PREFERENCE_STATE);
  } catch {
    return structuredClone(DEFAULT_PRIVACY_PREFERENCE_STATE);
  }
}

function getBrowserStorage(): PrivacyPreferenceStorage | undefined {
  return typeof window === "undefined" ? undefined : window.localStorage;
}

export type PrivacyPreferenceStore = {
  getSnapshot: () => PrivacyPreferenceState;
  subscribe: (listener: () => void) => () => void;
  set: (state: PrivacyPreferenceState) => boolean;
  update: (
    update: (current: PrivacyPreferenceState) => PrivacyPreferenceState
  ) => boolean;
};

export function createPrivacyPreferenceStore(
  storage: PrivacyPreferenceStorage | undefined = getBrowserStorage()
): PrivacyPreferenceStore {
  let current = readPrivacyPreferences(storage);
  const listeners = new Set<() => void>();

  const set = (state: PrivacyPreferenceState): boolean => {
    const next = sanitizePrivacyPreferences(state);
    if (
      next.decision === current.decision &&
      next.preferences.usageAnalytics === current.preferences.usageAnalytics &&
      next.preferences.crashReports === current.preferences.crashReports
    ) {
      return true;
    }

    try {
      if (!storage) throw new Error("Browser storage is unavailable");
      storage.setItem(PRIVACY_PREFERENCES_STORAGE_KEY, JSON.stringify(next));
      current = next;
    } catch {
      // Fail closed: a failed write may turn reporting off for this session,
      // but can never turn either category on or dismiss an unset notice.
      current = {
        decision: current.decision,
        preferences: {
          usageAnalytics:
            current.preferences.usageAnalytics && next.preferences.usageAnalytics,
          crashReports:
            current.preferences.crashReports && next.preferences.crashReports
        }
      };
      listeners.forEach((listener) => listener());
      return false;
    }
    listeners.forEach((listener) => listener());
    return true;
  };

  return {
    getSnapshot: () => current,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    set,
    update: (update) => set(update(current))
  };
}

export const privacyPreferenceStore = createPrivacyPreferenceStore();

export function usePrivacyPreferences() {
  const state = useSyncExternalStore(
    privacyPreferenceStore.subscribe,
    privacyPreferenceStore.getSnapshot,
    privacyPreferenceStore.getSnapshot
  );
  return {
    decision: state.decision,
    preferences: state.preferences,
    setPreferences: (
      preferences: PrivacyPreferences,
      decision: PrivacyDecision = state.decision
    ) => privacyPreferenceStore.set({ decision, preferences })
  };
}
