import packageMetadata from "../../../package.json";
import { privacyPreferenceStore, type PrivacyPreferenceStore } from "./privacyPreferences";
import { telemetry } from "./telemetry";

export function createAppOpenedTelemetry({
  appVersion,
  preferenceStore,
  track
}: {
  appVersion: string;
  preferenceStore: PrivacyPreferenceStore;
  track: (name: "app_opened", properties: { appVersion: string }) => boolean;
}) {
  let sent = false;
  const sendIfEnabled = () => {
    if (sent || !preferenceStore.getSnapshot().preferences.usageAnalytics) return;
    sent = track("app_opened", { appVersion });
  };
  return {
    start: () => {
      sendIfEnabled();
      return preferenceStore.subscribe(sendIfEnabled);
    }
  };
}

export function startAppOpenedTelemetry(): () => void {
  return createAppOpenedTelemetry({
    appVersion: packageMetadata.version,
    preferenceStore: privacyPreferenceStore,
    track: telemetry.track
  }).start();
}
