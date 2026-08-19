// Dropbox cloud-backup provider — raw fetch, no SDK. Implements the verified
// Phase 0 serverless PKCE flow: full-page redirect authorize, direct token
// exchange, and refresh with client_id only. All the pure math (PKCE, paths,
// retention, error classification) lives in dropboxAuth.ts; this module owns the
// browser side effects (storage, redirect, fetch) and the retention/upload
// orchestration.

import type {
  CloudBackupProvider,
  CloudBackupProviderStatus,
  CloudProjectBackup,
  CloudProjectFolder,
  UploadBackupInput
} from "./provider";
import {
  base64UrlEncode,
  buildAuthorizationCodeBody,
  buildAuthorizeUrl,
  buildBackupFilename,
  buildSharePath,
  buildRefreshBody,
  classifyApiError,
  computeS256Challenge,
  DROPBOX_API_URL,
  DROPBOX_AUTH_STORAGE_KEY,
  DROPBOX_CONTENT_URL,
  DROPBOX_PKCE_STATE_KEY,
  DROPBOX_PKCE_VERIFIER_KEY,
  DROPBOX_SCOPES,
  DROPBOX_SINGLE_UPLOAD_MAX_BYTES,
  DROPBOX_TOKEN_EXPIRY_SKEW_MS,
  DROPBOX_TOKEN_URL,
  DROPBOX_UPLOAD_CHUNK_BYTES,
  generateRandomString,
  isReauthorizationFailure,
  isProjectFolderName,
  MAX_BACKUP_DOWNLOAD_BYTES,
  parseProjectFolderName,
  projectFolderPath,
  selectBackupsToPrune,
  serializeDropboxApiArg,
  type DropboxAuthRecord,
  type DropboxErrorKind,
  type DropboxFileEntry
} from "./dropboxAuth";

// A typed error so the slice can tell reauth/quota/rate-limit/transient apart
// without re-parsing HTTP details.
export class CloudBackupError extends Error {
  kind: DropboxErrorKind;
  constructor(kind: DropboxErrorKind, message: string) {
    super(message);
    this.name = "CloudBackupError";
    this.kind = kind;
  }
}

function readAuth(): DropboxAuthRecord | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(DROPBOX_AUTH_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (
      !parsed ||
      typeof parsed !== "object" ||
      typeof (parsed as DropboxAuthRecord).refreshToken !== "string"
    ) {
      return null;
    }
    const record = parsed as DropboxAuthRecord;
    return {
      refreshToken: record.refreshToken,
      accessToken: typeof record.accessToken === "string" ? record.accessToken : "",
      expiresAt: typeof record.expiresAt === "number" ? record.expiresAt : 0,
      accountLabel:
        typeof record.accountLabel === "string" ? record.accountLabel : null,
      ...(typeof record.accountId === "string" ? { accountId: record.accountId } : {}),
      ...(typeof record.scope === "string" ? { scope: record.scope } : {})
    };
  } catch {
    return null;
  }
}

function writeAuth(record: DropboxAuthRecord): void {
  window.localStorage.setItem(DROPBOX_AUTH_STORAGE_KEY, JSON.stringify(record));
}

function clearAuth(): void {
  window.localStorage.removeItem(DROPBOX_AUTH_STORAGE_KEY);
}

function grantedScopes(auth: DropboxAuthRecord): Set<string> {
  return new Set((auth.scope ?? "").split(/\s+/).filter(Boolean));
}

// Which of the scopes this build asks for are absent from a stored grant. An
// older record with no `scope` at all counts as missing everything.
function missingScopes(auth: DropboxAuthRecord): string[] {
  const granted = grantedScopes(auth);
  return DROPBOX_SCOPES.split(/\s+/).filter((scope) => !granted.has(scope));
}

type TokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
};

export class DropboxCloudBackupProvider implements CloudBackupProvider {
  readonly id = "dropbox";
  readonly label = "Dropbox";

  private readonly clientId: string;
  private readonly redirectUri: string;
  // Sticky reauth flag: set when a refresh returns invalid_grant so getStatus()
  // reports "reauthorization-required" while the (now-useless) refresh token
  // record is intentionally kept so the UI can say "Reconnect Dropbox".
  private reauthorizationRequired = false;

  constructor(options: { clientId: string; redirectUri: string }) {
    this.clientId = options.clientId;
    this.redirectUri = options.redirectUri;
  }

  async startConnect(): Promise<void> {
    const existingAuth = readAuth();
    // Any scope added after a grant was stored needs a real approval screen —
    // Dropbox otherwise silently returns the old, narrower grant. Compare the
    // whole set rather than naming one scope, so the next addition needs no
    // change here.
    const forceReapprove =
      this.reauthorizationRequired ||
      (existingAuth !== null && missingScopes(existingAuth).length > 0);
    const verifier = generateRandomString();
    const state = generateRandomString();
    window.sessionStorage.setItem(DROPBOX_PKCE_VERIFIER_KEY, verifier);
    window.sessionStorage.setItem(DROPBOX_PKCE_STATE_KEY, state);
    const codeChallenge = await computeS256Challenge(verifier);
    const url = buildAuthorizeUrl({
      clientId: this.clientId,
      redirectUri: this.redirectUri,
      codeChallenge,
      state,
      forceReapprove
    });
    // Full-page navigation — this document does not continue past here; boot
    // resumes at redirectUri and finishes in completeConnect().
    window.location.assign(url);
  }

  async completeConnect(): Promise<boolean> {
    // The code is only ever delivered to the dedicated callback path.
    if (!isOnDropboxCallbackPath()) return false;
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    const returnedState = params.get("state");
    if (!code || !returnedState) {
      // On the callback path with no redirect tail (e.g. reload after a
      // completed exchange): leave the callback URL for the app root.
      cleanRedirectParams();
      return false;
    }

    const expectedState = window.sessionStorage.getItem(DROPBOX_PKCE_STATE_KEY);
    const verifier = window.sessionStorage.getItem(DROPBOX_PKCE_VERIFIER_KEY);
    window.sessionStorage.removeItem(DROPBOX_PKCE_STATE_KEY);
    window.sessionStorage.removeItem(DROPBOX_PKCE_VERIFIER_KEY);

    // Clean the ?code=&state= off the URL regardless of outcome so a reload
    // never re-runs the exchange (single-use code) or leaks the code.
    cleanRedirectParams();

    if (!expectedState || returnedState !== expectedState || !verifier) {
      // State mismatch or a lost verifier: refuse the exchange. Not our flow to
      // complete cleanly — report unhandled.
      return false;
    }

    try {
      const response = await fetch(DROPBOX_TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: buildAuthorizationCodeBody({
          code,
          clientId: this.clientId,
          redirectUri: this.redirectUri,
          codeVerifier: verifier
        })
      });
      const body = (await response.json().catch(() => ({}))) as TokenResponse;
      if (!response.ok || !body.refresh_token || !body.access_token) {
        return false;
      }
      this.reauthorizationRequired = false;
      writeAuth({
        refreshToken: body.refresh_token,
        accessToken: body.access_token,
        expiresAt: Date.now() + (body.expires_in ?? 0) * 1000,
        accountLabel: null,
        // A successful authorization-code exchange granted the scopes in the
        // authorize URL. Dropbox may omit `scope` from the token response, so
        // persist the requested set as the reliable fallback.
        scope: body.scope ?? DROPBOX_SCOPES
      });
      // Best-effort display name; a failure here doesn't undo the link.
      await this.fetchAccountLabel().catch(() => {});
      return true;
    } catch {
      return false;
    }
  }

  disconnect(): void {
    clearAuth();
    this.reauthorizationRequired = false;
  }

  getStatus(): CloudBackupProviderStatus {
    const auth = readAuth();
    if (!auth) return "disconnected";
    if (this.reauthorizationRequired) return "reauthorization-required";
    return "connected";
  }

  accountLabel(): string | null {
    return readAuth()?.accountLabel ?? null;
  }

  async uploadBackup(input: UploadBackupInput): Promise<void> {
    const token = await this.accessToken();
    const folderPath = await this.reconcileProjectFolder(
      token,
      input.projectId,
      input.projectTitle
    );
    const path = `${folderPath}/${buildBackupFilename(
      input.projectTitle,
      input.timestampIso
    )}`;
    await this.uploadPackage(token, path, input.blob);

    // Retention runs AFTER a confirmed upload and is best-effort: a prune
    // failure must not fail the backup (it retries next cycle).
    try {
      await this.pruneRetention(token, folderPath);
    } catch (error) {
      console.warn("Cloud backup uploaded; pruning old copies failed", error);
    }
  }

  async createShareLink(input: UploadBackupInput): Promise<string> {
    const auth = readAuth();
    if (!auth) throw new CloudBackupError("reauth", "Dropbox is not connected.");
    if (!grantedScopes(auth).has("sharing.write")) {
      this.reauthorizationRequired = true;
      throw new CloudBackupError(
        "reauth",
        "Reconnect Dropbox once to enable project sharing."
      );
    }

    const token = await this.accessToken();
    const requestedPath = buildSharePath(input);
    const uploadedPath = await this.uploadPackage(token, requestedPath, input.blob);
    const response = await fetch(
      `${DROPBOX_API_URL}/2/sharing/create_shared_link_with_settings`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          path: uploadedPath,
          settings: { requested_visibility: "public" }
        })
      }
    );
    const body = await ensureOk<{ url?: string }>(response, "create the share link");
    if (!body.url) {
      throw new CloudBackupError("transient", "Dropbox returned no share link.");
    }
    return body.url;
  }

  // --- reading back --------------------------------------------------------

  async listCloudProjects(): Promise<CloudProjectFolder[]> {
    this.requireReadScope();
    return this.withReauthTracking(async () => {
      const token = await this.accessToken();
      // One recursive listing covers the folders and their files; /backups is
      // two levels deep by construction, so nothing deeper is expected.
      const entries = await this.listFolder(token, "/backups", { recursive: true });
      return groupCloudProjects(entries);
    });
  }

  async downloadBackup(path: string): Promise<Uint8Array> {
    this.requireReadScope();
    return this.withReauthTracking(async () => {
      const token = await this.accessToken();
      const response = await fetch(`${DROPBOX_CONTENT_URL}/2/files/download`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Dropbox-API-Arg": serializeDropboxApiArg({ path })
        }
      });
      return ensureOkBinary(response, "download the backup");
    });
  }

  // Reading is a scope the first release never asked for, so a stored grant can
  // be complete for backup and still unable to list or download. Mirrors
  // createShareLink's gate: flip the sticky flag so every surface offers the
  // one-time Reconnect, and never spend a request that is certain to fail.
  private requireReadScope(): void {
    const auth = readAuth();
    if (!auth) throw new CloudBackupError("reauth", "Dropbox is not connected.");
    if (!grantedScopes(auth).has("files.content.read")) {
      this.reauthorizationRequired = true;
      throw new CloudBackupError(
        "reauth",
        "Reconnect Dropbox once to browse cloud backups."
      );
    }
  }

  // A token rejected mid-flight (401) means the grant died between the refresh
  // and the call; make it stick so the UI stops presenting the browser as usable.
  private async withReauthTracking<T>(run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (error) {
      if (error instanceof CloudBackupError && error.kind === "reauth") {
        this.reauthorizationRequired = true;
      }
      throw error;
    }
  }

  // --- token lifecycle -----------------------------------------------------

  private async accessToken(): Promise<string> {
    const auth = readAuth();
    if (!auth) throw new CloudBackupError("reauth", "Dropbox is not connected.");
    if (Date.now() <= auth.expiresAt - DROPBOX_TOKEN_EXPIRY_SKEW_MS) {
      return auth.accessToken;
    }
    return this.refresh(auth);
  }

  private async refresh(auth: DropboxAuthRecord): Promise<string> {
    let response: Response;
    try {
      response = await fetch(DROPBOX_TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: buildRefreshBody({
          refreshToken: auth.refreshToken,
          clientId: this.clientId
        })
      });
    } catch (error) {
      // A network error is transient — the token is probably still fine.
      throw new CloudBackupError(
        "transient",
        `Could not reach Dropbox to refresh access (${
          error instanceof Error ? error.message : "network error"
        }).`
      );
    }

    const body = (await response.json().catch(() => ({}))) as TokenResponse;
    if (!response.ok) {
      if (isReauthorizationFailure(response.status, body)) {
        // Revoked or evicted: keep the record so the UI can offer "Reconnect".
        this.reauthorizationRequired = true;
        throw new CloudBackupError(
          "reauth",
          "Dropbox access has expired. Reconnect to resume backups."
        );
      }
      throw new CloudBackupError(
        "transient",
        `Dropbox token refresh failed (${response.status}).`
      );
    }
    if (!body.access_token) {
      throw new CloudBackupError("transient", "Dropbox returned no access token.");
    }

    this.reauthorizationRequired = false;
    writeAuth({
      ...auth,
      accessToken: body.access_token,
      expiresAt: Date.now() + (body.expires_in ?? 0) * 1000,
      ...(body.scope ? { scope: body.scope } : {})
    });
    return body.access_token;
  }

  private async fetchAccountLabel(): Promise<void> {
    const auth = readAuth();
    if (!auth) return;
    const token = await this.accessToken();
    const response = await fetch(`${DROPBOX_API_URL}/2/users/get_current_account`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!response.ok) return;
    const body = (await response.json().catch(() => ({}))) as {
      account_id?: string;
      name?: { display_name?: string };
    };
    const label = body.name?.display_name;
    // The account id is captured here so cross-device sync can bind its
    // bookkeeping to the account rather than the (mutable, ambiguous) display
    // name without forcing a second reconnect later.
    const accountId = body.account_id;
    const current = readAuth();
    if (!current || (!label && !accountId)) return;
    writeAuth({
      ...current,
      ...(label ? { accountLabel: label } : {}),
      ...(accountId ? { accountId } : {})
    });
  }

  // --- upload paths --------------------------------------------------------

  private async uploadPackage(
    token: string,
    path: string,
    blob: Blob
  ): Promise<string> {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    return bytes.byteLength <= DROPBOX_SINGLE_UPLOAD_MAX_BYTES
      ? this.uploadSingle(token, path, bytes)
      : this.uploadSession(token, path, bytes);
  }

  private async uploadSingle(
    token: string,
    path: string,
    bytes: Uint8Array
  ): Promise<string> {
    const response = await fetch(`${DROPBOX_CONTENT_URL}/2/files/upload`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/octet-stream",
        "Dropbox-API-Arg": serializeDropboxApiArg({
          path,
          mode: "add",
          autorename: true,
          mute: true
        })
      },
      body: bytes as BodyInit
    });
    const body = await ensureOk<{ path_display?: string }>(response, "upload the package");
    return body.path_display ?? path;
  }

  private async uploadSession(
    token: string,
    path: string,
    bytes: Uint8Array
  ): Promise<string> {
    // start
    const firstChunk = bytes.subarray(0, DROPBOX_UPLOAD_CHUNK_BYTES);
    const startResponse = await fetch(
      `${DROPBOX_CONTENT_URL}/2/files/upload_session/start`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/octet-stream",
          "Dropbox-API-Arg": serializeDropboxApiArg({ close: false })
        },
        body: firstChunk as BodyInit
      }
    );
    const startBody = await ensureOk<{ session_id: string }>(
      startResponse,
      "start the upload"
    );
    const sessionId = startBody.session_id;

    // append the middle chunks
    let offset = firstChunk.byteLength;
    while (offset < bytes.byteLength) {
      const chunk = bytes.subarray(offset, offset + DROPBOX_UPLOAD_CHUNK_BYTES);
      const isLast = offset + chunk.byteLength >= bytes.byteLength;
      if (isLast) break;
      const appendResponse = await fetch(
        `${DROPBOX_CONTENT_URL}/2/files/upload_session/append_v2`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/octet-stream",
            "Dropbox-API-Arg": serializeDropboxApiArg({
              cursor: { session_id: sessionId, offset },
              close: false
            })
          },
          body: chunk as BodyInit
        }
      );
      await ensureOk(appendResponse, "upload the backup");
      offset += chunk.byteLength;
    }

    // finish with the trailing chunk
    const lastChunk = bytes.subarray(offset);
    const finishResponse = await fetch(
      `${DROPBOX_CONTENT_URL}/2/files/upload_session/finish`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/octet-stream",
          "Dropbox-API-Arg": serializeDropboxApiArg({
            cursor: { session_id: sessionId, offset },
            commit: { path, mode: "add", autorename: true, mute: true }
          })
        },
        body: lastChunk as BodyInit
      }
    );
    const body = await ensureOk<{ path_display?: string }>(finishResponse, "finish the upload");
    return body.path_display ?? path;
  }

  // --- retention -----------------------------------------------------------

  private async reconcileProjectFolder(
    token: string,
    projectId: string,
    projectTitle: string
  ): Promise<string> {
    const desiredPath = projectFolderPath(projectId, projectTitle);
    const desiredName = desiredPath.slice("/backups/".length);
    const entries = await this.listFolder(token, "/backups");
    const folders = entries.filter((entry) => entry[".tag"] === "folder");

    const existingDesired = folders.find(
      (entry) => entry.name.toLocaleLowerCase() === desiredName.toLocaleLowerCase()
    );
    // Dropbox does not support case-only renames. Use the existing display
    // spelling in that case; path lookup remains case-insensitive.
    if (existingDesired) return `/backups/${existingDesired.name}`;

    const existing = folders.find((entry) =>
      isProjectFolderName(entry.name, projectId)
    );
    if (!existing) return desiredPath;

    const response = await fetch(`${DROPBOX_API_URL}/2/files/move_v2`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        from_path: `/backups/${existing.name}`,
        to_path: desiredPath,
        autorename: false
      })
    });
    await ensureOk(response, "rename the project backup folder");
    return desiredPath;
  }

  private async pruneRetention(token: string, folderPath: string): Promise<void> {
    const entries = await this.listFolder(token, folderPath);
    const toDelete = selectBackupsToPrune(entries);
    for (const path of toDelete) {
      const response = await fetch(`${DROPBOX_API_URL}/2/files/delete_v2`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ path })
      });
      // A prune delete failing (e.g. already gone) doesn't matter — swallow.
      await response.json().catch(() => ({}));
    }
  }

  private async listFolder(
    token: string,
    path: string,
    options: { recursive?: boolean } = {}
  ): Promise<DropboxFileEntry[]> {
    const entries: DropboxFileEntry[] = [];
    let response = await fetch(`${DROPBOX_API_URL}/2/files/list_folder`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(
        options.recursive ? { path, recursive: true } : { path }
      )
    });
    // A missing folder (nothing uploaded yet, or all pruned) is not an error.
    if (response.status === 409) return [];
    let body = await ensureOk<{
      entries: DropboxFileEntry[];
      has_more: boolean;
      cursor: string;
    }>(response, "list backups");
    entries.push(...body.entries);
    while (body.has_more) {
      response = await fetch(`${DROPBOX_API_URL}/2/files/list_folder/continue`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ cursor: body.cursor })
      });
      body = await ensureOk<{
        entries: DropboxFileEntry[];
        has_more: boolean;
        cursor: string;
      }>(response, "list backups");
      entries.push(...body.entries);
    }
    return entries;
  }
}

// Reject with a classified CloudBackupError on a non-2xx response; otherwise
// return the parsed JSON body. 429s carry Retry-After through the message.
async function ensureOk<T = unknown>(
  response: Response,
  action: string
): Promise<T> {
  if (response.ok) {
    return (await response.json().catch(() => ({}))) as T;
  }
  const body = await response.json().catch(() => null);
  throw classifiedError(response.status, body, action);
}

// The binary sibling of ensureOk for the content endpoints that answer with
// bytes. Content-endpoint errors arrive as plain text rather than JSON, and
// classifyApiError already reads a string body, so the two share one
// classification (and therefore one reauth/quota/not-found vocabulary).
async function ensureOkBinary(
  response: Response,
  action: string
): Promise<Uint8Array> {
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw classifiedError(response.status, text, action);
  }
  const declared = response.headers.get("Content-Length");
  if (declared !== null && Number(declared) > MAX_BACKUP_DOWNLOAD_BYTES) {
    throw oversizeError(action);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  // Content-Length is advisory (absent under chunked transfer), so the real
  // length is the one that decides.
  if (bytes.byteLength > MAX_BACKUP_DOWNLOAD_BYTES) throw oversizeError(action);
  return bytes;
}

function classifiedError(
  status: number,
  body: unknown,
  action: string
): CloudBackupError {
  const kind = classifyApiError(status, body);
  const detail =
    kind === "quota"
      ? "Your Dropbox is out of space."
      : kind === "rate-limit"
        ? "Dropbox is rate-limiting backups; will retry shortly."
        : kind === "reauth"
          ? "Dropbox access has expired. Reconnect to resume backups."
          : kind === "not-found"
            ? "That file is no longer in your Dropbox."
            : `Dropbox request failed (${status}).`;
  return new CloudBackupError(kind, `Could not ${action}: ${detail}`);
}

function oversizeError(action: string): CloudBackupError {
  return new CloudBackupError(
    "too-large",
    `Could not ${action}: that backup is larger than ${
      MAX_BACKUP_DOWNLOAD_BYTES / (1024 * 1024)
    } MB and cannot be opened here.`
  );
}

// Fold a recursive /backups listing into per-project folders. Depth is read
// from the entry path rather than trusted from the order Dropbox returns:
// /backups/<folder> is a project folder, /backups/<folder>/<file> its backup.
// Paths are lowercased by Dropbox, so the folder segment is the join key.
function groupCloudProjects(entries: DropboxFileEntry[]): CloudProjectFolder[] {
  type Group = { folder: CloudProjectFolder; backups: CloudProjectBackup[] };
  const groups = new Map<string, Group>();

  for (const entry of entries) {
    if (entry[".tag"] !== "folder") continue;
    const segments = backupPathSegments(entry);
    if (segments.length !== 2) continue;
    const parsed = parseProjectFolderName(entry.name);
    if (!parsed) continue;
    groups.set(segments[1], {
      folder: {
        folderName: entry.name,
        title: parsed.title,
        projectIdPrefix: parsed.projectIdPrefix,
        backupCount: 0,
        latestBackup: null
      },
      backups: []
    });
  }

  for (const entry of entries) {
    if (entry[".tag"] === "folder") continue;
    if (!entry.name.toLocaleLowerCase().endsWith(".sightlines")) continue;
    const segments = backupPathSegments(entry);
    if (segments.length !== 3) continue;
    const group = groups.get(segments[1]);
    const path = entry.path_lower ?? entry.path_display;
    if (!group || !path) continue;
    group.backups.push({
      path,
      name: entry.name,
      serverModifiedIso: entry.server_modified ?? null,
      sizeBytes: typeof entry.size === "number" ? entry.size : null
    });
  }

  const folders: CloudProjectFolder[] = [];
  for (const group of groups.values()) {
    // ISO timestamps compare lexicographically; an entry without one sorts
    // last (its "" loses every comparison), so it is never mistaken for newest.
    group.backups.sort(
      (a, b) =>
        (b.serverModifiedIso ?? "").localeCompare(a.serverModifiedIso ?? "") ||
        a.name.localeCompare(b.name)
    );
    folders.push({
      ...group.folder,
      backupCount: group.backups.length,
      latestBackup: group.backups[0] ?? null
    });
  }

  // Most recently backed-up project first. A folder with no backups at all
  // trails every folder that has one, including one Dropbox gave no timestamp
  // for — "we don't know when" still outranks "there is nothing here".
  return folders.sort(
    (a, b) =>
      Number(b.latestBackup !== null) - Number(a.latestBackup !== null) ||
      (b.latestBackup?.serverModifiedIso ?? "").localeCompare(
        a.latestBackup?.serverModifiedIso ?? ""
      ) ||
      a.folderName.localeCompare(b.folderName)
  );
}

function backupPathSegments(entry: DropboxFileEntry): string[] {
  const path = entry.path_lower ?? entry.path_display ?? "";
  return path.toLocaleLowerCase().split("/").filter(Boolean);
}

// Leave the callback URL for the app root without a reload, dropping the
// single-use ?code=&state= tail so a reload never re-runs the exchange or
// leaks the code into history.
function cleanRedirectParams(): void {
  window.history.replaceState(null, "", import.meta.env.BASE_URL || "/");
}

// Dedicated OAuth callback path: the authorization code is only ever delivered
// here, never to an arbitrary app URL. Dropbox requires the redirect_uri to
// match a registered URI byte-for-byte, so this must equal what's configured on
// the Dropbox app per origin (e.g. https://app.sightlines.art/auth/dropbox/callback).
// Both hosts serve the SPA for this path (worker single-page-application
// fallback; vercel.json rewrite).
export const DROPBOX_CALLBACK_PATH = "auth/dropbox/callback";

export function dropboxCallbackRedirectUri(): string {
  const base = import.meta.env.BASE_URL || "/";
  return window.location.origin + base + DROPBOX_CALLBACK_PATH;
}

export function isOnDropboxCallbackPath(): boolean {
  const base = import.meta.env.BASE_URL || "/";
  return window.location.pathname === base + DROPBOX_CALLBACK_PATH;
}

// Build the Dropbox provider, or null when no client id is configured — the
// whole feature is then inert and the UI hides it.
export function createDropboxProvider(): DropboxCloudBackupProvider | null {
  const clientId = import.meta.env.VITE_DROPBOX_CLIENT_ID;
  if (!clientId) return null;
  return new DropboxCloudBackupProvider({
    clientId,
    redirectUri: dropboxCallbackRedirectUri()
  });
}

// Re-export so consumers importing the provider also get the base64 helper used
// in tests without reaching into dropboxAuth.
export { base64UrlEncode };
