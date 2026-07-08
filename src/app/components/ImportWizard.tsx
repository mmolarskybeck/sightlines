import { useEffect, useMemo, useRef, useState } from "react";
import { CheckCircleIcon } from "@phosphor-icons/react/dist/csr/CheckCircle";
import { FileArrowUpIcon } from "@phosphor-icons/react/dist/csr/FileArrowUp";
import { ImageSquareIcon } from "@phosphor-icons/react/dist/csr/ImageSquare";
import { WarningIcon } from "@phosphor-icons/react/dist/csr/Warning";
import { createArtworkImportPlan } from "../../domain/import/importPlan";
import type {
  ArtworkImportDraft,
  ColumnMapping,
  ImportField,
  ImportPlan,
  ImportTable,
  ImportWorkbookPreview,
  ImageMatchCandidate
} from "../../domain/import/types";
import { createImportTable, parseImportWorkbook } from "../../domain/import/workbook";
import type { DisplayUnit } from "../../domain/project";
import { formatLength } from "../../domain/units/length";
import { getScopeUnits, unitSystemFromDisplayUnit } from "../../domain/units/unitSystem";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "./ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "./ui/select";

type Step = "upload" | "map" | "review";

const NO_COLUMN = "__none";
const NO_IMAGE = "__none";

const FIELD_LABELS: Record<ImportField, string> = {
  artist: "Artist",
  title: "Title",
  date: "Date",
  accessionNumber: "Accession",
  locationOrLender: "Location / lender",
  dimensions: "Dimensions",
  height: "Height",
  width: "Width",
  depth: "Depth",
  imageFilename: "Image filename",
  medium: "Medium"
};

const MAPPABLE_FIELDS: ImportField[] = [
  "artist",
  "title",
  "date",
  "accessionNumber",
  "dimensions",
  "height",
  "width",
  "depth",
  "imageFilename",
  "locationOrLender",
  "medium"
];

export default function ImportWizard({
  open,
  projectUnit,
  intakeState,
  onOpenChange,
  onImportDrafts
}: {
  open: boolean;
  projectUnit: DisplayUnit;
  intakeState: "idle" | "processing";
  onOpenChange: (open: boolean) => void;
  onImportDrafts: (drafts: ArtworkImportDraft[]) => Promise<void>;
}) {
  const spreadsheetInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<Step>("upload");
  const [workbook, setWorkbook] = useState<ImportWorkbookPreview | null>(null);
  const [spreadsheetFile, setSpreadsheetFile] = useState<File | null>(null);
  const [selectedSheet, setSelectedSheet] = useState<string | null>(null);
  const [headerRowIndex, setHeaderRowIndex] = useState<number | undefined>(undefined);
  const [imageFiles, setImageFiles] = useState<File[]>([]);
  const [mapping, setMapping] = useState<ColumnMapping>({});
  const [selectedDraftIds, setSelectedDraftIds] = useState<Set<string>>(new Set());
  const [imageChoiceByDraftId, setImageChoiceByDraftId] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) reset();
  }, [open]);

  const table = useMemo<ImportTable | null>(() => {
    if (!workbook || !selectedSheet) return null;
    try {
      return createImportTable(workbook, selectedSheet, headerRowIndex);
    } catch {
      return null;
    }
  }, [workbook, selectedSheet, headerRowIndex]);

  const plan = useMemo<ImportPlan | null>(() => {
    if (!table) return null;
    return createArtworkImportPlan({
      table,
      imageFiles,
      projectUnit,
      mapping
    });
  }, [table, imageFiles, projectUnit, mapping]);
  const planSignature = useMemo(
    () =>
      plan
        ? JSON.stringify({
            sourceFilename: plan.sourceFilename,
            sheetName: plan.sheetName,
            rows: plan.drafts.map((draft) => draft.id),
            mapping,
            imageFiles: imageFiles.map((file) => file.name)
          })
        : "",
    [plan, mapping, imageFiles]
  );

  useEffect(() => {
    if (!plan) return;
    setSelectedDraftIds(new Set(plan.drafts.map((draft) => draft.id)));
    setImageChoiceByDraftId(
      Object.fromEntries(
        plan.drafts.map((draft) => [
          draft.id,
          draft.imageFile?.name ??
            (draft.imageMatch.status === "needs-review"
              ? (draft.imageMatch.candidates[0]?.file.name ?? NO_IMAGE)
              : NO_IMAGE)
        ])
      )
    );
  }, [planSignature]);

  useEffect(() => {
    if (!table) return;
    const nextPlan = createArtworkImportPlan({
      table,
      imageFiles,
      projectUnit
    });
    setMapping(nextPlan.mapping);
  }, [table?.sourceFilename, table?.sheetName, table?.headerRowIndex]);

  const selectedSheetRows = workbook?.sheets.find((sheet) => sheet.name === selectedSheet)?.rows;
  const maxHeaderRow = Math.min(10, selectedSheetRows?.length ?? 0);
  const selectedCount = selectedDraftIds.size;
  const matchedCount =
    plan?.drafts.filter((draft) => resolvedImageFile(draft, imageChoiceByDraftId) !== undefined)
      .length ?? 0;
  const warningCount = plan?.drafts.reduce((total, draft) => total + draft.warnings.length, 0) ?? 0;

  async function readSpreadsheet(file: File) {
    setError(null);
    try {
      const parsed = await parseImportWorkbook(await file.arrayBuffer(), file.name);
      if (parsed.sheets.length === 0) {
        setError("No readable sheets found.");
        return;
      }
      setSpreadsheetFile(file);
      setWorkbook(parsed);
      setSelectedSheet(parsed.sheets[0].name);
      setHeaderRowIndex(undefined);
      setStep("map");
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not read that spreadsheet.");
    }
  }

  async function commit() {
    if (!plan) return;
    const drafts = plan.drafts.map((draft) => ({
      ...draft,
      selected: selectedDraftIds.has(draft.id),
      imageFile: resolvedImageFile(draft, imageChoiceByDraftId)
    }));
    await onImportDrafts(drafts);
    onOpenChange(false);
  }

  function reset() {
    setStep("upload");
    setWorkbook(null);
    setSpreadsheetFile(null);
    setSelectedSheet(null);
    setHeaderRowIndex(undefined);
    setImageFiles([]);
    setMapping({});
    setSelectedDraftIds(new Set());
    setImageChoiceByDraftId({});
    setError(null);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="import-dialog">
        <DialogHeader>
          <DialogTitle>Import checklist</DialogTitle>
          <DialogDescription>
            Match spreadsheet rows to images, then add the reviewed works to this project.
          </DialogDescription>
        </DialogHeader>

        <div className="import-steps" aria-label="Import steps">
          <StepButton active={step === "upload"} label="Upload" onClick={() => setStep("upload")} />
          <StepButton
            active={step === "map"}
            disabled={!table}
            label="Map"
            onClick={() => setStep("map")}
          />
          <StepButton
            active={step === "review"}
            disabled={!plan}
            label="Review"
            onClick={() => setStep("review")}
          />
        </div>

        {error ? <p className="import-error">{error}</p> : null}

        <div className="import-body">
          {step === "upload" ? (
            <div className="import-upload-grid">
              <input
                ref={spreadsheetInputRef}
                accept=".csv,.tsv,.xlsx,.xls"
                className="visually-hidden"
                type="file"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void readSpreadsheet(file);
                  event.target.value = "";
                }}
              />
              <input
                ref={imageInputRef}
                accept="image/jpeg,image/png,image/webp"
                className="visually-hidden"
                multiple
                type="file"
                onChange={(event) => {
                  setImageFiles(Array.from(event.target.files ?? []));
                  event.target.value = "";
                }}
              />
              <button
                type="button"
                className="import-upload-tile"
                onClick={() => spreadsheetInputRef.current?.click()}
              >
                <FileArrowUpIcon aria-hidden="true" size={22} />
                <span>Spreadsheet</span>
                <strong>{spreadsheetFile?.name ?? "CSV or Excel"}</strong>
              </button>
              <button
                type="button"
                className="import-upload-tile"
                onClick={() => imageInputRef.current?.click()}
              >
                <ImageSquareIcon aria-hidden="true" size={22} />
                <span>Images</span>
                <strong>{imageFiles.length === 0 ? "Optional" : `${imageFiles.length} files`}</strong>
              </button>
            </div>
          ) : null}

          {step === "map" && table ? (
            <div className="import-map">
              <div className="import-map-toolbar">
                <label className="import-field">
                  <span>Sheet</span>
                  <Select
                    value={selectedSheet ?? undefined}
                    onValueChange={(value) => {
                      setSelectedSheet(value);
                      setHeaderRowIndex(undefined);
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {workbook?.sheets.map((sheet) => (
                        <SelectItem key={sheet.name} value={sheet.name}>
                          {sheet.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </label>
                <label className="import-field">
                  <span>Header row</span>
                  <Select
                    value={String(table.headerRowIndex)}
                    onValueChange={(value) => setHeaderRowIndex(Number(value))}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Array.from({ length: maxHeaderRow }, (_, index) => (
                        <SelectItem key={index} value={String(index)}>
                          Row {index + 1}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </label>
              </div>

              <div className="import-mapping-list">
                {MAPPABLE_FIELDS.map((field) => {
                  const guess = plan?.guesses.find((candidate) => candidate.field === field);
                  return (
                    <label key={field} className="import-mapping-row">
                      <span>
                        {FIELD_LABELS[field]}
                        {guess ? <small>{guess.confidence}</small> : null}
                      </span>
                      <Select
                        value={
                          mapping[field] === undefined ? NO_COLUMN : String(mapping[field])
                        }
                        onValueChange={(value) =>
                          setMapping((current) => ({
                            ...current,
                            [field]: value === NO_COLUMN ? undefined : Number(value)
                          }))
                        }
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={NO_COLUMN}>Not imported</SelectItem>
                          {table.columns.map((column) => (
                            <SelectItem key={column.index} value={String(column.index)}>
                              {column.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </label>
                  );
                })}
              </div>
            </div>
          ) : null}

          {step === "review" && plan ? (
            <div className="import-review">
              <div className="import-summary">
                <SummaryStat label="Rows" value={String(plan.drafts.length)} />
                <SummaryStat label="Selected" value={String(selectedCount)} />
                <SummaryStat label="Images" value={String(matchedCount)} />
                <SummaryStat label="Warnings" value={String(warningCount)} />
              </div>
              <div className="import-review-list">
                {plan.drafts.map((draft) => (
                  <ReviewRow
                    key={draft.id}
                    draft={draft}
                    imageChoice={imageChoiceByDraftId[draft.id] ?? NO_IMAGE}
                    projectUnit={projectUnit}
                    selected={selectedDraftIds.has(draft.id)}
                    onImageChoice={(value) =>
                      setImageChoiceByDraftId((current) => ({ ...current, [draft.id]: value }))
                    }
                    onSelectedChange={(selected) =>
                      setSelectedDraftIds((current) => {
                        const next = new Set(current);
                        if (selected) next.add(draft.id);
                        else next.delete(draft.id);
                        return next;
                      })
                    }
                  />
                ))}
              </div>
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          {step === "upload" ? (
            <Button disabled={!table} variant="primary" onClick={() => setStep("map")}>
              Continue
            </Button>
          ) : null}
          {step === "map" ? (
            <Button disabled={!plan} variant="primary" onClick={() => setStep("review")}>
              Review
            </Button>
          ) : null}
          {step === "review" ? (
            <Button
              disabled={!plan || selectedCount === 0 || intakeState === "processing"}
              variant="primary"
              onClick={() => void commit()}
            >
              {intakeState === "processing" ? "Importing" : "Import"}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function StepButton({
  active,
  disabled,
  label,
  onClick
}: {
  active: boolean;
  disabled?: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="import-step"
      data-active={active ? "" : undefined}
      disabled={disabled}
      onClick={onClick}
    >
      {label}
    </button>
  );
}

function SummaryStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="import-stat">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function ReviewRow({
  draft,
  imageChoice,
  projectUnit,
  selected,
  onImageChoice,
  onSelectedChange
}: {
  draft: ArtworkImportDraft;
  imageChoice: string;
  projectUnit: DisplayUnit;
  selected: boolean;
  onImageChoice: (value: string) => void;
  onSelectedChange: (selected: boolean) => void;
}) {
  const artworkUnit = getScopeUnits(unitSystemFromDisplayUnit(projectUnit), "artwork").displayUnit;
  const dimensions = draft.artwork.dimensions;
  const dimensionText =
    dimensions.widthMm && dimensions.heightMm
      ? `${formatLength(dimensions.heightMm, { unit: artworkUnit })} x ${formatLength(
          dimensions.widthMm,
          { unit: artworkUnit }
        )}`
      : "No dimensions";
  const candidates = imageCandidates(draft);
  const imageLabel =
    resolvedImageFile(draft, { [draft.id]: imageChoice })?.name ??
    (draft.imageMatch.status === "matched" ? draft.imageMatch.file.name : "No image");

  return (
    <article className="import-review-row" data-selected={selected ? "" : undefined}>
      <input
        aria-label={`Import ${draft.artwork.title ?? "Untitled"}`}
        checked={selected}
        className="import-review-check"
        type="checkbox"
        onChange={(event) => onSelectedChange(event.target.checked)}
      />
      <div className="import-review-main">
        <div className="import-review-title">
          <strong>{draft.artwork.title ?? "Untitled"}</strong>
          <span>{draft.artwork.artist ?? "No artist"}</span>
        </div>
        <div className="import-review-meta">
          <span>{draft.artwork.date ?? "No date"}</span>
          <span>{dimensionText}</span>
          <span>Row {draft.row.sourceRowIndex}</span>
        </div>
        {draft.warnings.length > 0 ? (
          <div className="import-review-warnings">
            <WarningIcon aria-hidden="true" size={14} />
            <span>{draft.warnings.map((warning) => warning.message).join(" ")}</span>
          </div>
        ) : (
          <div className="import-review-ok">
            <CheckCircleIcon aria-hidden="true" size={14} />
            <span>Ready</span>
          </div>
        )}
      </div>
      <div className="import-review-image">
        {candidates.length > 0 ? (
          <Select value={imageChoice} onValueChange={onImageChoice}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_IMAGE}>No image</SelectItem>
              {candidates.map((candidate) => (
                <SelectItem key={candidate.file.name} value={candidate.file.name}>
                  {candidate.file.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <span>{imageLabel}</span>
        )}
      </div>
    </article>
  );
}

function imageCandidates(draft: ArtworkImportDraft): ImageMatchCandidate[] {
  if (draft.imageMatch.status === "matched") {
    return [{ file: draft.imageMatch.file, score: draft.imageMatch.score, reason: draft.imageMatch.reason }];
  }
  if (draft.imageMatch.status === "needs-review" || draft.imageMatch.status === "none") {
    return draft.imageMatch.candidates;
  }
  if (draft.imageMatch.status === "conflict") {
    return draft.imageMatch.candidates;
  }
  return [];
}

function resolvedImageFile(
  draft: ArtworkImportDraft,
  imageChoiceByDraftId: Record<string, string>
): File | undefined {
  const choice = imageChoiceByDraftId[draft.id];
  if (choice === NO_IMAGE) return undefined;
  const candidates = imageCandidates(draft);
  return candidates.find((candidate) => candidate.file.name === choice)?.file ?? draft.imageFile;
}
