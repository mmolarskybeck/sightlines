import { describe, expect, it } from "vitest";
import {
  asDropboxDownloadUrl,
  buildSightlinesDropboxShareUrl,
  isDropboxFileShareUrl,
  readDropboxShareUrl
} from "./dropboxShare";

const dropboxUrl =
  "https://www.dropbox.com/scl/fi/token/project.sightlines?rlkey=secret&dl=0";

describe("Dropbox share URLs", () => {
  it("accepts only Dropbox file-share URLs", () => {
    expect(isDropboxFileShareUrl(dropboxUrl)).toBe(true);
    expect(isDropboxFileShareUrl("https://www.dropbox.com/s/legacy/project.sightlines?dl=0")).toBe(
      true
    );
    expect(isDropboxFileShareUrl("https://evil.example/scl/fi/token/project.sightlines")).toBe(
      false
    );
    expect(isDropboxFileShareUrl("https://www.dropbox.com/home/project.sightlines")).toBe(false);
    expect(isDropboxFileShareUrl("http://www.dropbox.com/s/token/project.sightlines")).toBe(false);
    expect(isDropboxFileShareUrl("https://www.dropbox.com/s/token/photo.jpg")).toBe(false);
    expect(isDropboxFileShareUrl("https://www.dropbox.com:444/s/token/project.sightlines")).toBe(
      false
    );
  });

  it("forces a file download without discarding the Dropbox link key", () => {
    const result = new URL(asDropboxDownloadUrl(`${dropboxUrl}&raw=1`));
    expect(result.searchParams.get("dl")).toBe("1");
    expect(result.searchParams.get("raw")).toBeNull();
    expect(result.searchParams.get("rlkey")).toBe("secret");
  });

  it("round-trips through a Sightlines fragment so the Dropbox URL is not in the request path", () => {
    const shared = buildSightlinesDropboxShareUrl(dropboxUrl, "https://app.sightlines.art/");
    const parsed = new URL(shared);
    expect(parsed.origin + parsed.pathname).toBe("https://app.sightlines.art/share");
    expect(parsed.search).toBe("");
    expect(readDropboxShareUrl(shared)).toBe(dropboxUrl);
  });

  it("ignores malformed or unrelated Sightlines links", () => {
    expect(readDropboxShareUrl("https://app.sightlines.art/#provider=dropbox")).toBeNull();
    expect(
      readDropboxShareUrl(
        "https://app.sightlines.art/share#provider=dropbox&url=https%3A%2F%2Fevil.example%2Fx"
      )
    ).toBeNull();
  });
});
