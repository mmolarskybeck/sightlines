const DROPBOX_SHARE_HOST = "www.dropbox.com";

export const DROPBOX_SHARE_PROXY_PATH = "/api/dropbox-share";

export function isDropboxFileShareUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }

  if (
    url.protocol !== "https:" ||
    url.hostname !== DROPBOX_SHARE_HOST ||
    url.port !== ""
  ) return false;
  if (!(url.pathname.startsWith("/scl/fi/") || url.pathname.startsWith("/s/"))) {
    return false;
  }
  return url.pathname.toLowerCase().endsWith(".sightlines");
}

export function asDropboxDownloadUrl(value: string): string {
  if (!isDropboxFileShareUrl(value)) {
    throw new Error("That link is not a supported Dropbox file share.");
  }
  const url = new URL(value);
  url.searchParams.delete("raw");
  url.searchParams.set("dl", "1");
  return url.toString();
}

export function buildSightlinesDropboxShareUrl(
  dropboxUrl: string,
  appRootUrl: string
): string {
  if (!isDropboxFileShareUrl(dropboxUrl)) {
    throw new Error("Dropbox returned an unsupported share link.");
  }
  const root = new URL(appRootUrl);
  const basePath = root.pathname.endsWith("/") ? root.pathname : `${root.pathname}/`;
  const url = new URL(`${basePath}share`, root.origin);
  url.hash = new URLSearchParams({ provider: "dropbox", url: dropboxUrl }).toString();
  return url.toString();
}

export function readDropboxShareUrl(locationUrl: string): string | null {
  const url = new URL(locationUrl);
  if (!url.pathname.endsWith("/share")) return null;
  const params = new URLSearchParams(url.hash.replace(/^#/, ""));
  if (params.get("provider") !== "dropbox") return null;
  const dropboxUrl = params.get("url");
  return dropboxUrl && isDropboxFileShareUrl(dropboxUrl) ? dropboxUrl : null;
}
