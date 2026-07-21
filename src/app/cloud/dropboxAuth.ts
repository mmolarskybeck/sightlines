// Pure, browser-crypto helpers for the Dropbox provider — extracted so the
// PKCE math, path construction, retention selection, and error classification
// can be unit-tested without a live fetch or DOM. dropbox.ts wires these to
// localStorage/sessionStorage/fetch and the redirect.
//
// The flows here mirror the verified Phase 0 spike (public/dropbox-spike.html):
// full-page PKCE redirect with token_access_type=offline, refresh via a direct
// POST carrying only client_id (no secret).

export const DROPBOX_AUTHORIZE_URL = "https://www.dropbox.com/oauth2/authorize";
export const DROPBOX_TOKEN_URL = "https://api.dropboxapi.com/oauth2/token";
export const DROPBOX_API_URL = "https://api.dropboxapi.com";
export const DROPBOX_CONTENT_URL = "https://content.dropboxapi.com";

// account_info.read (display name), files.content.write (upload),
// files.metadata.read (list for retention). files.content.read is not needed.
export const DROPBOX_SCOPES =
  "account_info.read files.content.write files.metadata.read";

// Retention: keep this many newest backups per project; older ones are pruned.
export const CLOUD_BACKUPS_PER_PROJECT = 5;

// Dropbox's single-shot /files/upload tops out at 150 MB; stay comfortably
// under it and switch to a chunked upload session past this size.
export const DROPBOX_SINGLE_UPLOAD_MAX_BYTES = 140 * 1024 * 1024;
// ~8 MB append chunks for the upload-session path.
export const DROPBOX_UPLOAD_CHUNK_BYTES = 8 * 1024 * 1024;

// Refresh an access token this long before it actually expires, so an in-flight
// request never races the boundary.
export const DROPBOX_TOKEN_EXPIRY_SKEW_MS = 30_000;

export const DROPBOX_AUTH_STORAGE_KEY = "sightlines:dropboxAuth";
export const DROPBOX_PKCE_VERIFIER_KEY = "sightlines:dropboxPkceVerifier";
export const DROPBOX_PKCE_STATE_KEY = "sightlines:dropboxPkceState";

// Fetch requires request-header values to be byte strings. JSON permits every
// Unicode code point, so escape non-ASCII UTF-16 code units before putting a
// Dropbox argument in the Dropbox-API-Arg header. Dropbox's JSON parser turns
// the escapes back into the original path (including surrogate pairs).
export function serializeDropboxApiArg(value: unknown): string {
  return JSON.stringify(value).replace(/[\u007f-\uffff]/g, (character) =>
    `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`
  );
}

// The stored auth record. accessToken/expiresAt are a refreshable cache; the
// refreshToken is the durable credential. accountLabel is the linked account's
// display name (best-effort; null until fetched).
export type DropboxAuthRecord = {
  refreshToken: string;
  accessToken: string;
  expiresAt: number;
  accountLabel: string | null;
};

// Base64url without padding, per RFC 7636.
export function base64UrlEncode(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = "";
  for (const byte of view) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// A high-entropy PKCE verifier / state value.
export function generateRandomString(byteLength = 48): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

// S256 code challenge for a verifier.
export async function computeS256Challenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(verifier)
  );
  return base64UrlEncode(digest);
}

// The authorize URL for the redirect. redirect_uri here must be byte-identical
// to the one sent at token exchange (Dropbox enforces this).
export function buildAuthorizeUrl(params: {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  state: string;
}): string {
  const url = new URL(DROPBOX_AUTHORIZE_URL);
  url.search = new URLSearchParams({
    client_id: params.clientId,
    response_type: "code",
    redirect_uri: params.redirectUri,
    code_challenge: params.codeChallenge,
    code_challenge_method: "S256",
    token_access_type: "offline",
    scope: DROPBOX_SCOPES,
    state: params.state
  }).toString();
  return url.toString();
}

// x-www-form-urlencoded bodies for the two token grants. No client secret ever
// leaves the browser — PKCE + client_id is the whole credential.
export function buildAuthorizationCodeBody(params: {
  code: string;
  clientId: string;
  redirectUri: string;
  codeVerifier: string;
}): URLSearchParams {
  return new URLSearchParams({
    grant_type: "authorization_code",
    code: params.code,
    client_id: params.clientId,
    redirect_uri: params.redirectUri,
    code_verifier: params.codeVerifier
  });
}

export function buildRefreshBody(params: {
  refreshToken: string;
  clientId: string;
}): URLSearchParams {
  return new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: params.refreshToken,
    client_id: params.clientId
  });
}

// A refresh failing with an invalid_grant (or a 400/401 carrying it) means the
// refresh token is revoked or evicted — the user must relink. Anything else
// (network blip, 5xx, 429) is transient: keep the record and retry later.
export function isReauthorizationFailure(
  status: number,
  body: unknown
): boolean {
  if (status !== 400 && status !== 401) return false;
  const error =
    body && typeof body === "object"
      ? (body as { error?: unknown }).error
      : undefined;
  return error === "invalid_grant";
}

export type DropboxErrorKind = "reauth" | "quota" | "rate-limit" | "transient";

// Classify an API/content-endpoint failure. 401 → the access token was rejected
// mid-flight despite a fresh refresh, treat as reauth. 429 → back off (respect
// Retry-After); surfaced as transient so a cycle failure never hard-fails the
// user. insufficient_space anywhere in the error payload → quota. Everything
// else (5xx, offline, malformed) → transient.
export function classifyApiError(status: number, body: unknown): DropboxErrorKind {
  if (status === 401) return "reauth";
  if (status === 429) return "rate-limit";
  const text =
    typeof body === "string" ? body : body != null ? JSON.stringify(body) : "";
  if (text.includes("insufficient_space")) return "quota";
  if (
    body &&
    typeof body === "object" &&
    isReauthorizationFailure(status, body)
  ) {
    return "reauth";
  }
  return "transient";
}

// Parse a Retry-After header (seconds or HTTP-date) into milliseconds, or null.
export function parseRetryAfterMs(
  headerValue: string | null,
  now = Date.now()
): number | null {
  if (!headerValue) return null;
  const seconds = Number(headerValue);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const dateMs = Date.parse(headerValue);
  if (Number.isFinite(dateMs)) return Math.max(0, dateMs - now);
  return null;
}

// --- path construction ----------------------------------------------------

// Dropbox path components can't contain / \ : ? * " < > | and shouldn't carry
// control chars; collapse runs of the disallowed set (and whitespace) to single
// spaces, trim, and fall back to a stable default so the filename is never empty.
export function sanitizeDropboxTitle(title: string): string {
  const cleaned = title
    .replace(/[/\\:?*"<>|\u0000-\u001f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.length > 0 ? cleaned : "Untitled";
}

// A filesystem-safe timestamp: ISO with the ":" and "." (illegal in Dropbox
// paths) swapped for "-", and the trailing "Z" kept. e.g.
// 2026-07-19T14:30:05.123Z → 2026-07-19T14-30-05-123Z.
export function filesystemSafeTimestamp(iso: string): string {
  return iso.replace(/[:.]/g, "-");
}

const PROJECT_FOLDER_ID_LENGTH = 8;
const PROJECT_FOLDER_SEPARATOR = " — ";

export function projectFolderSuffix(projectId: string): string {
  return projectId.slice(0, PROJECT_FOLDER_ID_LENGTH);
}

export function projectFolderName(projectId: string, projectTitle: string): string {
  return `${sanitizeDropboxTitle(projectTitle)}${PROJECT_FOLDER_SEPARATOR}${projectFolderSuffix(projectId)}`;
}

// The backup file path uses a readable project title plus a short stable id.
// The id prevents same-title projects from colliding; the provider reconciles
// this folder when a project is renamed so retention stays in one place.
// App-folder access roots all of this under /Apps/Sightlines.
export function buildBackupPath(input: {
  projectId: string;
  projectTitle: string;
  timestampIso: string;
}): string {
  return `${projectFolderPath(input.projectId, input.projectTitle)}/${buildBackupFilename(input.projectTitle, input.timestampIso)}`;
}

export function buildBackupFilename(
  projectTitle: string,
  timestampIso: string
): string {
  const title = sanitizeDropboxTitle(projectTitle);
  const stamp = filesystemSafeTimestamp(timestampIso);
  return `${title} ${stamp}.sightlines`;
}

export function projectFolderPath(projectId: string, projectTitle: string): string {
  return `/backups/${projectFolderName(projectId, projectTitle)}`;
}

export function isProjectFolderName(name: string, projectId: string): boolean {
  return (
    name === projectId ||
    name.endsWith(`${PROJECT_FOLDER_SEPARATOR}${projectFolderSuffix(projectId)}`)
  );
}

// A minimal file entry the retention logic needs from list_folder.
export type DropboxFileEntry = {
  ".tag"?: string;
  name: string;
  path_lower?: string;
  server_modified?: string;
};

// Given a folder's file entries and a keep count, return the paths to delete —
// the oldest beyond the newest `keep`. Pure so pagination + prune can be tested
// without a live folder. Sorts by server_modified (ISO) so string order is time
// order; ties break by name for determinism.
export function selectBackupsToPrune(
  entries: DropboxFileEntry[],
  keep: number = CLOUD_BACKUPS_PER_PROJECT
): string[] {
  const files = entries
    .filter((entry) => entry[".tag"] !== "folder" && entry.path_lower)
    .sort((a, b) => {
      const byTime = (a.server_modified ?? "").localeCompare(b.server_modified ?? "");
      return byTime !== 0 ? byTime : a.name.localeCompare(b.name);
    });
  if (files.length <= keep) return [];
  return files.slice(0, files.length - keep).map((entry) => entry.path_lower!);
}
