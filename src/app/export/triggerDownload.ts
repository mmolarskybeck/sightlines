export type DownloadOutcome = "saved" | "cancelled";

// Chromium's save-picker API; not yet in TypeScript's DOM lib everywhere.
interface SaveFilePickerWindow {
  showSaveFilePicker?: (options: {
    suggestedName?: string;
  }) => Promise<FileSystemFileHandle>;
}

// Turns raw bytes into a browser download. The only DOM-bound step in the
// package export path — the manifest/zip derivation is pure domain code.
export async function triggerDownload(
  data: Blob | Uint8Array,
  filename: string
): Promise<DownloadOutcome> {
  const blob =
    data instanceof Blob
      ? data
      : // Fresh copy: Blob wants a plain ArrayBuffer, and a fflate Uint8Array
        // may be a view into a larger pooled buffer.
        new Blob([data.slice()], { type: "application/octet-stream" });

  // Prefer the save picker where available: unlike the anchor fallback it
  // reports a cancelled dialog, so callers can skip their "Exported" toast.
  // Skipped under automation (navigator.webdriver) — Playwright captures the
  // anchor path's download events and cannot dismiss a native picker.
  const showSaveFilePicker = (window as SaveFilePickerWindow).showSaveFilePicker;
  if (showSaveFilePicker && !navigator.webdriver) {
    try {
      const handle = await showSaveFilePicker({ suggestedName: filename });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return "saved";
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return "cancelled";
      }
      // Anything else — most likely SecurityError because a slow export
      // outlived the click's transient user activation — falls through to
      // the anchor download, which needs no activation.
    }
  }

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
  return "saved";
}
