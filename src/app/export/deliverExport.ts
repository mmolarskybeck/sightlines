import { toast } from "sonner";
import { triggerDownload } from "./triggerDownload";

export type DeliverExportOutcome = "delivered" | "cancelled";

export type DeliverExportOptions = {
  data: Blob | Uint8Array;
  filename: string;
  // Handed to the save picker's `types` filter. On Windows, with "Hide
  // extensions for known file types" on, a picker with no matching file-type
  // entry strips the extension from the suggested name and nothing re-adds it,
  // so callers should keep naming the real type here.
  mimeType?: string;
  description?: string;
  warnings?: string[];
  // Runs once bytes were actually delivered, before any toast — the dialog
  // close / telemetry step some callers put between the cancel check and the
  // confirmation toast.
  onDelivered?: () => void;
};

// The shared delivery tail of every export handler: hand the bytes to the save
// picker, stay silent when the user dismissed it, and otherwise confirm with
// either the warning roll-up or the plain success toast. Failures propagate —
// each caller's own catch owns its plain-language error copy.
export async function deliverExport({
  data,
  filename,
  mimeType,
  description,
  warnings = [],
  onDelivered
}: DeliverExportOptions): Promise<DeliverExportOutcome> {
  const outcome = await triggerDownload(
    data,
    filename,
    mimeType ? { mimeType, description } : undefined
  );
  // The user dismissed the save dialog — no file, no toast.
  if (outcome === "cancelled") return "cancelled";

  onDelivered?.();

  if (warnings.length > 0) {
    toast.warning(
      `Exported ${filename} with ${warnings.length} warning${
        warnings.length === 1 ? "" : "s"
      }: ${warnings.join(" ")}`
    );
  } else {
    toast.success(`Exported ${filename}`);
  }
  return "delivered";
}
