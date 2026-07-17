// Turns raw bytes into a browser download. The only DOM-bound step in the
// package export path — the manifest/zip derivation is pure domain code.
export function triggerDownload(data: Blob | Uint8Array, filename: string) {
  const blob =
    data instanceof Blob
      ? data
      : // Fresh copy: Blob wants a plain ArrayBuffer, and a fflate Uint8Array
        // may be a view into a larger pooled buffer.
        new Blob([data.slice()], { type: "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
