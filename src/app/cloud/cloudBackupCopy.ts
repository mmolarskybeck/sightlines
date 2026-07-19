// Shared, pure copy helpers for the cloud-backup UI surfaces (the save-status
// popover and the Settings block), so the two never drift and the relative-time
// wording is unit-testable.

import type { CloudBackupProviderStatus } from "./provider";

// A terse relative time for a backup timestamp: "just now", "2 m ago",
// "3 h ago", "5 d ago". Matches the quiet, glanceable register of the popover.
export function formatBackupRelativeTime(
  iso: string,
  now: number = Date.now()
): string {
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return "recently";
  const deltaMs = Math.max(0, now - then);
  const minutes = Math.floor(deltaMs / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  return `${days} d ago`;
}

// The single quiet line for the save-status popover. Returns null when the
// feature is unconfigured (nothing to show). Mirrors the four states the plan
// calls for.
export function getCloudBackupPopoverLine(input: {
  configured: boolean;
  status: CloudBackupProviderStatus;
  lastCloudBackupAt: string | null;
  pending: boolean;
  now?: number;
}): string | null {
  if (!input.configured) return null;
  if (input.status === "reauthorization-required") {
    return "Reconnect Dropbox to resume backups.";
  }
  if (input.status === "disconnected") {
    return "Cloud backup off — connect in Storage settings.";
  }
  // connected
  if (input.pending) return "Changes waiting to back up.";
  if (input.lastCloudBackupAt) {
    return `Backed up to Dropbox ${formatBackupRelativeTime(
      input.lastCloudBackupAt,
      input.now
    )}.`;
  }
  return "Cloud backup on — waiting for the first backup.";
}
