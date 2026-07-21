import { describe, expect, it } from "vitest";
import {
  base64UrlEncode,
  buildAuthorizeUrl,
  buildBackupPath,
  buildRefreshBody,
  classifyApiError,
  computeS256Challenge,
  filesystemSafeTimestamp,
  generateRandomString,
  isReauthorizationFailure,
  parseRetryAfterMs,
  projectFolderPath,
  sanitizeDropboxTitle,
  selectBackupsToPrune,
  type DropboxFileEntry
} from "./dropboxAuth";

describe("dropbox PKCE helpers", () => {
  it("base64url-encodes without padding or +/ characters", () => {
    const encoded = base64UrlEncode(new Uint8Array([251, 255, 191, 0, 1, 2]));
    expect(encoded).not.toMatch(/[+/=]/);
  });

  it("generates distinct high-entropy strings", () => {
    const a = generateRandomString();
    const b = generateRandomString();
    expect(a).not.toEqual(b);
    expect(a.length).toBeGreaterThan(40);
  });

  it("computes a stable S256 challenge for a verifier", async () => {
    const challenge1 = await computeS256Challenge("verifier-fixed");
    const challenge2 = await computeS256Challenge("verifier-fixed");
    const other = await computeS256Challenge("verifier-other");
    expect(challenge1).toEqual(challenge2);
    expect(challenge1).not.toEqual(other);
    expect(challenge1).not.toMatch(/[+/=]/);
  });

  it("builds an authorize URL with S256, offline, scopes, and identical redirect_uri", () => {
    const url = new URL(
      buildAuthorizeUrl({
        clientId: "abc123",
        redirectUri: "https://app.sightlines.art/",
        codeChallenge: "CHALLENGE",
        state: "STATE"
      })
    );
    const params = url.searchParams;
    expect(url.origin + url.pathname).toBe("https://www.dropbox.com/oauth2/authorize");
    expect(params.get("client_id")).toBe("abc123");
    expect(params.get("response_type")).toBe("code");
    expect(params.get("redirect_uri")).toBe("https://app.sightlines.art/");
    expect(params.get("code_challenge")).toBe("CHALLENGE");
    expect(params.get("code_challenge_method")).toBe("S256");
    expect(params.get("token_access_type")).toBe("offline");
    expect(params.get("state")).toBe("STATE");
    expect(params.get("scope")).toContain("files.content.write");
  });

  it("builds a refresh body with client_id only (no secret)", () => {
    const body = buildRefreshBody({ refreshToken: "r-token", clientId: "abc123" });
    expect(body.get("grant_type")).toBe("refresh_token");
    expect(body.get("refresh_token")).toBe("r-token");
    expect(body.get("client_id")).toBe("abc123");
    expect(body.get("client_secret")).toBeNull();
  });
});

describe("dropbox error classification", () => {
  it("treats 400/401 invalid_grant as reauthorization", () => {
    expect(isReauthorizationFailure(400, { error: "invalid_grant" })).toBe(true);
    expect(isReauthorizationFailure(401, { error: "invalid_grant" })).toBe(true);
    expect(isReauthorizationFailure(400, { error: "invalid_request" })).toBe(false);
    expect(isReauthorizationFailure(500, { error: "invalid_grant" })).toBe(false);
  });

  it("classifies API errors: 401 reauth, 429 rate-limit, insufficient_space quota, else transient", () => {
    expect(classifyApiError(401, {})).toBe("reauth");
    expect(classifyApiError(429, {})).toBe("rate-limit");
    expect(
      classifyApiError(507, { error_summary: "insufficient_space/..." })
    ).toBe("quota");
    expect(classifyApiError(500, {})).toBe("transient");
    expect(classifyApiError(409, { error: "invalid_grant" })).toBe("transient");
  });

  it("parses Retry-After seconds and dates, null otherwise", () => {
    expect(parseRetryAfterMs("30")).toBe(30_000);
    expect(parseRetryAfterMs(null)).toBeNull();
    expect(parseRetryAfterMs("not-a-date")).toBeNull();
    const now = Date.parse("2026-07-19T00:00:00Z");
    expect(parseRetryAfterMs("Sun, 19 Jul 2026 00:00:10 GMT", now)).toBe(10_000);
  });
});

describe("dropbox path construction", () => {
  it("sanitizes titles, stripping illegal path characters", () => {
    expect(sanitizeDropboxTitle('My/Show: "Winter" <2026>')).toBe("My Show Winter 2026");
    expect(sanitizeDropboxTitle("   ")).toBe("Untitled");
    expect(sanitizeDropboxTitle("Plain Title")).toBe("Plain Title");
  });

  it("makes filesystem-safe timestamps", () => {
    expect(filesystemSafeTimestamp("2026-07-19T14:30:05.123Z")).toBe(
      "2026-07-19T14-30-05-123Z"
    );
  });

  it("uses a readable folder with a short stable project id", () => {
    const path = buildBackupPath({
      projectId: "proj-abc-123",
      projectTitle: "Winter Show",
      timestampIso: "2026-07-19T14:30:05.000Z"
    });
    expect(path).toBe(
      "/backups/Winter Show — proj-abc/Winter Show 2026-07-19T14-30-05-000Z.sightlines"
    );
    expect(projectFolderPath("proj-abc-123", "Winter Show")).toBe(
      "/backups/Winter Show — proj-abc"
    );
  });

  it("reflects the current title while keeping the same identity suffix", () => {
    const a = buildBackupPath({
      projectId: "same-id",
      projectTitle: "Old Name",
      timestampIso: "2026-07-19T00:00:00.000Z"
    });
    const b = buildBackupPath({
      projectId: "same-id",
      projectTitle: "New Name",
      timestampIso: "2026-07-20T00:00:00.000Z"
    });
    expect(a.startsWith("/backups/Old Name — same-id/")).toBe(true);
    expect(b.startsWith("/backups/New Name — same-id/")).toBe(true);
  });
});

describe("retention selection", () => {
  function entry(name: string, modified: string): DropboxFileEntry {
    return {
      ".tag": "file",
      name,
      path_lower: `/backups/p/${name.toLowerCase()}`,
      server_modified: modified
    };
  }

  it("returns nothing when at or under the cap", () => {
    const entries = [
      entry("a", "2026-07-01T00:00:00Z"),
      entry("b", "2026-07-02T00:00:00Z")
    ];
    expect(selectBackupsToPrune(entries, 5)).toEqual([]);
  });

  it("prunes the oldest beyond the cap, keeping the newest", () => {
    const entries = [
      entry("f", "2026-07-06T00:00:00Z"),
      entry("a", "2026-07-01T00:00:00Z"),
      entry("c", "2026-07-03T00:00:00Z"),
      entry("b", "2026-07-02T00:00:00Z"),
      entry("e", "2026-07-05T00:00:00Z"),
      entry("d", "2026-07-04T00:00:00Z")
    ];
    // keep 5 newest (b..f), prune the single oldest (a).
    expect(selectBackupsToPrune(entries, 5)).toEqual(["/backups/p/a"]);
  });

  it("ignores folder entries", () => {
    const entries: DropboxFileEntry[] = [
      { ".tag": "folder", name: "sub", server_modified: "2026-07-01T00:00:00Z" },
      entry("a", "2026-07-01T00:00:00Z")
    ];
    expect(selectBackupsToPrune(entries, 0)).toEqual(["/backups/p/a"]);
  });
});
