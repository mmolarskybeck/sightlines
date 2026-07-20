export type TelemetryEventMap = {
  app_opened: { appVersion: string };
  project_created: Record<never, never>;
  artwork_import_completed: {
    source: "images" | "spreadsheet" | "combined";
  };
  view_opened: { view: "plan" | "elevation" | "3d" };
  pdf_export_completed: Record<never, never>;
  package_import_completed: Record<never, never>;
  cloud_backup_connected: { provider: "dropbox" };
};

export type TelemetryEventName = keyof TelemetryEventMap;
export type TelemetryEvent = {
  [Name in TelemetryEventName]: {
    name: Name;
    properties: TelemetryEventMap[Name];
  }
}[TelemetryEventName];

const EMPTY_EVENT_NAMES = new Set<TelemetryEventName>([
  "project_created",
  "pdf_export_completed",
  "package_import_completed"
]);

function hasExpectedKeys(
  record: Record<string, unknown>,
  keys: readonly string[],
  rejectUnknownProperties: boolean
): boolean {
  const actualKeys = Object.keys(record);
  return (
    (!rejectUnknownProperties || actualKeys.length === keys.length) &&
    keys.every((key) => actualKeys.includes(key))
  );
}

export function sanitizeTelemetryEvent(
  name: unknown,
  properties: unknown,
  { rejectUnknownProperties = false }: { rejectUnknownProperties?: boolean } = {}
): TelemetryEvent | null {
  if (typeof name !== "string") return null;
  const record =
    properties && typeof properties === "object" && !Array.isArray(properties)
      ? (properties as Record<string, unknown>)
      : null;
  if (!record) return null;

  if (EMPTY_EVENT_NAMES.has(name as TelemetryEventName)) {
    return hasExpectedKeys(record, [], rejectUnknownProperties)
      ? ({ name, properties: {} } as TelemetryEvent)
      : null;
  }
  if (name === "app_opened") {
    const appVersion = record.appVersion;
    if (
      !hasExpectedKeys(record, ["appVersion"], rejectUnknownProperties) ||
      typeof appVersion !== "string" ||
      appVersion.length === 0 ||
      appVersion.length > 64 ||
      !/^[A-Za-z0-9._+-]+$/.test(appVersion)
    ) return null;
    return { name, properties: { appVersion } };
  }
  if (name === "artwork_import_completed") {
    const source = record.source;
    if (
      !hasExpectedKeys(record, ["source"], rejectUnknownProperties) ||
      (source !== "images" && source !== "spreadsheet" && source !== "combined")
    ) return null;
    return { name, properties: { source } };
  }
  if (name === "view_opened") {
    const view = record.view;
    if (
      !hasExpectedKeys(record, ["view"], rejectUnknownProperties) ||
      (view !== "plan" && view !== "elevation" && view !== "3d")
    ) return null;
    return { name, properties: { view } };
  }
  if (
    name === "cloud_backup_connected" &&
    hasExpectedKeys(record, ["provider"], rejectUnknownProperties) &&
    record.provider === "dropbox"
  ) {
    return { name, properties: { provider: "dropbox" } };
  }
  return null;
}

export function analyticsDimensions(event: TelemetryEvent): [string, string, string] {
  switch (event.name) {
    case "app_opened":
      return [event.name, "", event.properties.appVersion];
    case "artwork_import_completed":
      return [event.name, event.properties.source, ""];
    case "view_opened":
      return [event.name, event.properties.view, ""];
    case "cloud_backup_connected":
      return [event.name, event.properties.provider, ""];
    default:
      return [event.name, "", ""];
  }
}
