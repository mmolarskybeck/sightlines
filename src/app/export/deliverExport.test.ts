import { beforeEach, describe, expect, it, vi } from "vitest";
import { deliverExport } from "./deliverExport";
import { triggerDownload } from "./triggerDownload";
import { toast } from "sonner";

vi.mock("./triggerDownload", () => ({
  triggerDownload: vi.fn()
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    warning: vi.fn(),
    error: vi.fn()
  }
}));

const triggerDownloadMock = vi.mocked(triggerDownload);

beforeEach(() => {
  vi.clearAllMocks();
  triggerDownloadMock.mockResolvedValue("saved");
});

describe("deliverExport", () => {
  it("downloads with the caller's type info and confirms with a plain success toast", async () => {
    const bytes = new Blob(["%PDF"], { type: "application/pdf" });
    const outcome = await deliverExport({
      data: bytes,
      filename: "My Show.pdf",
      mimeType: "application/pdf",
      description: "PDF document"
    });

    expect(outcome).toBe("delivered");
    expect(triggerDownloadMock).toHaveBeenCalledWith(bytes, "My Show.pdf", {
      mimeType: "application/pdf",
      description: "PDF document"
    });
    expect(toast.success).toHaveBeenCalledWith("Exported My Show.pdf");
    expect(toast.warning).not.toHaveBeenCalled();
  });

  it("omits the type options entirely when the caller gave no mime type", async () => {
    await deliverExport({ data: new Blob(["x"]), filename: "Plan.png" });

    expect(triggerDownloadMock).toHaveBeenCalledWith(
      expect.any(Blob),
      "Plan.png",
      undefined
    );
  });

  it("rolls one warning up in the singular", async () => {
    await deliverExport({
      data: new Blob(["x"]),
      filename: "My Show.sightlines",
      warnings: ["One image was missing."]
    });

    expect(toast.warning).toHaveBeenCalledWith(
      "Exported My Show.sightlines with 1 warning: One image was missing."
    );
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("pluralises and joins several warnings", async () => {
    await deliverExport({
      data: new Blob(["x"]),
      filename: "My Show.xlsx",
      warnings: ["One image was missing.", "A credit line was empty."]
    });

    expect(toast.warning).toHaveBeenCalledWith(
      "Exported My Show.xlsx with 2 warnings: One image was missing. A credit line was empty."
    );
  });

  it("stays silent when the user dismisses the save dialog", async () => {
    triggerDownloadMock.mockResolvedValue("cancelled");
    const onDelivered = vi.fn();

    const outcome = await deliverExport({
      data: new Blob(["x"]),
      filename: "My Show.pdf",
      warnings: ["One image was missing."],
      onDelivered
    });

    expect(outcome).toBe("cancelled");
    expect(onDelivered).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.warning).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("runs onDelivered before the toast, on both the clean and the warning path", async () => {
    const calls: string[] = [];
    const onDelivered = vi.fn(() => calls.push("delivered"));
    vi.mocked(toast.success).mockImplementation(() => {
      calls.push("toast");
      return "";
    });
    vi.mocked(toast.warning).mockImplementation(() => {
      calls.push("toast");
      return "";
    });

    await deliverExport({ data: new Blob(["x"]), filename: "a.pdf", onDelivered });
    await deliverExport({
      data: new Blob(["x"]),
      filename: "b.pdf",
      warnings: ["Something."],
      onDelivered
    });

    expect(calls).toEqual(["delivered", "toast", "delivered", "toast"]);
  });

  it("propagates a download failure without toasting — the caller owns its error copy", async () => {
    triggerDownloadMock.mockRejectedValue(new Error("disk full"));
    const onDelivered = vi.fn();

    await expect(
      deliverExport({ data: new Blob(["x"]), filename: "My Show.pdf", onDelivered })
    ).rejects.toThrow("disk full");
    expect(onDelivered).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
  });
});
