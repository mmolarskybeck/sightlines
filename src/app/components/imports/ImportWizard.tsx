import { useEffect, useMemo, useState, type KeyboardEvent, type ReactNode } from "react";
import { CaretLeftIcon } from "@phosphor-icons/react/dist/csr/CaretLeft";
import { CaretRightIcon } from "@phosphor-icons/react/dist/csr/CaretRight";
import { CheckIcon } from "@phosphor-icons/react/dist/csr/Check";
import { CheckCircleIcon } from "@phosphor-icons/react/dist/csr/CheckCircle";
import { FileArrowUpIcon } from "@phosphor-icons/react/dist/csr/FileArrowUp";
import { ImageSquareIcon } from "@phosphor-icons/react/dist/csr/ImageSquare";
import { WarningIcon } from "@phosphor-icons/react/dist/csr/Warning";
import { XIcon } from "@phosphor-icons/react/dist/csr/X";
import { useFileImageUrls } from "../../hooks/useFileImageUrls";
import { ACCEPTED_IMAGE_MIME_TYPES, isAcceptedImageType } from "../../../domain/assets/imageIntake";
import { createArtworkImportPlan } from "../../../domain/spreadsheetImport/importPlan";
import type { ImportDimensionUnit } from "../../../domain/spreadsheetImport/dimensions";
import type {
  ArtworkImportDraft,
  ColumnMapping,
  DimensionOrder,
  ImportField,
  ImportPlan,
  ImportTable,
  ImportWorkbookPreview,
  ImageMatchCandidate
} from "../../../domain/spreadsheetImport/types";
import { createImportTable, parseImportWorkbook } from "../../../domain/spreadsheetImport/workbook";
import type { DisplayUnit } from "../../../domain/project";
import { formatLength } from "../../../domain/units/length";
import { getScopeUnits, unitSystemFromDisplayUnit } from "../../../domain/units/unitSystem";
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

type Step = "upload" | "map" | "review";
type StepState = "complete" | "active" | "upcoming";

const STEP_ORDER: Step[] = ["upload", "map", "review"];
const STEP_COPY: Record<Step, { title: string; description: string }> = {
  upload: {
    title: "Choose source files",
    description:
      "Add a spreadsheet for metadata, images for artwork files, or both. You can clear either well before continuing."
  },
  map: {
    title: "Map spreadsheet columns",
    description:
      "Confirm how each column becomes artwork data. The sample preview updates as you adjust the mapping."
  },
  review: {
    title: "Review imported works",
    description:
      "Check warnings, image matches, and selected rows before adding the works to the project."
  }
};

const NO_COLUMN = "__none";
const NO_IMAGE = "__none";

const SPREADSHEET_NAME_PATTERN = /\.(csv|tsv|xlsx|xls)$/i;
// Filename fallback only — some drag/drop sources (e.g. certain OS file
// pickers) hand over a file with an empty or generic `type`, so the MIME
// check alone (isAcceptedImageType, the shared source of truth for which
// image types this app accepts) would silently drop a valid file.
const IMAGE_NAME_PATTERN = /\.(jpe?g|png|webp)$/i;

// Full-word unit names for the dimension-unit override control.
const UNIT_WORD: Record<ImportDimensionUnit, string> = {
  in: "inches",
  ft: "feet",
  cm: "centimeters",
  mm: "millimeters",
  m: "meters"
};
const UNIT_OVERRIDE_OPTIONS: ImportDimensionUnit[] = ["in", "cm", "mm", "ft", "m"];

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
  destination = "checklist",
  projectUnit,
  intakeState,
  onOpenChange,
  onImportDrafts,
  onImportImages
}: {
  open: boolean;
  destination?: "library" | "checklist";
  projectUnit: DisplayUnit;
  intakeState: "idle" | "processing";
  onOpenChange: (open: boolean) => void;
  onImportDrafts: (drafts: ArtworkImportDraft[]) => Promise<void>;
  onImportImages: (files: File[]) => Promise<void>;
}) {
  const spreadsheetInputId = "import-spreadsheet-input";
  const imageInputId = "import-image-input";
  const [step, setStep] = useState<Step>("upload");
  const [workbook, setWorkbook] = useState<ImportWorkbookPreview | null>(null);
  const [spreadsheetFile, setSpreadsheetFile] = useState<File | null>(null);
  const [selectedSheet, setSelectedSheet] = useState<string | null>(null);
  const [headerRowIndex, setHeaderRowIndex] = useState<number | undefined>(undefined);
  const [imageFiles, setImageFiles] = useState<File[]>([]);
  const [mapping, setMapping] = useState<ColumnMapping>({});
  const [dimensionOrder, setDimensionOrder] = useState<DimensionOrder>("auto");
  // "auto" defers to the project default; any other value manually forces the
  // unit for bare (unit-less) dimension numbers. Inline units and column-header
  // hints still take precedence over this override.
  const [unitOverride, setUnitOverride] = useState<ImportDimensionUnit | "auto">("auto");
  // Filename → width/height ratio, filled asynchronously from the uploaded
  // image bitmaps. "auto" dimension order consults this to settle whether a
  // combined "12 x 13" cell is H x W or W x H.
  const [imageAspectByName, setImageAspectByName] = useState<ReadonlyMap<string, number>>(
    new Map()
  );
  const [selectedDraftIds, setSelectedDraftIds] = useState<Set<string>>(new Set());
  const [imageChoiceByDraftId, setImageChoiceByDraftId] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  // Which upload tile a drag is currently hovering, so the drop-target style
  // can light up before the drop event fires.
  const [dragTarget, setDragTarget] = useState<"spreadsheet" | "images" | null>(null);
  // Which draft the Map step's sample card is showing. Reset on table
  // identity (a new sheet/header row genuinely changes what's being
  // previewed) but deliberately NOT on mapping edits — watching one row
  // respond live as fields get (un)mapped is the point of the card.
  const [sampleRowIndex, setSampleRowIndex] = useState(0);

  const imageUrls = useFileImageUrls(imageFiles);
  const stepCopy = STEP_COPY[step];
  // The unit "Auto" falls back to — shown in the override control's default
  // label so the user can see what leaving it on Auto actually means.
  const projectParseUnit = getScopeUnits(
    unitSystemFromDisplayUnit(projectUnit),
    "artwork"
  ).parseUnit;

  const currentStepIndex = STEP_ORDER.indexOf(step);
  function stepState(target: Step): StepState {
    const targetIndex = STEP_ORDER.indexOf(target);
    if (targetIndex === currentStepIndex) return "active";
    return targetIndex < currentStepIndex ? "complete" : "upcoming";
  }

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

  // Measure each uploaded image's aspect ratio off the main thread. Keyed on
  // the file identity list so re-runs only happen when the set changes; cached
  // by name so adding one file doesn't re-decode the rest. Failures are
  // swallowed — a row simply keeps the height-first default when its image
  // can't be measured.
  useEffect(() => {
    let cancelled = false;
    const known = imageAspectByName;
    const pending = imageFiles.filter(
      (file) => isImportImageFile(file) && !known.has(file.name)
    );
    if (pending.length === 0) return;

    void (async () => {
      const measured = new Map<string, number>();
      for (const file of pending) {
        try {
          const bitmap = await createImageBitmap(file);
          if (bitmap.height > 0) measured.set(file.name, bitmap.width / bitmap.height);
          bitmap.close();
        } catch {
          // Unreadable image — leave it out; the row falls back to height-first.
        }
      }
      if (cancelled || measured.size === 0) return;
      setImageAspectByName((current) => {
        const next = new Map(current);
        for (const [name, ratio] of measured) next.set(name, ratio);
        return next;
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [imageFiles]);

  const plan = useMemo<ImportPlan | null>(() => {
    if (!table) return null;
    return createArtworkImportPlan({
      table,
      imageFiles,
      projectUnit,
      mapping,
      dimensionOrder,
      imageAspectByName,
      unitOverride: unitOverride === "auto" ? undefined : unitOverride
    });
  }, [table, imageFiles, projectUnit, mapping, dimensionOrder, imageAspectByName, unitOverride]);
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
    setSampleRowIndex(0);
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

  const sampleDrafts = plan?.drafts ?? [];
  // Clamp rather than trust the stored index directly — the stored value can
  // point past the end after a mapping/sheet change shrinks the draft list.
  const clampedSampleIndex =
    sampleDrafts.length > 0 ? Math.min(sampleRowIndex, sampleDrafts.length - 1) : 0;
  const sampleDraft = sampleDrafts[clampedSampleIndex];
  // Honors the user's Review choices, not just the auto-match: a draft the
  // user has already reassigned on Review shows that choice here too.
  const sampleImageFile = sampleDraft ? resolvedImageFile(sampleDraft, imageChoiceByDraftId) : undefined;
  const sampleImageUrl = sampleImageFile ? imageUrls.get(sampleImageFile.name) : undefined;

  function stepSample(delta: number) {
    if (sampleDrafts.length === 0) return;
    setSampleRowIndex((current) => {
      const clamped = Math.min(current, sampleDrafts.length - 1);
      return Math.max(0, Math.min(sampleDrafts.length - 1, clamped + delta));
    });
  }

  const uploadRowCount = table?.rows.length ?? 0;
  const uploadMeta = !workbook
    ? null
    : uploadRowCount === 0
      ? { caution: true, text: "No data rows found" }
      : workbook.sheets.length > 1
        ? { caution: false, text: `${workbook.sheets.length} sheets · ${uploadRowCount} rows in ${selectedSheet}` }
        : { caution: false, text: `${uploadRowCount} rows detected` };

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
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not read that spreadsheet.");
    }
  }

  function handleSpreadsheetFiles(files: FileList | File[]) {
    const file = Array.from(files).find((candidate) => SPREADSHEET_NAME_PATTERN.test(candidate.name));
    if (file) void readSpreadsheet(file);
  }

  function isImportImageFile(file: File) {
    return isAcceptedImageType(file.type) || IMAGE_NAME_PATTERN.test(file.name);
  }

  function handleImageFiles(files: FileList | File[]) {
    const matched = Array.from(files).filter(isImportImageFile);
    if (matched.length > 0) {
      setImageFiles((current) => [...current, ...matched]);
    }
  }

  function activateUploadLabel(event: KeyboardEvent<HTMLLabelElement>) {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    event.currentTarget.click();
  }

  function clearSpreadsheet() {
    setWorkbook(null);
    setSpreadsheetFile(null);
    setSelectedSheet(null);
    setHeaderRowIndex(undefined);
    setMapping({});
    setSelectedDraftIds(new Set());
    setImageChoiceByDraftId({});
    setSampleRowIndex(0);
    setError(null);
  }

  function removeImageFile(indexToRemove: number) {
    setImageFiles((current) => current.filter((_, index) => index !== indexToRemove));
  }

  async function importImagesOnly() {
    if (imageFiles.length === 0 || intakeState === "processing") return;
    await onImportImages(imageFiles);
    onOpenChange(false);
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
    setDimensionOrder("auto");
    setUnitOverride("auto");
    setImageAspectByName(new Map());
    setSelectedDraftIds(new Set());
    setImageChoiceByDraftId({});
    setError(null);
    setSampleRowIndex(0);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="import-dialog">
        <DialogHeader className="import-dialog-header">
          <DialogTitle className="visually-hidden">
            {destination === "library" ? "Import to Artwork Library" : "Import to checklist"}
          </DialogTitle>
          <DialogDescription className="visually-hidden">{stepCopy.description}</DialogDescription>
          <div className="import-steps" aria-label="Import steps">
            <StepButton index={1} label="Upload" state={stepState("upload")} onClick={() => setStep("upload")} />
            <CaretRightIcon aria-hidden="true" className="import-step-caret" size={14} />
            <StepButton
              disabled={!table}
              index={2}
              label="Map"
              state={stepState("map")}
              onClick={() => setStep("map")}
            />
            <CaretRightIcon aria-hidden="true" className="import-step-caret" size={14} />
            <StepButton
              disabled={!plan}
              index={3}
              label="Review"
              state={stepState("review")}
              onClick={() => setStep("review")}
            />
          </div>
          <p className="import-destination-note">
            {destination === "library"
              ? "These artworks will be saved to your library on this device."
              : "These artworks will be saved to your library and added to this checklist."}
          </p>
        </DialogHeader>

        {error ? <p className="import-error">{error}</p> : null}

        <div className="import-body" data-step={step}>
          <div className="import-screen-header">
            <h2>{stepCopy.title}</h2>
            <p>{stepCopy.description}</p>
          </div>
          {step === "upload" ? (
            <div className="import-upload-grid">
              <input
                id={spreadsheetInputId}
                accept=".csv,.tsv,.xlsx,.xls"
                className="visually-hidden"
                type="file"
                onChange={(event) => {
                  handleSpreadsheetFiles(event.target.files ?? []);
                  event.target.value = "";
                }}
              />
              <input
                id={imageInputId}
                accept={ACCEPTED_IMAGE_MIME_TYPES.join(",")}
                className="visually-hidden"
                multiple
                type="file"
                onChange={(event) => {
                  handleImageFiles(event.target.files ?? []);
                  event.target.value = "";
                }}
              />
              {spreadsheetFile ? (
                <div
                  className="import-upload-tile import-upload-tile-filled"
                  data-dragover={dragTarget === "spreadsheet" ? "" : undefined}
                  data-filled=""
                  onDragLeave={() =>
                    setDragTarget((current) => (current === "spreadsheet" ? null : current))
                  }
                  onDragOver={(event) => {
                    event.preventDefault();
                    setDragTarget("spreadsheet");
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    setDragTarget(null);
                    handleSpreadsheetFiles(event.dataTransfer.files);
                  }}
                >
                  <div className="import-upload-file-head">
                    <div aria-hidden="true" className="import-upload-icon">
                      <FileArrowUpIcon size={20} />
                    </div>
                    <div className="import-upload-file-copy">
                      <strong>{spreadsheetFile.name}</strong>
                      {uploadMeta ? (
                        <span
                          className="import-upload-meta"
                          data-caution={uploadMeta.caution ? "" : undefined}
                        >
                          {uploadMeta.text}
                        </span>
                      ) : null}
                    </div>
                  </div>
                  <div className="import-upload-actions">
                    <Button asChild size="sm" variant="outline">
                      <label htmlFor={spreadsheetInputId}>Replace</label>
                    </Button>
                    <Button size="sm" variant="ghost" onClick={clearSpreadsheet}>
                      Clear
                    </Button>
                  </div>
                </div>
              ) : (
                <label
                  className="import-upload-tile"
                  data-dragover={dragTarget === "spreadsheet" ? "" : undefined}
                  htmlFor={spreadsheetInputId}
                  role="button"
                  tabIndex={0}
                  onKeyDown={activateUploadLabel}
                  onDragLeave={() =>
                    setDragTarget((current) => (current === "spreadsheet" ? null : current))
                  }
                  onDragOver={(event) => {
                    event.preventDefault();
                    setDragTarget("spreadsheet");
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    setDragTarget(null);
                    handleSpreadsheetFiles(event.dataTransfer.files);
                  }}
                >
                  <div aria-hidden="true" className="import-upload-icon">
                    <FileArrowUpIcon size={20} />
                  </div>
                  <strong>Spreadsheet</strong>
                  <span>Optional CSV or Excel metadata</span>
                </label>
              )}
              {imageFiles.length > 0 ? (
                <div
                  className="import-upload-tile import-upload-tile-filled"
                  data-dragover={dragTarget === "images" ? "" : undefined}
                  data-filled=""
                  onDragLeave={() => setDragTarget((current) => (current === "images" ? null : current))}
                  onDragOver={(event) => {
                    event.preventDefault();
                    setDragTarget("images");
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    setDragTarget(null);
                    handleImageFiles(event.dataTransfer.files);
                  }}
                >
                  <div className="import-upload-file-head">
                    <div aria-hidden="true" className="import-upload-icon">
                      <ImageSquareIcon size={20} />
                    </div>
                    <div className="import-upload-file-copy">
                      <strong>{imageFiles.length} images</strong>
                      <span>Add more or remove individual files before matching.</span>
                    </div>
                  </div>
                  <ul className="import-upload-file-list" aria-label="Selected image files">
                    {imageFiles.map((file, index) => (
                      <li key={`${file.name}-${file.lastModified}-${index}`} className="import-upload-file-row">
                        <ImageSquareIcon aria-hidden="true" size={14} />
                        <span>{file.name}</span>
                        <button
                          type="button"
                          aria-label={`Remove ${file.name}`}
                          className="import-upload-file-remove"
                          onClick={() => removeImageFile(index)}
                        >
                          <XIcon aria-hidden="true" size={13} />
                        </button>
                      </li>
                    ))}
                  </ul>
                  <div className="import-upload-actions">
                    <Button asChild size="sm" variant="outline">
                      <label htmlFor={imageInputId}>Add more</label>
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setImageFiles([])}>
                      Clear all
                    </Button>
                  </div>
                </div>
              ) : (
                <label
                  className="import-upload-tile"
                  data-dragover={dragTarget === "images" ? "" : undefined}
                  htmlFor={imageInputId}
                  role="button"
                  tabIndex={0}
                  onKeyDown={activateUploadLabel}
                  onDragLeave={() => setDragTarget((current) => (current === "images" ? null : current))}
                  onDragOver={(event) => {
                    event.preventDefault();
                    setDragTarget("images");
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    setDragTarget(null);
                    handleImageFiles(event.dataTransfer.files);
                  }}
                >
                  <div aria-hidden="true" className="import-upload-icon">
                    <ImageSquareIcon size={20} />
                  </div>
                  <strong>Images</strong>
                  <span>JPG, PNG, or WebP</span>
                </label>
              )}
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
                {mapping.dimensions !== undefined ? (
                  <label className="import-field">
                    <span>Dimension order</span>
                    <Select
                      value={dimensionOrder}
                      onValueChange={(value) => setDimensionOrder(value as DimensionOrder)}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="auto">Auto (from image)</SelectItem>
                        <SelectItem value="height-first">Height × Width</SelectItem>
                        <SelectItem value="width-first">Width × Height</SelectItem>
                      </SelectContent>
                    </Select>
                  </label>
                ) : null}
                {mapping.dimensions !== undefined ||
                mapping.height !== undefined ||
                mapping.width !== undefined ||
                mapping.depth !== undefined ? (
                  <label className="import-field">
                    <span>Units</span>
                    <Select
                      value={unitOverride}
                      onValueChange={(value) =>
                        setUnitOverride(value as ImportDimensionUnit | "auto")
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="auto">
                          Auto (project — {UNIT_WORD[projectParseUnit]})
                        </SelectItem>
                        {UNIT_OVERRIDE_OPTIONS.map((unit) => (
                          <SelectItem key={unit} value={unit}>
                            {unit}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </label>
                ) : null}
              </div>

              <div className="import-map-grid">
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
                <SampleCard
                  draft={sampleDraft}
                  imageUrl={sampleImageUrl}
                  index={clampedSampleIndex}
                  projectUnit={projectUnit}
                  total={sampleDrafts.length}
                  onStep={stepSample}
                />
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
                {plan.drafts.map((draft) => {
                  const imageFile = resolvedImageFile(draft, imageChoiceByDraftId);
                  return (
                    <ReviewRow
                      key={draft.id}
                      draft={draft}
                      imageChoice={imageChoiceByDraftId[draft.id] ?? NO_IMAGE}
                      projectUnit={projectUnit}
                      selected={selectedDraftIds.has(draft.id)}
                      thumbnailUrl={imageFile ? imageUrls.get(imageFile.name) : undefined}
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
                  );
                })}
              </div>
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          {step === "upload" ? (
            <Button
              disabled={
                (!table || table.rows.length === 0) &&
                (imageFiles.length === 0 || intakeState === "processing")
              }
              variant="primary"
              onClick={() => {
                if (table && table.rows.length > 0) {
                  setStep("map");
                  return;
                }
                void importImagesOnly();
              }}
            >
              {table && table.rows.length > 0
                ? "Continue"
                : intakeState === "processing"
                  ? "Importing"
                  : "Import images"}
            </Button>
          ) : null}
          {step === "map" ? (
            <Button disabled={!plan} variant="primary" onClick={() => setStep("review")}>
              Review
            </Button>
          ) : null}
          {step === "review" ? (
            <Button
              disabled={
                !plan || plan.drafts.length === 0 || selectedCount === 0 || intakeState === "processing"
              }
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
  disabled,
  index,
  label,
  state,
  onClick
}: {
  disabled?: boolean;
  index: number;
  label: string;
  state: StepState;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="import-step"
      data-state={state}
      disabled={disabled}
      aria-current={state === "active" ? "step" : undefined}
      onClick={onClick}
    >
      <span aria-hidden="true" className="import-step-chip">
        {state === "complete" ? <CheckIcon size={12} weight="bold" /> : index}
      </span>
      <span className="import-step-label">{label}</span>
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

// Shared by the Review row list and the Map step's sample card, so both
// surfaces render the same dimension text for the same draft.
function formatDraftDimensions(draft: ArtworkImportDraft, projectUnit: DisplayUnit): string {
  const artworkUnit = getScopeUnits(unitSystemFromDisplayUnit(projectUnit), "artwork").displayUnit;
  const dimensions = draft.artwork.dimensions;
  return dimensions.widthMm && dimensions.heightMm
    ? `${formatLength(dimensions.heightMm, { unit: artworkUnit })} x ${formatLength(
        dimensions.widthMm,
        { unit: artworkUnit }
      )}`
    : "No dimensions";
}

// Title/artist, date · dimensions, warnings-vs-Ready — the draft summary
// content shared by Review rows and the Map sample card. Reuses the
// .import-review-* classes rather than forking a parallel set for the
// sample card. `metaExtra` lets a caller append to the meta line (Review's
// "Row N", which stays specific to that context rather than living here)
// without a second copy of the meta div.
function DraftSummary({
  draft,
  metaExtra,
  projectUnit
}: {
  draft: ArtworkImportDraft;
  metaExtra?: ReactNode;
  projectUnit: DisplayUnit;
}) {
  const dimensionText = formatDraftDimensions(draft, projectUnit);

  return (
    <>
      <div className="import-review-title">
        <strong>{draft.artwork.title ?? "Untitled"}</strong>
        <span>{draft.artwork.artist ?? "No artist"}</span>
      </div>
      <div className="import-review-meta">
        <span>{draft.artwork.date ?? "No date"}</span>
        <span>{dimensionText}</span>
        {metaExtra}
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
    </>
  );
}

function ReviewRow({
  draft,
  imageChoice,
  projectUnit,
  selected,
  thumbnailUrl,
  onImageChoice,
  onSelectedChange
}: {
  draft: ArtworkImportDraft;
  imageChoice: string;
  projectUnit: DisplayUnit;
  selected: boolean;
  thumbnailUrl: string | undefined;
  onImageChoice: (value: string) => void;
  onSelectedChange: (selected: boolean) => void;
}) {
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
      {thumbnailUrl ? (
        <img alt="" className="import-review-thumb" src={thumbnailUrl} />
      ) : (
        <div aria-hidden="true" className="import-review-thumb placeholder" />
      )}
      <div className="import-review-main">
        <DraftSummary
          draft={draft}
          metaExtra={<span>Row {draft.row.sourceRowIndex}</span>}
          projectUnit={projectUnit}
        />
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

// Browsable preview of how one row will import under the current mapping —
// the Map step's only feedback that field choices actually did something.
// Styled as a surface wash (DESIGN.md: no nested cards), not a bordered
// card, with a fixed min-height so paging through rows never resizes the
// dialog around it.
function SampleCard({
  draft,
  imageUrl,
  index,
  projectUnit,
  total,
  onStep
}: {
  draft: ArtworkImportDraft | undefined;
  imageUrl: string | undefined;
  index: number;
  projectUnit: DisplayUnit;
  total: number;
  onStep: (delta: number) => void;
}) {
  if (!draft) {
    return (
      <div className="import-sample-card">
        <p className="import-sample-empty">
          No data rows in this sheet. Check the header row setting.
        </p>
      </div>
    );
  }

  return (
    <div className="import-sample-card">
      {total > 1 ? (
        <div className="import-sample-pager">
          <span>Sample · row {draft.row.sourceRowIndex}</span>
          <div className="import-sample-pager-controls">
            <Button
              aria-label="Previous row"
              disabled={index === 0}
              size="icon-sm"
              variant="ghost"
              onClick={() => onStep(-1)}
            >
              <CaretLeftIcon aria-hidden="true" size={14} />
            </Button>
            <span aria-live="polite">
              {index + 1} of {total}
            </span>
            <Button
              aria-label="Next row"
              disabled={index === total - 1}
              size="icon-sm"
              variant="ghost"
              onClick={() => onStep(1)}
            >
              <CaretRightIcon aria-hidden="true" size={14} />
            </Button>
          </div>
        </div>
      ) : null}
      <div className="import-sample-body">
        <div className="import-sample-thumb-row">
          {imageUrl ? (
            <img alt="" className="import-sample-thumb" src={imageUrl} />
          ) : (
            <div aria-hidden="true" className="import-sample-thumb placeholder" />
          )}
          {!imageUrl ? <span className="import-sample-caption">No image</span> : null}
        </div>
        <DraftSummary draft={draft} projectUnit={projectUnit} />
      </div>
    </div>
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
