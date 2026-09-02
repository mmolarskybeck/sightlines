import { useAppStore } from "../../store";

export type CloudAction = "backup-now" | "reconnect" | "retry" | "setup";

// The status popover's Dropbox row and the Export menu's cloud item share one
// action router so the two surfaces can't route the same intent differently.
// The router lives here, not in either surface, so splitting them apart cannot
// quietly fork it.
export function useCloudActions({ onOpenSettings }: { onOpenSettings: () => void }) {
  const connectCloudBackup = useAppStore((state) => state.connectCloudBackup);
  const runCloudBackupNow = useAppStore((state) => state.runCloudBackupNow);

  const runCloudAction = (action: CloudAction) => {
    if (action === "reconnect") {
      void connectCloudBackup();
    } else if (action === "setup") {
      onOpenSettings();
    } else {
      void runCloudBackupNow();
    }
  };

  return { runCloudAction };
}
