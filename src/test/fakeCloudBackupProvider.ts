import type { CloudBackupProvider } from "../app/cloud/provider";

// Shared no-op defaults for the ~13-method CloudBackupProvider interface.
// Individual tests override only the methods they exercise; a test that needs
// stateful behavior (counters, a rev-conditional write, a parameterized
// status) should keep that override explicit at its call site rather than
// bending these defaults to fit one file.
const FAKE_SHARE_URL =
  "https://www.dropbox.com/scl/fi/share/project.sightlines?rlkey=test&dl=0";

export function makeFakeCloudBackupProvider(
  overrides: Partial<CloudBackupProvider> = {}
): CloudBackupProvider {
  return {
    id: "fake",
    label: "Fake",
    remotePathFor: (projectId) => `/fake/${projectId}.sightlines`,
    maxDownloadBytes: 50 * 1024 * 1024,
    async startConnect() {},
    async completeConnect() {
      return false;
    },
    disconnect() {},
    getStatus() {
      return "connected";
    },
    accountLabel() {
      return "Tester";
    },
    accountId() {
      return "dbid:tester";
    },
    async uploadBackup() {},
    async createShareLink() {
      return FAKE_SHARE_URL;
    },
    async listCloudProjects() {
      return [];
    },
    async downloadBackup() {
      return new Uint8Array();
    },
    async getSyncHead() {
      return null;
    },
    async downloadSyncHead() {
      return { bytes: new Uint8Array(), rev: "rev-1" };
    },
    async uploadSyncHead() {
      return { rev: "rev-1", serverModifiedIso: null, sizeBytes: null };
    },
    async listSyncHeads() {
      return [];
    },
    ...overrides
  };
}
