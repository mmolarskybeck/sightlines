import { useId, useState } from "react";
import { CircleNotchIcon } from "@phosphor-icons/react/dist/csr/CircleNotch";
import {
  DEFAULT_CHECKLIST_EXPORT_OPTIONS,
  type ChecklistExportFormat,
  type ChecklistExportImageMode,
  type ChecklistExportOptions,
  type ChecklistExportSort
} from "../../../domain/checklistExport/types";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "../ui/dialog";
import { SegmentedToggleGroup, SegmentedToggleGroupItem } from "../ui/segmented";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "../ui/select";
import { Switch } from "../ui/switch";

const IMAGE_OPTIONS: { value: ChecklistExportImageMode; label: string }[] = [
  { value: "none", label: "No images" },
  { value: "display", label: "Display quality" },
  { value: "originals", label: "Original files" }
];

const SORT_OPTIONS: { value: ChecklistExportSort; label: string }[] = [
  { value: "project", label: "Checklist order" },
  { value: "artist", label: "Artist" },
  { value: "title", label: "Title" },
  { value: "accession", label: "Accession number" },
  { value: "placement", label: "Placement (room, wall)" }
];

// What the chosen options will actually produce, in the user's terms. The
// filename shape is the thing worth previewing: "you get one .xlsx" versus "you
// get a zip with a folder of images in it" is the only surprise this dialog can
// spring, and it depends on TWO controls at once.
function describeOutput(options: ChecklistExportOptions): string {
  const sheet = options.format === "csv" ? "checklist.csv" : "checklist.xlsx";
  if (options.images === "none") {
    return `Downloads a single .${options.format === "csv" ? "csv" : "xlsx"} file.`;
  }
  return `Downloads a .zip containing ${sheet} and an images folder.`;
}

export type ExportChecklistDialogProps = {
  open: boolean;
  // Checklist size drives the counts in the description; the menu item that
  // opens this dialog is already disabled on an empty checklist.
  checklistCount: number;
  placedCount: number;
  onOpenChange: (open: boolean) => void;
  onExport: (options: ChecklistExportOptions) => void;
  // App owns the async export; this only reflects it.
  busy?: boolean;
};

// The checklist spreadsheet export (docs/export-spec.md §3.4). Deliberately a
// short, flat dialog rather than the Export PDF dialog's two-column shape:
// there is no page tree to walk and no preview to draw, so the four controls
// read as one column of decisions. The primitives, switch geometry, and row
// classes are ExportPdfDialog's, so the two dialogs stay visually of a piece.
export function ExportChecklistDialog({
  open,
  checklistCount,
  placedCount,
  onOpenChange,
  onExport,
  busy = false
}: ExportChecklistDialogProps) {
  const [options, setOptions] = useState<ChecklistExportOptions>(
    DEFAULT_CHECKLIST_EXPORT_OPTIONS
  );
  const placedOnlyId = useId();

  const update = (patch: Partial<ChecklistExportOptions>) =>
    setOptions((current) => ({ ...current, ...patch }));

  const exportedCount = options.placedOnly ? placedCount : checklistCount;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="export-checklist-dialog">
        <DialogHeader>
          <DialogTitle>Export checklist</DialogTitle>
          <DialogDescription>
            A spreadsheet of every work in this checklist, with its metadata and
            where it is placed.
          </DialogDescription>
        </DialogHeader>

        <fieldset className="export-checklist-body" disabled={busy}>
          <div className="export-checklist-group">
            <h3 className="export-group-title">Format</h3>
            <SegmentedToggleGroup
              aria-label="File format"
              type="single"
              value={options.format}
              // type="single" hands back "" when the active item is pressed
              // again; ignoring the empty value keeps a format always chosen.
              onValueChange={(value) => {
                if (value) update({ format: value as ChecklistExportFormat });
              }}
            >
              <SegmentedToggleGroupItem value="xlsx">
                Excel (.xlsx)
              </SegmentedToggleGroupItem>
              <SegmentedToggleGroupItem value="csv">CSV</SegmentedToggleGroupItem>
            </SegmentedToggleGroup>
          </div>

          <div className="export-checklist-group">
            <h3 className="export-group-title">Options</h3>
            <label className="export-paper-field">
              <span>Images</span>
              <Select
                value={options.images}
                onValueChange={(value) =>
                  update({ images: value as ChecklistExportImageMode })
                }
              >
                <SelectTrigger aria-label="Images">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {IMAGE_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>

            <label className="export-paper-field">
              <span>Sort by</span>
              <Select
                value={options.sort}
                onValueChange={(value) =>
                  update({ sort: value as ChecklistExportSort })
                }
              >
                <SelectTrigger aria-label="Sort by">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SORT_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>

            <label className="export-switch-row" htmlFor={placedOnlyId}>
              <strong>Placed works only</strong>
              <Switch
                aria-label="Placed works only"
                checked={options.placedOnly}
                className="export-switch-control"
                id={placedOnlyId}
                onCheckedChange={(checked) => update({ placedOnly: checked })}
              />
            </label>
          </div>

          <p className="export-setup-note" aria-live="polite">
            {exportedCount} {exportedCount === 1 ? "work" : "works"}.{" "}
            {describeOutput(options)}
          </p>
        </fieldset>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={busy || exportedCount === 0}
            variant="primary"
            onClick={() => onExport(options)}
          >
            {busy ? (
              <>
                <CircleNotchIcon aria-hidden="true" className="animate-spin" size={15} />
                Exporting…
              </>
            ) : (
              "Export checklist"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
