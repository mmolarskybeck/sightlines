import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CloudBackupError,
  DROPBOX_CALLBACK_PATH,
  DropboxCloudBackupProvider
} from "./dropbox";
import {
  DROPBOX_AUTH_STORAGE_KEY,
  DROPBOX_PKCE_STATE_KEY,
  DROPBOX_PKCE_VERIFIER_KEY,
  type DropboxAuthRecord
} from "./dropboxAuth";

function seedAuth(overrides: Partial<DropboxAuthRecord> = {}): void {
  const record: DropboxAuthRecord = {
    refreshToken: "refresh-token",
    accessToken: "access-token",
    expiresAt: Date.now() + 3_600_000,
    accountLabel: "Ada Curator",
    ...overrides
  };
  window.localStorage.setItem(DROPBOX_AUTH_STORAGE_KEY, JSON.stringify(record));
}

function readStoredAuth(): DropboxAuthRecord | null {
  const raw = window.localStorage.getItem(DROPBOX_AUTH_STORAGE_KEY);
  return raw ? (JSON.parse(raw) as DropboxAuthRecord) : null;
}

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers }
  });
}

function makeProvider(): DropboxCloudBackupProvider {
  return new DropboxCloudBackupProvider({
    clientId: "client-abc",
    redirectUri: "https://app.sightlines.art/"
  });
}

// jsdom's Blob has no arrayBuffer(); provide a minimal blob-like the provider
// can read bytes from.
function fakeBlob(bytes: Uint8Array): Blob {
  return {
    size: bytes.byteLength,
    type: "application/octet-stream",
    arrayBuffer: async () => bytes.buffer.slice(0) as ArrayBuffer
  } as unknown as Blob;
}

function smallBackupInput() {
  return {
    projectId: "proj-1",
    projectTitle: "Winter Show",
    blob: fakeBlob(new Uint8Array([1, 2, 3, 4])),
    timestampIso: "2026-07-19T14:30:05.000Z"
  };
}

describe("DropboxCloudBackupProvider", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  describe("token refresh", () => {
    it("refreshes an expired access token with client_id only, then uploads", async () => {
      seedAuth({ expiresAt: Date.now() - 1000, accessToken: "stale" });
      const fetchMock = vi.fn(async (url: string, _init?: RequestInit) => {
        if (url.includes("/oauth2/token")) {
          return jsonResponse(200, { access_token: "fresh-token", expires_in: 14400 });
        }
        if (url.includes("/files/upload")) return jsonResponse(200, { path_display: "/x" });
        if (url.includes("/files/list_folder")) return jsonResponse(200, { entries: [], has_more: false });
        return jsonResponse(200, {});
      });
      vi.stubGlobal("fetch", fetchMock);

      await makeProvider().uploadBackup(smallBackupInput());

      const tokenCall = fetchMock.mock.calls.find(([url]) => String(url).includes("/oauth2/token"));
      expect(tokenCall).toBeTruthy();
      const body = tokenCall![1]!.body as URLSearchParams;
      expect(body.get("grant_type")).toBe("refresh_token");
      expect(body.get("client_id")).toBe("client-abc");
      // The refreshed token is persisted.
      expect(readStoredAuth()?.accessToken).toBe("fresh-token");
    });

    it("marks reauthorization-required on invalid_grant and keeps the record", async () => {
      seedAuth({ expiresAt: Date.now() - 1000 });
      const provider = makeProvider();
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => jsonResponse(400, { error: "invalid_grant" }))
      );

      await expect(provider.uploadBackup(smallBackupInput())).rejects.toMatchObject({
        kind: "reauth"
      });
      expect(provider.getStatus()).toBe("reauthorization-required");
      // The (now useless) record is kept so the UI can offer "Reconnect".
      expect(readStoredAuth()).not.toBeNull();
    });

    it("treats a network error on refresh as transient, not reauth", async () => {
      seedAuth({ expiresAt: Date.now() - 1000 });
      const provider = makeProvider();
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => {
          throw new TypeError("Failed to fetch");
        })
      );

      await expect(provider.uploadBackup(smallBackupInput())).rejects.toMatchObject({
        kind: "transient"
      });
      // A transient failure must NOT flip status to reauth.
      expect(provider.getStatus()).toBe("connected");
    });
  });

  describe("upload path + single upload", () => {
    it("uploads to a project-id folder with the title + timestamp filename", async () => {
      seedAuth();
      const fetchMock = vi.fn(async (url: string, _init?: RequestInit) => {
        if (url.includes("/files/upload")) return jsonResponse(200, { path_display: "/x" });
        if (url.includes("/files/list_folder")) return jsonResponse(200, { entries: [], has_more: false });
        return jsonResponse(200, {});
      });
      vi.stubGlobal("fetch", fetchMock);

      await makeProvider().uploadBackup(smallBackupInput());

      const uploadCall = fetchMock.mock.calls.find(([url]) =>
        String(url).includes("/files/upload")
      );
      expect(uploadCall).toBeTruthy();
      const arg = JSON.parse(
        (uploadCall![1]!.headers as Record<string, string>)["Dropbox-API-Arg"]
      );
      expect(arg.path).toBe(
        "/backups/proj-1/Winter Show 2026-07-19T14-30-05-000Z.sightlines"
      );
      expect(arg.mode).toBe("add");
    });
  });

  describe("retention", () => {
    it("paginates list_folder and deletes the oldest beyond the cap", async () => {
      seedAuth();
      const page1 = {
        entries: Array.from({ length: 4 }, (_, i) => ({
          ".tag": "file",
          name: `b${i}.sightlines`,
          path_lower: `/backups/proj-1/b${i}.sightlines`,
          server_modified: `2026-07-1${i}T00:00:00Z`
        })),
        has_more: true,
        cursor: "CURSOR"
      };
      const page2 = {
        entries: Array.from({ length: 2 }, (_, i) => ({
          ".tag": "file",
          name: `b${i + 4}.sightlines`,
          path_lower: `/backups/proj-1/b${i + 4}.sightlines`,
          server_modified: `2026-07-2${i}T00:00:00Z`
        })),
        has_more: false,
        cursor: "CURSOR2"
      };
      const deleteCalls: string[] = [];
      const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
        if (url.includes("/files/upload")) return jsonResponse(200, {});
        if (url.endsWith("/files/list_folder")) return jsonResponse(200, page1);
        if (url.includes("/files/list_folder/continue")) return jsonResponse(200, page2);
        if (url.includes("/files/delete_v2")) {
          deleteCalls.push(JSON.parse(String(init?.body)).path);
          return jsonResponse(200, {});
        }
        return jsonResponse(200, {});
      });
      vi.stubGlobal("fetch", fetchMock);

      await makeProvider().uploadBackup(smallBackupInput());

      // 6 files, keep 5, prune the single oldest (b0).
      expect(deleteCalls).toEqual(["/backups/proj-1/b0.sightlines"]);
    });

    it("counts the upload as success even if pruning fails", async () => {
      seedAuth();
      const fetchMock = vi.fn(async (url: string) => {
        if (url.includes("/files/upload")) return jsonResponse(200, {});
        if (url.endsWith("/files/list_folder")) {
          return jsonResponse(200, {
            entries: Array.from({ length: 6 }, (_, i) => ({
              ".tag": "file",
              name: `b${i}.sightlines`,
              path_lower: `/backups/proj-1/b${i}.sightlines`,
              server_modified: `2026-07-0${i}T00:00:00Z`
            })),
            has_more: false
          });
        }
        if (url.includes("/files/delete_v2")) return jsonResponse(500, { error: "boom" });
        return jsonResponse(200, {});
      });
      vi.stubGlobal("fetch", fetchMock);

      // A prune failure must not reject the backup.
      await expect(makeProvider().uploadBackup(smallBackupInput())).resolves.toBeUndefined();
    });
  });

  describe("error handling", () => {
    it("surfaces a 429 as a rate-limit CloudBackupError (transient, not hard-fail)", async () => {
      seedAuth();
      vi.stubGlobal(
        "fetch",
        vi.fn(async (url: string) => {
          if (url.includes("/files/upload")) {
            return jsonResponse(429, { error: "too_many_requests" }, { "Retry-After": "30" });
          }
          return jsonResponse(200, {});
        })
      );

      const error = await makeProvider()
        .uploadBackup(smallBackupInput())
        .catch((e) => e);
      expect(error).toBeInstanceOf(CloudBackupError);
      expect(error.kind).toBe("rate-limit");
    });

    it("surfaces insufficient_space as a quota error", async () => {
      seedAuth();
      vi.stubGlobal(
        "fetch",
        vi.fn(async (url: string) => {
          if (url.includes("/files/upload")) {
            return jsonResponse(507, { error_summary: "insufficient_space/.." });
          }
          return jsonResponse(200, {});
        })
      );

      const error = await makeProvider()
        .uploadBackup(smallBackupInput())
        .catch((e) => e);
      expect(error.kind).toBe("quota");
    });
  });

  describe("completeConnect", () => {
    afterEach(() => {
      window.sessionStorage.clear();
      window.history.replaceState(null, "", "/");
    });

    function seedRedirectTail(path: string, state = "state-1"): void {
      window.sessionStorage.setItem(DROPBOX_PKCE_STATE_KEY, state);
      window.sessionStorage.setItem(DROPBOX_PKCE_VERIFIER_KEY, "verifier-1");
      window.history.replaceState(null, "", `${path}?code=code-1&state=state-1`);
    }

    it("ignores a code delivered anywhere but the callback path", async () => {
      seedRedirectTail("/some/other/page");
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);
      const handled = await makeProvider().completeConnect();
      expect(handled).toBe(false);
      expect(fetchMock).not.toHaveBeenCalled();
      // Not our redirect: the URL is left alone.
      expect(window.location.pathname).toBe("/some/other/page");
    });

    it("exchanges the code on the callback path and returns to the app root", async () => {
      seedRedirectTail(`/${DROPBOX_CALLBACK_PATH}`);
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(
          jsonResponse(200, {
            access_token: "new-access",
            refresh_token: "new-refresh",
            expires_in: 14400
          })
        )
        .mockResolvedValueOnce(
          jsonResponse(200, { name: { display_name: "Ada Curator" } })
        );
      vi.stubGlobal("fetch", fetchMock);
      const handled = await makeProvider().completeConnect();
      expect(handled).toBe(true);
      expect(readStoredAuth()?.refreshToken).toBe("new-refresh");
      expect(window.location.pathname).toBe("/");
      expect(window.location.search).toBe("");
    });

    it("refuses the exchange on a state mismatch but still cleans the URL", async () => {
      seedRedirectTail(`/${DROPBOX_CALLBACK_PATH}`, "different-state");
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);
      const handled = await makeProvider().completeConnect();
      expect(handled).toBe(false);
      expect(fetchMock).not.toHaveBeenCalled();
      expect(readStoredAuth()).toBeNull();
      expect(window.location.search).toBe("");
      expect(window.location.pathname).toBe("/");
    });
  });

  describe("status", () => {
    it("reports disconnected with no record and connected with one", () => {
      const provider = makeProvider();
      expect(provider.getStatus()).toBe("disconnected");
      expect(provider.accountLabel()).toBeNull();
      seedAuth();
      expect(provider.getStatus()).toBe("connected");
      expect(provider.accountLabel()).toBe("Ada Curator");
    });

    it("disconnect clears the record", () => {
      seedAuth();
      const provider = makeProvider();
      provider.disconnect();
      expect(provider.getStatus()).toBe("disconnected");
      expect(readStoredAuth()).toBeNull();
    });
  });
});
