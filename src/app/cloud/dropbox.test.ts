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
  DROPBOX_SCOPES,
  MAX_BACKUP_DOWNLOAD_BYTES,
  type DropboxAuthRecord
} from "./dropboxAuth";

// The scope set before the cloud project browser existed: enough to back up and
// share, blind to reading anything back down.
const LEGACY_SCOPES =
  "account_info.read files.content.write files.metadata.read sharing.write";

function seedAuth(overrides: Partial<DropboxAuthRecord> = {}): void {
  const record: DropboxAuthRecord = {
    refreshToken: "refresh-token",
    accessToken: "access-token",
    expiresAt: Date.now() + 3_600_000,
    accountLabel: "Ada Curator",
    scope: DROPBOX_SCOPES,
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
    it("uploads to a readable project folder with the title + timestamp filename", async () => {
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
      const header = (uploadCall![1]!.headers as Record<string, string>)[
        "Dropbox-API-Arg"
      ];
      expect(header).not.toMatch(/[^\x20-\x7e]/);
      const arg = JSON.parse(header);
      expect(arg.path).toBe(
        "/backups/Winter Show — proj-1/Winter Show 2026-07-19T14-30-05-000Z.sightlines"
      );
      expect(arg.mode).toBe("add");
    });

    it("migrates a legacy project-id folder before uploading", async () => {
      seedAuth();
      const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
        if (url.endsWith("/files/list_folder")) {
          const path = JSON.parse(String(init?.body)).path;
          if (path === "/backups") {
            return jsonResponse(200, {
              entries: [{ ".tag": "folder", name: "proj-1" }],
              has_more: false
            });
          }
          return jsonResponse(200, { entries: [], has_more: false });
        }
        return jsonResponse(200, {});
      });
      vi.stubGlobal("fetch", fetchMock);

      await makeProvider().uploadBackup(smallBackupInput());

      const moveCall = fetchMock.mock.calls.find(([url]) =>
        String(url).includes("/files/move_v2")
      );
      expect(JSON.parse(String(moveCall?.[1]?.body))).toEqual({
        from_path: "/backups/proj-1",
        to_path: "/backups/Winter Show — proj-1",
        autorename: false
      });
    });

    it("renames an existing readable folder when the project title changes", async () => {
      seedAuth();
      const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
        if (url.endsWith("/files/list_folder")) {
          const path = JSON.parse(String(init?.body)).path;
          if (path === "/backups") {
            return jsonResponse(200, {
              entries: [{ ".tag": "folder", name: "Old Name — proj-1" }],
              has_more: false
            });
          }
          return jsonResponse(200, { entries: [], has_more: false });
        }
        return jsonResponse(200, {});
      });
      vi.stubGlobal("fetch", fetchMock);

      await makeProvider().uploadBackup(smallBackupInput());

      const moveCall = fetchMock.mock.calls.find(([url]) =>
        String(url).includes("/files/move_v2")
      );
      expect(JSON.parse(String(moveCall?.[1]?.body))).toMatchObject({
        from_path: "/backups/Old Name — proj-1",
        to_path: "/backups/Winter Show — proj-1"
      });
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

  describe("share links", () => {
    it("requires one reconnect when the stored token predates the sharing scope", async () => {
      seedAuth({ scope: "account_info.read files.content.write files.metadata.read" });
      const provider = makeProvider();
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);

      await expect(provider.createShareLink(smallBackupInput())).rejects.toMatchObject({
        kind: "reauth",
        message: "Reconnect Dropbox once to enable project sharing."
      });
      expect(fetchMock).not.toHaveBeenCalled();
      expect(provider.getStatus()).toBe("reauthorization-required");
    });

    it("uploads a durable snapshot under shares and creates a public file link", async () => {
      seedAuth({
        scope: "account_info.read files.content.write files.metadata.read sharing.write"
      });
      let uploadedPath = "";
      const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
        if (url.includes("/files/upload")) {
          const header = (init?.headers as Record<string, string>)["Dropbox-API-Arg"];
          uploadedPath = JSON.parse(header).path;
          return jsonResponse(200, { path_display: uploadedPath });
        }
        if (url.includes("/sharing/create_shared_link_with_settings")) {
          return jsonResponse(200, {
            url: "https://www.dropbox.com/scl/fi/token/project.sightlines?rlkey=test&dl=0"
          });
        }
        return jsonResponse(200, {});
      });
      vi.stubGlobal("fetch", fetchMock);

      await expect(makeProvider().createShareLink(smallBackupInput())).resolves.toBe(
        "https://www.dropbox.com/scl/fi/token/project.sightlines?rlkey=test&dl=0"
      );
      expect(uploadedPath).toBe(
        "/shares/Winter Show — proj-1/Winter Show 2026-07-19T14-30-05-000Z.sightlines"
      );
      const shareCall = fetchMock.mock.calls.find(([url]) =>
        String(url).includes("/sharing/create_shared_link_with_settings")
      );
      expect(JSON.parse(String(shareCall?.[1]?.body))).toEqual({
        path: uploadedPath,
        settings: { requested_visibility: "public" }
      });
    });
  });

  describe("scope upgrades", () => {
    // window.location.assign is jsdom's unimplemented navigation; replace the
    // whole location object so startConnect's redirect is observable.
    function captureRedirect(): { url: () => URL } {
      const assign = vi.fn();
      vi.stubGlobal("location", {
        ...window.location,
        origin: window.location.origin,
        assign
      });
      return { url: () => new URL(String(assign.mock.calls[0]?.[0])) };
    }

    it("forces reapproval when a stored grant is missing any current scope", async () => {
      seedAuth({ scope: LEGACY_SCOPES });
      const redirect = captureRedirect();

      await makeProvider().startConnect();

      // Dropbox would otherwise skip the approval screen and hand back the old,
      // read-less grant.
      expect(redirect.url().searchParams.get("force_reapprove")).toBe("true");
      expect(redirect.url().searchParams.get("scope")).toContain(
        "files.content.read"
      );
    });

    it("does not force reapproval when the stored grant covers every scope", async () => {
      seedAuth({ scope: DROPBOX_SCOPES });
      const redirect = captureRedirect();

      await makeProvider().startConnect();

      expect(redirect.url().searchParams.get("force_reapprove")).toBeNull();
    });
  });

  describe("account identity", () => {
    afterEach(() => {
      window.sessionStorage.clear();
      window.history.replaceState(null, "", "/");
    });

    it("stores the Dropbox account id alongside the display name", async () => {
      window.sessionStorage.setItem(DROPBOX_PKCE_STATE_KEY, "state-1");
      window.sessionStorage.setItem(DROPBOX_PKCE_VERIFIER_KEY, "verifier-1");
      window.history.replaceState(
        null,
        "",
        `/${DROPBOX_CALLBACK_PATH}?code=code-1&state=state-1`
      );
      vi.stubGlobal(
        "fetch",
        vi
          .fn()
          .mockResolvedValueOnce(
            jsonResponse(200, {
              access_token: "new-access",
              refresh_token: "new-refresh",
              expires_in: 14400
            })
          )
          .mockResolvedValueOnce(
            jsonResponse(200, {
              account_id: "dbid:AAA-account",
              name: { display_name: "Ada Curator" }
            })
          )
      );

      await makeProvider().completeConnect();

      expect(readStoredAuth()?.accountId).toBe("dbid:AAA-account");
      expect(readStoredAuth()?.accountLabel).toBe("Ada Curator");
    });

    it("reads a stored record written before account ids were captured", () => {
      seedAuth();
      expect(readStoredAuth()?.accountId).toBeUndefined();
      expect(makeProvider().getStatus()).toBe("connected");
      expect(makeProvider().accountLabel()).toBe("Ada Curator");
    });
  });

  describe("listCloudProjects", () => {
    function folder(name: string) {
      return {
        ".tag": "folder",
        name,
        path_lower: `/backups/${name.toLocaleLowerCase()}`,
        path_display: `/backups/${name}`
      };
    }
    function file(folderName: string, name: string, modified: string | null, size = 1024) {
      return {
        ".tag": "file",
        name,
        id: `id:${name}`,
        rev: "0123456789abcdef",
        size,
        path_lower: `/backups/${folderName.toLocaleLowerCase()}/${name.toLocaleLowerCase()}`,
        path_display: `/backups/${folderName}/${name}`,
        ...(modified ? { server_modified: modified } : {})
      };
    }

    it("groups a recursive listing into project folders with their newest backup", async () => {
      seedAuth();
      const page1 = {
        entries: [
          folder("Winter Show — abc12345"),
          folder("Spring Show — def67890"),
          // Not written by Sightlines: no id suffix, so it is not a project.
          folder("Scratch Notes"),
          file("Winter Show — abc12345", "Winter Show A.sightlines", "2026-07-01T00:00:00Z")
        ],
        has_more: true,
        cursor: "CURSOR"
      };
      const page2 = {
        entries: [
          file("Winter Show — abc12345", "Winter Show B.sightlines", "2026-08-01T00:00:00Z", 4096),
          // A stray non-package file is not a backup.
          file("Winter Show — abc12345", "notes.txt", "2026-09-01T00:00:00Z"),
          file("Spring Show — def67890", "Spring Show A.sightlines", "2026-06-01T00:00:00Z"),
          file("Scratch Notes", "loose.sightlines", "2026-12-01T00:00:00Z")
        ],
        has_more: false
      };
      const fetchMock = vi.fn(async (url: string, _init?: RequestInit) => {
        if (url.endsWith("/files/list_folder")) return jsonResponse(200, page1);
        if (url.includes("/files/list_folder/continue")) return jsonResponse(200, page2);
        return jsonResponse(200, {});
      });
      vi.stubGlobal("fetch", fetchMock);

      const projects = await makeProvider().listCloudProjects();

      const listCall = fetchMock.mock.calls.find(([url]) =>
        String(url).endsWith("/files/list_folder")
      );
      expect(JSON.parse(String(listCall?.[1]?.body))).toEqual({
        path: "/backups",
        recursive: true
      });
      // Newest backup first; the unparseable folder is dropped entirely.
      expect(projects.map((project) => project.folderName)).toEqual([
        "Winter Show — abc12345",
        "Spring Show — def67890"
      ]);
      expect(projects[0]).toMatchObject({
        title: "Winter Show",
        projectIdPrefix: "abc12345",
        backupCount: 2
      });
      expect(projects[0].latestBackup).toEqual({
        path: "/backups/winter show — abc12345/winter show b.sightlines",
        name: "Winter Show B.sightlines",
        serverModifiedIso: "2026-08-01T00:00:00Z",
        sizeBytes: 4096
      });
    });

    it("sorts a folder with no backups last and tolerates a missing timestamp", async () => {
      seedAuth();
      vi.stubGlobal(
        "fetch",
        vi.fn(async (url: string) => {
          if (url.endsWith("/files/list_folder")) {
            return jsonResponse(200, {
              entries: [
                folder("Empty Show — 11111111"),
                folder("Undated Show — 22222222"),
                folder("Dated Show — 33333333"),
                file("Undated Show — 22222222", "u.sightlines", null),
                file("Dated Show — 33333333", "d.sightlines", "2026-05-01T00:00:00Z")
              ],
              has_more: false
            });
          }
          return jsonResponse(200, {});
        })
      );

      const projects = await makeProvider().listCloudProjects();

      expect(projects.map((project) => project.projectIdPrefix)).toEqual([
        "33333333",
        "22222222",
        "11111111"
      ]);
      expect(projects[1].latestBackup?.serverModifiedIso).toBeNull();
      expect(projects[2].latestBackup).toBeNull();
      expect(projects[2].backupCount).toBe(0);
    });

    it("returns an empty list when /backups does not exist yet", async () => {
      seedAuth();
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => jsonResponse(409, { error_summary: "path/not_found/." }))
      );

      await expect(makeProvider().listCloudProjects()).resolves.toEqual([]);
    });

    it("requires one reconnect when the stored token predates the read scope", async () => {
      seedAuth({ scope: LEGACY_SCOPES });
      const provider = makeProvider();
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);

      await expect(provider.listCloudProjects()).rejects.toMatchObject({
        kind: "reauth",
        message: "Reconnect Dropbox once to browse cloud backups."
      });
      expect(fetchMock).not.toHaveBeenCalled();
      expect(provider.getStatus()).toBe("reauthorization-required");
    });
  });

  describe("downloadBackup", () => {
    function binaryResponse(
      bytes: Uint8Array,
      headers: Record<string, string> = {}
    ): Response {
      return new Response(bytes as unknown as BodyInit, { status: 200, headers });
    }

    it("posts the path in Dropbox-API-Arg and returns the raw bytes", async () => {
      seedAuth();
      const payload = new Uint8Array([80, 75, 3, 4, 9]);
      const fetchMock = vi.fn(async (url: string, _init?: RequestInit) => {
        if (url.includes("/files/download")) return binaryResponse(payload);
        return jsonResponse(200, {});
      });
      vi.stubGlobal("fetch", fetchMock);

      const bytes = await makeProvider().downloadBackup(
        "/backups/Étude — abc12345/Étude A.sightlines"
      );

      expect(Array.from(bytes)).toEqual([80, 75, 3, 4, 9]);
      const call = fetchMock.mock.calls.find(([url]) =>
        String(url).includes("/files/download")
      );
      expect(String(call?.[0])).toBe(
        "https://content.dropboxapi.com/2/files/download"
      );
      const header = (call![1]!.headers as Record<string, string>)["Dropbox-API-Arg"];
      // The header must be a byte string even for a non-ASCII path.
      expect(header).not.toMatch(/[^\x20-\x7e]/);
      expect(JSON.parse(header)).toEqual({
        path: "/backups/Étude — abc12345/Étude A.sightlines"
      });
    });

    it("classifies a deleted backup as not-found rather than a retryable failure", async () => {
      seedAuth();
      vi.stubGlobal(
        "fetch",
        vi.fn(async () =>
          // Content endpoints answer with plain text, not JSON.
          new Response("path/not_found/..", { status: 409 })
        )
      );

      const error = await makeProvider()
        .downloadBackup("/backups/Gone — abc12345/gone.sightlines")
        .catch((e) => e);
      expect(error).toBeInstanceOf(CloudBackupError);
      expect(error.kind).toBe("not-found");
    });

    it("refuses an implausibly large download on the declared length alone", async () => {
      seedAuth();
      const fetchMock = vi.fn(async () =>
        binaryResponse(new Uint8Array([1]), {
          "Content-Length": String(MAX_BACKUP_DOWNLOAD_BYTES + 1)
        })
      );
      vi.stubGlobal("fetch", fetchMock);

      const error = await makeProvider()
        .downloadBackup("/backups/Huge — abc12345/huge.sightlines")
        .catch((e) => e);
      expect(error.kind).toBe("too-large");
    });

    it("flips to reauthorization-required when the token is rejected mid-download", async () => {
      seedAuth();
      const provider = makeProvider();
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => new Response("expired_access_token/", { status: 401 }))
      );

      await expect(
        provider.downloadBackup("/backups/Winter Show — abc12345/w.sightlines")
      ).rejects.toMatchObject({ kind: "reauth" });
      expect(provider.getStatus()).toBe("reauthorization-required");
    });

    it("requires one reconnect when the stored token predates the read scope", async () => {
      seedAuth({ scope: LEGACY_SCOPES });
      const provider = makeProvider();
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);

      await expect(provider.downloadBackup("/backups/a/b.sightlines")).rejects.toMatchObject({
        kind: "reauth"
      });
      expect(fetchMock).not.toHaveBeenCalled();
      expect(provider.getStatus()).toBe("reauthorization-required");
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
          return jsonResponse(200, { entries: [], has_more: false });
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
          return jsonResponse(200, { entries: [], has_more: false });
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
      expect(readStoredAuth()?.scope).toContain("sharing.write");
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
