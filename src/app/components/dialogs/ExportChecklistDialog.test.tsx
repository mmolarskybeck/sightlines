import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ExportChecklistDialog } from "./ExportChecklistDialog";

// Radix Select needs pointer-capture and a real listbox to open; the dialog only
// cares that the trigger reports the current value and that picking an option
// calls onValueChange, so it is stubbed exactly as ExportPdfDialog's test does.
vi.mock("../ui/select", async () => {
  const { createContext, useContext } = await import("react");
  const Context = createContext<{
    value?: string;
    onValueChange?: (value: string) => void;
  }>({});
  return {
    Select: ({
      value,
      onValueChange,
      children
    }: {
      value?: string;
      onValueChange?: (value: string) => void;
      children: React.ReactNode;
    }) => (
      <Context.Provider value={{ value, onValueChange }}>{children}</Context.Provider>
    ),
    SelectTrigger: ({ children, ...props }: React.ComponentProps<"button">) => (
      <button type="button" role="combobox" {...props}>
        {children}
      </button>
    ),
    SelectValue: () => <span>{useContext(Context).value}</span>,
    SelectContent: ({ children }: { children: React.ReactNode }) => (
      <div role="listbox">{children}</div>
    ),
    SelectItem: ({
      children,
      value
    }: {
      children: React.ReactNode;
      value: string;
    }) => {
      const context = useContext(Context);
      return (
        <button role="option" type="button" onClick={() => context.onValueChange?.(value)}>
          {children}
        </button>
      );
    }
  };
});

beforeAll(() => {
  const proto = window.HTMLElement.prototype;
  proto.hasPointerCapture = vi.fn();
  proto.setPointerCapture = vi.fn();
  proto.releasePointerCapture = vi.fn();
  proto.scrollIntoView = vi.fn();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderDialog(overrides: Partial<React.ComponentProps<typeof ExportChecklistDialog>> = {}) {
  const onExport = vi.fn();
  const onOpenChange = vi.fn();
  render(
    <ExportChecklistDialog
      open
      checklistCount={4}
      placedCount={2}
      onExport={onExport}
      onOpenChange={onOpenChange}
      {...overrides}
    />
  );
  return { onExport, onOpenChange };
}

function pickOption(label: string, optionLabel: string) {
  // The stubbed listbox renders next to its trigger inside the same field label.
  const field = screen.getByRole("combobox", { name: label }).closest("label");
  fireEvent.click(within(field as HTMLElement).getByRole("option", { name: optionLabel }));
}

describe("ExportChecklistDialog", () => {
  it("defaults to the PDF checklist", () => {
    const { onExport } = renderDialog();

    fireEvent.click(screen.getByRole("button", { name: "Export checklist" }));

    expect(onExport).toHaveBeenCalledWith({
      kind: "pdf",
      options: {
        format: "pdf",
        sort: "project",
        placedOnly: false,
        numbering: false,
        accession: false,
        location: true
      }
    });
  });

  it("passes every chosen PDF option through to the export action", () => {
    const { onExport } = renderDialog();

    pickOption("Sort by", "Placement (room, wall)");
    fireEvent.click(screen.getByRole("switch", { name: "Placed works only" }));
    fireEvent.click(screen.getByRole("switch", { name: "Show numbering" }));
    fireEvent.click(screen.getByRole("switch", { name: "Show accession number" }));
    fireEvent.click(screen.getByRole("switch", { name: "Show location" }));
    fireEvent.click(screen.getByRole("button", { name: "Export checklist" }));

    expect(onExport).toHaveBeenCalledWith({
      kind: "pdf",
      options: {
        format: "pdf",
        sort: "placement",
        placedOnly: true,
        numbering: true,
        accession: true,
        location: false
      }
    });
  });

  it("passes every chosen spreadsheet option through to the export action", () => {
    const { onExport } = renderDialog();

    pickOption("Format", "CSV");
    pickOption("Images", "Original files");
    pickOption("Sort by", "Placement (room, wall)");
    fireEvent.click(screen.getByRole("switch", { name: "Placed works only" }));
    fireEvent.click(screen.getByRole("button", { name: "Export checklist" }));

    expect(onExport).toHaveBeenCalledWith({
      kind: "spreadsheet",
      options: {
        format: "csv",
        images: "originals",
        sort: "placement",
        placedOnly: true
      }
    });
  });

  // The whole reason this is one dialog and not two menu items: the two
  // questions both formats ask must be one piece of state.
  it("keeps sort and the placed-only filter when the format changes", () => {
    const { onExport } = renderDialog();

    pickOption("Sort by", "Artist");
    fireEvent.click(screen.getByRole("switch", { name: "Placed works only" }));
    pickOption("Format", "Excel (.xlsx)");
    fireEvent.click(screen.getByRole("button", { name: "Export checklist" }));

    expect(onExport).toHaveBeenCalledWith({
      kind: "spreadsheet",
      options: {
        format: "xlsx",
        images: "display",
        sort: "artist",
        placedOnly: true
      }
    });
  });

  it("shows only the controls the chosen format actually uses", () => {
    renderDialog();

    expect(screen.queryByRole("combobox", { name: "Images" })).toBeNull();
    expect(screen.getByRole("switch", { name: "Show location" })).toBeTruthy();

    pickOption("Format", "Excel (.xlsx)");

    expect(screen.getByRole("combobox", { name: "Images" })).toBeTruthy();
    expect(screen.queryByRole("switch", { name: "Show location" })).toBeNull();
  });

  it("counts the works the current options will actually export", () => {
    renderDialog();

    expect(screen.getByText(/^4 works\./)).toBeTruthy();
    fireEvent.click(screen.getByRole("switch", { name: "Placed works only" }));
    expect(screen.getByText(/^2 works\./)).toBeTruthy();
  });

  it("says what the download will be, since that depends on two controls at once", () => {
    renderDialog();

    expect(screen.getByText(/Downloads a single \.pdf file\./)).toBeTruthy();
    pickOption("Format", "Excel (.xlsx)");
    expect(screen.getByText(/Downloads a \.zip containing checklist\.xlsx and an images folder\./))
      .toBeTruthy();
    pickOption("Images", "No images");
    expect(screen.getByText(/Downloads a single \.xlsx file\./)).toBeTruthy();
  });

  it("disables Export when the placed-only filter leaves nothing to export", () => {
    renderDialog({ placedCount: 0 });

    fireEvent.click(screen.getByRole("switch", { name: "Placed works only" }));
    expect(
      screen.getByRole("button", { name: "Export checklist" }).hasAttribute("disabled")
    ).toBe(true);
  });

  it("shows a busy state and blocks a second export while one is running", () => {
    const { onExport } = renderDialog({ busy: true });

    const button = screen.getByRole("button", { name: /Exporting/ });
    expect(button.hasAttribute("disabled")).toBe(true);
    fireEvent.click(button);
    expect(onExport).not.toHaveBeenCalled();
  });
});
