import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchDropboxSharedPackage } from "./fetchDropboxShare";

const dropboxUrl =
  "https://www.dropbox.com/scl/fi/token/project.sightlines?rlkey=secret&dl=0";

describe("fetchDropboxSharedPackage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("downloads through the same-origin relay", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(new Uint8Array([80, 75, 3, 4]), { status: 200 })
    );
    vi.stubGlobal("fetch", fetchMock);

    const bytes = await fetchDropboxSharedPackage(dropboxUrl);

    expect(Array.from(new Uint8Array(bytes))).toEqual([80, 75, 3, 4]);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/dropbox-share",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ url: dropboxUrl })
      })
    );
  });

  it("explains when the sender removed the Dropbox snapshot", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 404 })));
    await expect(fetchDropboxSharedPackage(dropboxUrl)).rejects.toThrow(
      "This shared project is no longer available in Dropbox. Ask the sender to create a new link."
    );
  });

  it("rejects an oversized declared response before reading it", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(new Uint8Array([1]), {
            headers: { "Content-Length": String(256 * 1024 * 1024 + 1) }
          })
      )
    );
    await expect(fetchDropboxSharedPackage(dropboxUrl)).rejects.toThrow(
      "This shared project is too large to open in Sightlines."
    );
  });
});
