import {
  privacyPreferenceStore,
  type PrivacyPreferenceState
} from "./privacyPreferences";
import {
  sanitizeTelemetryEvent,
  type TelemetryEvent,
  type TelemetryEventMap,
  type TelemetryEventName
} from "../../telemetry/eventContract";

export type { TelemetryEvent, TelemetryEventMap, TelemetryEventName };

export type TelemetryTransport = (event: TelemetryEvent) => void | Promise<void>;

export function createFirstPartyAnalyticsTransport({
  productionBuild,
  hostname,
  fetch
}: {
  productionBuild: boolean;
  hostname: string;
  fetch: typeof globalThis.fetch;
}): TelemetryTransport {
  if (!productionBuild || hostname !== "app.sightlines.art") return () => {};
  return (event) => {
    void fetch("/api/analytics", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(event),
      credentials: "omit",
      referrerPolicy: "no-referrer",
      keepalive: true
    }).catch(() => {});
  };
}

type TelemetryGatewayOptions = {
  getPreferences: () => PrivacyPreferenceState;
  transport?: TelemetryTransport;
};

export function createTelemetryGateway({
  getPreferences,
  transport = () => {}
}: TelemetryGatewayOptions) {
  return {
    track<Name extends TelemetryEventName>(
      name: Name,
      properties: TelemetryEventMap[Name]
    ): boolean {
      if (!getPreferences().preferences.usageAnalytics) return false;
      const event = sanitizeTelemetryEvent(name, properties);
      if (!event) return false;
      try {
        void Promise.resolve(transport(event)).catch(() => {});
        return true;
      } catch {
        return false;
      }
    }
  };
}

export const telemetry = createTelemetryGateway({
  getPreferences: privacyPreferenceStore.getSnapshot,
  transport:
    typeof window === "undefined"
      ? undefined
      : createFirstPartyAnalyticsTransport({
          productionBuild: import.meta.env.PROD,
          hostname: window.location.hostname,
          fetch: window.fetch.bind(window)
        })
});
