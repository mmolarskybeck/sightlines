import { DROPBOX_SHARE_PROXY_PATH, isDropboxFileShareUrl } from "./dropboxShare";

const MAX_SHARED_PACKAGE_BYTES = 256 * 1024 * 1024;

async function readBoundedResponse(response: Response): Promise<ArrayBuffer> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_SHARED_PACKAGE_BYTES) {
    throw new Error("This shared project is too large to open in Sightlines.");
  }
  if (!response.body) {
    throw new Error("Sightlines could not download this project from Dropbox.");
  }

  const chunks: Uint8Array[] = [];
  const reader = response.body.getReader();
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_SHARED_PACKAGE_BYTES) {
        await reader.cancel();
        throw new Error("This shared project is too large to open in Sightlines.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes.buffer;
}

export async function fetchDropboxSharedPackage(
  dropboxUrl: string,
  signal?: AbortSignal
): Promise<ArrayBuffer> {
  if (!isDropboxFileShareUrl(dropboxUrl)) {
    throw new Error("This is not a supported Dropbox project link.");
  }
  const response = await fetch(DROPBOX_SHARE_PROXY_PATH, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: dropboxUrl }),
    signal
  });
  if (!response.ok) {
    if (response.status === 404) {
      throw new Error(
        "This shared project is no longer available in Dropbox. Ask the sender to create a new link."
      );
    }
    if (response.status === 413) {
      throw new Error("This shared project is too large to open in Sightlines.");
    }
    throw new Error("Sightlines could not download this project from Dropbox.");
  }
  return readBoundedResponse(response);
}
