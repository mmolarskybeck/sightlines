// Dropbox cloud-backup provider — raw fetch, no SDK. Implements the verified
// Phase 0 serverless PKCE flow: full-page redirect authorize, direct token
// exchange, and refresh with client_id only. All the pure math (PKCE, paths,
// retention, error classification) lives in dropboxAuth.ts; this module owns the
// browser side effects (storage, redirect, fetch) and the retention/upload
// orchestration.

import type {
  CloudBackupProvider,
  CloudBackupProviderStatus,
  UploadBackupInput
} from "./provider";
import {
  base64UrlEncode,
  buildAuthorizationCodeBody,
  buildAuthorizeUrl,
  buildBackupPath,
  buildRefreshBody,
  classifyApiError,
  computeS256Challenge,
  DROPBOX_API_URL,
  DROPBOX_AUTH_STORAGE_KEY,
  DROPBOX_CONTENT_URL,
  DROPBOX_PKCE_STATE_KEY,
  DROPBOX_PKCE_VERIFIER_KEY,
  DROPBOX_SINGLE_UPLOAD_MAX_BYTES,
  DROPBOX_TOKEN_EXPIRY_SKEW_MS,
  DROPBOX_TOKEN_URL,
  DROPBOX_UPLOAD_CHUNK_BYTES,
  generateRandomString,
  isReauthorizationFailure,
  projectFolderPath,
  selectBackupsToPrune,
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
        typeof record.accountLabel === "string" ? record.accountLabel : null
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
    const verifier = generateRandomString();
    const state = generateRandomString();
    window.sessionStorage.setItem(DROPBOX_PKCE_VERIFIER_KEY, verifier);
    window.sessionStorage.setItem(DROPBOX_PKCE_STATE_KEY, state);
    const codeChallenge = await computeS256Challenge(verifier);
    const url = buildAuthorizeUrl({
      clientId: this.clientId,
      redirectUri: this.redirectUri,
      codeChallenge,
      state
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
        accountLabel: null
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
    const path = buildBackupPath({
      projectId: input.projectId,
      projectTitle: input.projectTitle,
      timestampIso: input.timestampIso
    });
    const bytes = new Uint8Array(await input.blob.arrayBuffer());

    if (bytes.byteLength <= DROPBOX_SINGLE_UPLOAD_MAX_BYTES) {
      await this.uploadSingle(token, path, bytes);
    } else {
      await this.uploadSession(token, path, bytes);
    }

    // Retention runs AFTER a confirmed upload and is best-effort: a prune
    // failure must not fail the backup (it retries next cycle).
    try {
      await this.pruneRetention(token, input.projectId);
    } catch (error) {
      console.warn("Cloud backup uploaded; pruning old copies failed", error);
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
      expiresAt: Date.now() + (body.expires_in ?? 0) * 1000
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
      name?: { display_name?: string };
    };
    const label = body.name?.display_name;
    const current = readAuth();
    if (label && current) {
      writeAuth({ ...current, accountLabel: label });
    }
  }

  // --- upload paths --------------------------------------------------------

  private async uploadSingle(
    token: string,
    path: string,
    bytes: Uint8Array
  ): Promise<void> {
    const response = await fetch(`${DROPBOX_CONTENT_URL}/2/files/upload`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/octet-stream",
        "Dropbox-API-Arg": JSON.stringify({
          path,
          mode: "add",
          autorename: true,
          mute: true
        })
      },
      body: bytes as BodyInit
    });
    await ensureOk(response, "upload the backup");
  }

  private async uploadSession(
    token: string,
    path: string,
    bytes: Uint8Array
  ): Promise<void> {
    // start
    const firstChunk = bytes.subarray(0, DROPBOX_UPLOAD_CHUNK_BYTES);
    const startResponse = await fetch(
      `${DROPBOX_CONTENT_URL}/2/files/upload_session/start`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/octet-stream",
          "Dropbox-API-Arg": JSON.stringify({ close: false })
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
            "Dropbox-API-Arg": JSON.stringify({
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
          "Dropbox-API-Arg": JSON.stringify({
            cursor: { session_id: sessionId, offset },
            commit: { path, mode: "add", autorename: true, mute: true }
          })
        },
        body: lastChunk as BodyInit
      }
    );
    await ensureOk(finishResponse, "finish the upload");
  }

  // --- retention -----------------------------------------------------------

  private async pruneRetention(token: string, projectId: string): Promise<void> {
    const entries = await this.listFolder(token, projectFolderPath(projectId));
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
    path: string
  ): Promise<DropboxFileEntry[]> {
    const entries: DropboxFileEntry[] = [];
    let response = await fetch(`${DROPBOX_API_URL}/2/files/list_folder`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ path })
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
  const kind = classifyApiError(response.status, body);
  const detail =
    kind === "quota"
      ? "Your Dropbox is out of space."
      : kind === "rate-limit"
        ? "Dropbox is rate-limiting backups; will retry shortly."
        : kind === "reauth"
          ? "Dropbox access has expired. Reconnect to resume backups."
          : `Dropbox request failed (${response.status}).`;
  throw new CloudBackupError(kind, `Could not ${action}: ${detail}`);
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
