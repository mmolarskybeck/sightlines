import type { AppState } from "../store";
import { useAppStore } from "../store";

// Defense in depth against a stale async refresh: only metadata that names the
// OPEN project counts as "this project is linked" — acting on another project's
// record would sync or unlink the wrong one. Derived in exactly one place
// because the status popover, the Settings row and the sync scheduler must
// never disagree about whether this project is linked.
export function selectLinkedSyncMeta(state: AppState) {
  const meta = state.syncMeta;
  return meta !== null && meta.projectId === state.project?.id ? meta : null;
}

/** The sync record for the open project, or null when it is not linked. */
export function useLinkedSyncMeta() {
  return useAppStore(selectLinkedSyncMeta);
}

/** Whether the open project is linked — the boolean half of the same rule. */
export function useSyncLinked(): boolean {
  return useAppStore((state) => selectLinkedSyncMeta(state) !== null);
}
