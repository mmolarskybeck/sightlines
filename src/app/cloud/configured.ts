// Whether a Dropbox app key was compiled into this build. A build-time
// constant, not state: a build without the key must offer no cloud affordance
// anywhere, so every surface that hides one reads this same value rather than
// re-deriving it from the environment.
export const CLOUD_BACKUP_CONFIGURED = Boolean(import.meta.env.VITE_DROPBOX_CLIENT_ID);
