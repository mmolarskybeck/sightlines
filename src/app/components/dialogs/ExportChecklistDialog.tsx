import { useId, useState } from "react";
import { CircleNotchIcon } from "@phosphor-icons/react/dist/csr/CircleNotch";
import {
  DEFAULT_CHECKLIST_EXPORT_OPTIONS,
  DEFAULT_CHECKLIST_PDF_EXPORT_OPTIONS,
  type ChecklistExportImageMode,
  type ChecklistExportRequest,
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "../ui/select";
import { Switch } from "../ui/switch";

// The one axis that changes what the export IS. PDF leads because it is the
// document a curator hands to a press office or a lender; the spreadsheets are
// what their collaborators (registrars, shippers) ask for.
type ChecklistDialogFormat = "pdf" | "xlsx" | "csv";

const FORMAT_OPTIONS: { value: ChecklistDialogFormat; label: string }[] = [
  { value: "pdf", label: "PDF" },
  { value: "xlsx", label: "Excel (.xlsx)" },
  { value: "csv", label: "CSV" }
];

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

// Every control's state, flat, so the two questions both formats ask — Sort by
// and Placed works only — are literally one piece of state rather than two that
// have to be kept in step. Switching format must never silently reorder or
// refilter the works.
type ChecklistDialogState = {
  format: ChecklistDialogFormat;
  sort: ChecklistExportSort;
  placedOnly: boolean;
  images: ChecklistExportImageMode;
  numbering: boolean;
  accession: boolean;
  location: boolean;
};

const INITIAL_STATE: ChecklistDialogState = {
  format: "pdf",
  sort: DEFAULT_CHECKLIST_PDF_EXPORT_OPTIONS.sort,
  placedOnly: DEFAULT_CHECKLIST_PDF_EXPORT_OPTIONS.placedOnly,
  images: DEFAULT_CHECKLIST_EXPORT_OPTIONS.images,
  numbering: DEFAULT_CHECKLIST_PDF_EXPORT_OPTIONS.numbering,
  accession: DEFAULT_CHECKLIST_PDF_EXPORT_OPTIONS.accession,
  location: DEFAULT_CHECKLIST_PDF_EXPORT_OPTIONS.location
};

export function checklistExportRequest(
  state: ChecklistDialogState
): ChecklistExportRequest {
  if (state.format === "pdf") {
    return {
      kind: "pdf",
      options: {
        format: "pdf",
        sort: state.sort,
        placedOnly: state.placedOnly,
        numbering: state.numbering,
        accession: state.accession,
        location: state.location
      }
    };
  }
  return {
    kind: "spreadsheet",
    options: {
      format: state.format,
      images: state.images,
      sort: state.sort,
      placedOnly: state.placedOnly
    }
  };
}

// What the chosen options will actually produce, in the user's terms. The
// filename shape is the thing worth previewing: "you get one .xlsx" versus "you
// get a zip with a folder of images in it" is the only surprise this dialog can
// spring, and it depends on TWO controls at once.
function describeOutput(state: ChecklistDialogState): string {
  if (state.format === "pdf") {
    return "Downloads a single .pdf file.";
  }
  const sheet = state.format === "csv" ? "checklist.csv" : "checklist.xlsx";
  if (state.images === "none") {
    return `Downloads a single .${state.format} file.`;
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
  onExport: (request: ChecklistExportRequest) => void;
  // App owns the async export; this only reflects it.
  busy?: boolean;
};

// The checklist export (docs/export-spec.md §3.4–3.5). Deliberately a short,
// flat dialog rather than the Export PDF dialog's two-column shape: there is no
// page tree to walk and no preview to draw, so the controls read as one column
// of decisions. The primitives, switch geometry, and row classes are
// ExportPdfDialog's, so the two dialogs stay visually of a piece.
//
// One dialog for three formats rather than two menu items: the works, the
// order, and the placed-only filter are the same decisions whichever file comes
// out, and splitting them would make "the same checklist, as a PDF" a different
// errand from "the same checklist, as a spreadsheet".
export function ExportChecklistDialog({
  open,
  checklistCount,
  placedCount,
  onOpenChange,
  onExport,
  busy = false
}: ExportChecklistDialogProps) {
  const [state, setState] = useState<ChecklistDialogState>(INITIAL_STATE);
  const placedOnlyId = useId();
  const numberingId = useId();
  const accessionId = useId();
  const locationId = useId();

  const update = (patch: Partial<ChecklistDialogState>) =>
    setState((current) => ({ ...current, ...patch }));

  const exportedCount = state.placedOnly ? placedCount : checklistCount;
  const isPdf = state.format === "pdf";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="export-checklist-dialog">
        <DialogHeader>
          <DialogTitle>Export checklist</DialogTitle>
          <DialogDescription>
            Every work in this checklist, with its metadata and where it is
            placed — as a printable document or a spreadsheet.
          </DialogDescription>
        </DialogHeader>

        <fieldset className="export-checklist-body" disabled={busy}>
          {/* One flat row grid — label left, control right — rather than
              headed sections: with the format itself as a row, every decision
              in this dialog reads on the same grammar, and the rows that only
              apply to one format simply appear and disappear in place. */}
          <div className="export-checklist-group">
            <label className="export-paper-field">
              <span>Format</span>
              <Select
                value={state.format}
                onValueChange={(value) =>
                  update({ format: value as ChecklistDialogFormat })
                }
              >
                <SelectTrigger aria-label="Format">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FORMAT_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>

            {isPdf ? null : (
              <label className="export-paper-field">
                <span>Images</span>
                <Select
                  value={state.images}
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
            )}

            <label className="export-paper-field">
              <span>Sort by</span>
              <Select
                value={state.sort}
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
                checked={state.placedOnly}
                className="export-switch-control"
                id={placedOnlyId}
                onCheckedChange={(checked) => update({ placedOnly: checked })}
              />
            </label>

            {isPdf ? (
              <>
                <label className="export-switch-row" htmlFor={numberingId}>
                  <strong>Show numbering</strong>
                  <Switch
                    aria-label="Show numbering"
                    checked={state.numbering}
                    className="export-switch-control"
                    id={numberingId}
                    onCheckedChange={(checked) => update({ numbering: checked })}
                  />
                </label>
                <label className="export-switch-row" htmlFor={accessionId}>
                  <strong>Show accession number</strong>
                  <Switch
                    aria-label="Show accession number"
                    checked={state.accession}
                    className="export-switch-control"
                    id={accessionId}
                    onCheckedChange={(checked) => update({ accession: checked })}
                  />
                </label>
                <label className="export-switch-row" htmlFor={locationId}>
                  <strong>Show location</strong>
                  <Switch
                    aria-label="Show location"
                    checked={state.location}
                    className="export-switch-control"
                    id={locationId}
                    onCheckedChange={(checked) => update({ location: checked })}
                  />
                </label>
              </>
            ) : null}
          </div>

          <p className="export-setup-note" aria-live="polite">
            {exportedCount} {exportedCount === 1 ? "work" : "works"}.{" "}
            {describeOutput(state)}
          </p>
        </fieldset>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={busy || exportedCount === 0}
            variant="primary"
            onClick={() => onExport(checklistExportRequest(state))}
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
