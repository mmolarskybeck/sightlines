/// <reference types="vite/client" />

interface ImportMetaEnv {
  // Dropbox App key. Unset → cloud backup is inert and hidden.
  readonly VITE_DROPBOX_CLIENT_ID?: string;
  // Cloud-backup scheduler timing overrides (ms). Optional.
  readonly VITE_CLOUD_BACKUP_SETTLE_MS?: string;
  readonly VITE_CLOUD_BACKUP_MIN_INTERVAL_MS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
