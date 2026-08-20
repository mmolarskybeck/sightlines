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
  cloud_project_opened: Record<never, never>;
  // Cross-device sync, count-only: how often the feature is turned on, and how
  // curators answer a whole-project conflict. Never which project, which
  // account, or anything about the content on either side.
  cloud_sync_enabled: Record<never, never>;
  cloud_sync_conflict_resolved: { choice: SyncConflictChoiceName };
};

// Mirrors cloudSyncSlice's SyncConflictChoice. Duplicated rather than imported
// because this contract is shared with the analytics worker, which must not
// pull the app's store graph into its bundle.
export type SyncConflictChoiceName =
  | "use-dropbox"
  | "keep-mine"
  | "keep-both"
  | "not-now";

const SYNC_CONFLICT_CHOICES: readonly SyncConflictChoiceName[] = [
  "use-dropbox",
  "keep-mine",
  "keep-both",
  "not-now"
];

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
  "package_import_completed",
  "cloud_project_opened",
  "cloud_sync_enabled"
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
  if (name === "cloud_sync_conflict_resolved") {
    const choice = record.choice;
    if (
      !hasExpectedKeys(record, ["choice"], rejectUnknownProperties) ||
      typeof choice !== "string" ||
      !SYNC_CONFLICT_CHOICES.includes(choice as SyncConflictChoiceName)
    ) return null;
    return { name, properties: { choice: choice as SyncConflictChoiceName } };
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
    case "cloud_sync_conflict_resolved":
      return [event.name, event.properties.choice, ""];
    default:
      return [event.name, "", ""];
  }
}
