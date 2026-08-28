export type DownloadOutcome = "saved" | "cancelled";

// Extra type info for the save picker (and the anchor fallback's Blob, when
// callers hand us raw bytes). Optional: callers that already construct a
// typed Blob only need this for the picker's `types` filter.
export type DownloadTypeOptions = {
  // The MIME type to offer the save picker and, when `data` is a raw
  // Uint8Array, to stamp on the Blob we wrap it in.
  mimeType: string;
  // Shown next to the extension in the picker's file-type dropdown. Falls
  // back to a generic label derived from the extension.
  description?: string;
};

// Chromium's save-picker API; not yet in TypeScript's DOM lib everywhere.
interface SaveFilePickerWindow {
  showSaveFilePicker?: (options: {
    suggestedName?: string;
    types?: Array<{
      description?: string;
      accept: Record<string, string[]>;
    }>;
    excludeAcceptAllOption?: boolean;
  }) => Promise<FileSystemFileHandle>;
}

// Falls back to this when a caller passes raw bytes with no type info, and
// when a filename's extension isn't in EXTENSION_MIME_TYPES below.
const DEFAULT_MIME_TYPE = "application/octet-stream";

// Small extension -> MIME map so callers that only have raw bytes (no typed
// Blob, no explicit DownloadTypeOptions) still get a real `types` filter
// instead of falling back to the wildcard octet-stream one. Callers that
// already construct a typed Blob, or pass DownloadTypeOptions explicitly,
// take precedence over this.
const EXTENSION_MIME_TYPES: Record<string, string> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  csv: "text/csv",
  zip: "application/zip",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  // Custom container: a zip under the hood, but not a `.zip` file — Windows
  // won't recognize the extension as a "known type" either way, so this is
  // mostly for the picker's own bookkeeping.
  sightlines: DEFAULT_MIME_TYPE
};

function extensionOf(filename: string): string | null {
  const dot = filename.lastIndexOf(".");
  if (dot < 0 || dot === filename.length - 1) return null;
  return filename.slice(dot + 1).toLowerCase();
}

// Derives the save-picker `types` entry from a filename + MIME type. The
// accept map's extension list always includes the filename's own extension
// (lowercased) so the picker's filter actually matches the suggested name —
// that's what stops Windows from treating it as "no known type" and
// stripping the extension from the name box. `image/jpeg` additionally gets
// both common spellings so a .jpeg suggestion still matches.
function buildAccept(filename: string, mimeType: string): Record<string, string[]> {
  const ext = extensionOf(filename);
  const extensions = ext ? [`.${ext}`] : [];
  if (mimeType === "image/jpeg" && ext === "jpg") extensions.push(".jpeg");
  return { [mimeType]: extensions };
}

function describeFromExtension(filename: string): string {
  const ext = extensionOf(filename);
  return ext ? `${ext.toUpperCase()} file` : "File";
}

// Resolves the MIME type to use, in priority order: an explicit
// DownloadTypeOptions.mimeType, then a Blob's own (non-empty) type, then the
// extension map above, then the generic fallback.
function resolveMimeType(
  data: Blob | Uint8Array,
  filename: string,
  options?: DownloadTypeOptions
): string {
  if (options?.mimeType) return options.mimeType;
  if (data instanceof Blob && data.type) return data.type;
  const ext = extensionOf(filename);
  if (ext && EXTENSION_MIME_TYPES[ext]) return EXTENSION_MIME_TYPES[ext];
  return DEFAULT_MIME_TYPE;
}

// Turns raw bytes into a browser download. The only DOM-bound step in the
// package export path — the manifest/zip derivation is pure domain code.
export async function triggerDownload(
  data: Blob | Uint8Array,
  filename: string,
  options?: DownloadTypeOptions
): Promise<DownloadOutcome> {
  const mimeType = resolveMimeType(data, filename, options);
  const blob =
    data instanceof Blob
      ? data
      : // Fresh copy: Blob wants a plain ArrayBuffer, and a fflate Uint8Array
        // may be a view into a larger pooled buffer.
        new Blob([data.slice()], { type: mimeType });

  // Prefer the save picker where available: unlike the anchor fallback it
  // reports a cancelled dialog, so callers can skip their "Exported" toast.
  // Skipped under automation (navigator.webdriver) — Playwright captures the
  // anchor path's download events and cannot dismiss a native picker.
  const showSaveFilePicker = (window as SaveFilePickerWindow).showSaveFilePicker;
  if (showSaveFilePicker && !navigator.webdriver) {
    try {
      const handle = await showSaveFilePicker({
        suggestedName: filename,
        // A real accept filter, not the wildcard-only default: on Windows,
        // with "Hide extensions for known file types" on, a save dialog with
        // no file-type filter strips the suggested name's extension and
        // nothing re-adds it. Naming the type here is what keeps it.
        types: [
          {
            description: options?.description ?? describeFromExtension(filename),
            accept: buildAccept(filename, mimeType)
          }
        ]
      });
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
