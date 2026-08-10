import { useId, useState } from "react";
import { CaretDownIcon } from "@phosphor-icons/react/dist/csr/CaretDown";
import { CircleNotchIcon } from "@phosphor-icons/react/dist/csr/CircleNotch";
import { CubeIcon } from "@phosphor-icons/react/dist/csr/Cube";
import { WarningIcon } from "@phosphor-icons/react/dist/csr/Warning";
import {
  countDocumentPages,
  resolveDocumentExportUnit,
  selectionState,
  type DocumentExportPreferences,
  type DocumentExportUnitPreference,
  type DocumentPaperSize,
  type DocumentSectionId,
  type EffectiveDocumentSettings
} from "../../../domain/export/documentSettings";
import type { Artwork, Project } from "../../../domain/project";
import { composeSavedViewLabel } from "../../../domain/savedViews";
import { ExportPdfPreview } from "./ExportPdfPreview";
import { useDocumentExportPreferences } from "../../hooks/useDocumentExportPreferences";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger
} from "../ui/collapsible";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "../ui/dialog";
import { Progress } from "../ui/progress";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue
} from "../ui/select";
import { Switch } from "../ui/switch";

const PAPER_SIZE_GROUPS: {
  label: string;
  options: { value: DocumentPaperSize; label: string }[];
}[] = [
  {
    label: "ISO",
    options: [
      { value: "a4", label: "A4" },
      { value: "a3", label: "A3" }
    ]
  },
  {
    label: "US",
    options: [
      { value: "letter", label: "Letter" },
      { value: "tabloid", label: "Tabloid 11 × 17" }
    ]
  }
];

// Explicit unit choices, in the task's fixed order. Labels mirror the Settings
// dialog's unit menu ("Feet & inches (ft)", "Inches (in)", …) so the two
// surfaces name units the same way; "auto" is prepended per-surface with its
// resolved unit shown in parentheses.
const EXPORT_UNIT_OPTIONS: { value: DocumentExportUnitPreference; label: string }[] =
  [
    { value: "ft", label: "Feet & inches (ft)" },
    { value: "in", label: "Inches (in)" },
    { value: "cm", label: "Centimeters (cm)" },
    { value: "m", label: "Meters (m)" },
    { value: "mm", label: "Millimeters (mm)" }
  ];

type ExportPdfDialogProps = {
  open: boolean;
  project: Project;
  onOpenChange: (open: boolean) => void;
  onExport: (settings: EffectiveDocumentSettings) => void;
  onPersistenceError?: (message: string) => void;
  thumbnailUrls?: Readonly<Record<string, string>>;
  // Joined artwork records, so the inline preview can draw wall-object
  // footprints/elevation rects from the same scene data the export uses.
  artworksById?: ReadonlyMap<string, Artwork>;
  // Determinate progress while App assembles the PDF; null/undefined = idle.
  // App owns the async export, so this component only reflects its state.
  exportState?: { done: number; total: number } | null;
  onCancelExport?: () => void;
};

export function ExportPdfDialog({
  open,
  project,
  onOpenChange,
  onExport,
  onPersistenceError,
  thumbnailUrls = {},
  artworksById,
  exportState,
  onCancelExport
}: ExportPdfDialogProps) {
  const { preferences, settings, updatePreferences } =
    useDocumentExportPreferences(project, onPersistenceError);
  const [openSections, setOpenSections] = useState({
    roomPlans: true,
    elevations: true,
    threeDViews: true
  });
  const pageCount = countDocumentPages(settings);
  const isExporting = exportState != null;

  const setPreferences = (
    update: (current: DocumentExportPreferences) => DocumentExportPreferences
  ) => updatePreferences(update);

  const setSection = (sectionId: DocumentSectionId, included: boolean) => {
    setPreferences((current) => ({
      ...current,
      sections: { ...current.sections, [sectionId]: included }
    }));
  };

  const setRoomPlans = (roomIds: readonly string[], included: boolean) => {
    setPreferences((current) => ({
      ...current,
      roomPlans: {
        ...current.roomPlans,
        ...Object.fromEntries(roomIds.map((roomId) => [roomId, included]))
      }
    }));
  };

  const setElevations = (wallIds: readonly string[], included: boolean) => {
    setPreferences((current) => ({
      ...current,
      elevations: {
        ...current.elevations,
        ...Object.fromEntries(wallIds.map((wallId) => [wallId, included]))
      }
    }));
  };

  const setSavedViews = (viewIds: readonly string[], included: boolean) => {
    setPreferences((current) => ({
      ...current,
      savedViews: {
        ...current.savedViews,
        ...Object.fromEntries(viewIds.map((viewId) => [viewId, included]))
      }
    }));
  };

  // Section "enabled" is derived from its children (see documentSettings.ts),
  // so toggling the parent checkbox just needs to set every child to match
  // the opposite of the current state: fully checked -> clear all, anything
  // else (empty or indeterminate) -> select all.
  const handleParentToggle = ({
    values,
    setAll
  }: {
    values: readonly boolean[];
    setAll: (included: boolean) => void;
  }) => {
    const state = selectionState(values);
    setAll(state !== true);
  };

  const roomPlanValues = settings.rooms.map((room) => room.planIncluded);
  // Open walls can never be elevation pages, so they must not appear in any
  // "n of m" denominator or any select-all id list — otherwise the counts lie
  // and "select all" writes a preference that documentSettings forces false.
  const selectableWalls = (room: (typeof settings.rooms)[number]) =>
    room.walls.filter((wall) => !wall.isOpenSide);
  const wallValues = settings.rooms.flatMap((room) =>
    selectableWalls(room).map((wall) => wall.included)
  );
  const validSavedViews = settings.savedViews.filter((choice) => choice.valid);
  const savedViewValues = validSavedViews.map((choice) => choice.included);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="export-pdf-dialog">
        <DialogHeader>
          <DialogTitle>Export PDF</DialogTitle>
          <DialogDescription>
            Choose the pages to include in this document.
          </DialogDescription>
        </DialogHeader>

        <fieldset className="export-pdf-body" disabled={isExporting}>
          <section className="export-contents" aria-labelledby="export-contents-title">
            <h3 id="export-contents-title" className="export-group-title">
              Contents
            </h3>
            <div className="export-contents-scroll">
              <div className="export-section-row export-section-overview">
                <span className="export-disclosure-spacer" aria-hidden="true" />
                <Checkbox
                  aria-label="Include Overview"
                  checked={settings.sections.overview}
                  onCheckedChange={(checked) =>
                    setSection("overview", checked === true)
                  }
                />
                <button
                  className="export-section-label"
                  type="button"
                  onClick={() =>
                    setSection("overview", !settings.sections.overview)
                  }
                >
                  Overview
                </button>
              </div>

              <ExportSection
                count={roomPlanValues.filter(Boolean).length}
                countTotal={settings.rooms.length}
                label="Room plans"
                open={openSections.roomPlans}
                sectionState={selectionState(roomPlanValues)}
                onOpenChange={(next) =>
                  setOpenSections((current) => ({
                    ...current,
                    roomPlans: next
                  }))
                }
                onToggle={() =>
                  handleParentToggle({
                    values: roomPlanValues,
                    setAll: (included) =>
                      setRoomPlans(
                        settings.rooms.map((room) => room.roomId),
                        included
                      )
                  })
                }
              >
                {settings.rooms.map((room) => (
                  <div className="export-tree-row export-tree-room" key={room.roomId}>
                    <Checkbox
                      aria-label={`Include ${room.name} room plan`}
                      checked={room.planIncluded}
                      onCheckedChange={(checked) =>
                        setRoomPlans([room.roomId], checked === true)
                      }
                    />
                    <button
                      className="export-tree-label"
                      type="button"
                      onClick={() =>
                        setRoomPlans([room.roomId], !room.planIncluded)
                      }
                    >
                      {room.name}
                    </button>
                  </div>
                ))}
              </ExportSection>

              <ExportSection
                count={wallValues.filter(Boolean).length}
                countTotal={wallValues.length}
                label="Elevations"
                open={openSections.elevations}
                sectionState={selectionState(wallValues)}
                onOpenChange={(next) =>
                  setOpenSections((current) => ({
                    ...current,
                    elevations: next
                  }))
                }
                onToggle={() =>
                  handleParentToggle({
                    values: wallValues,
                    setAll: (included) =>
                      setElevations(
                        settings.rooms.flatMap((room) =>
                          selectableWalls(room).map((wall) => wall.wallId)
                        ),
                        included
                      )
                  })
                }
              >
                {settings.rooms.map((room) => {
                  const roomWallValues = selectableWalls(room).map(
                    (wall) => wall.included
                  );
                  const roomState = selectionState(roomWallValues);
                  return (
                    <Collapsible
                      className="export-tree-room-group"
                      defaultOpen={settings.rooms.length <= 3}
                      key={room.roomId}
                    >
                      <div className="export-tree-row export-tree-room export-tree-parent">
                        <CollapsibleTrigger asChild>
                          <button
                            aria-label={`Toggle ${room.name} walls`}
                            className="export-tree-disclosure"
                            type="button"
                          >
                            <CaretDownIcon aria-hidden="true" size={13} />
                          </button>
                        </CollapsibleTrigger>
                        <Checkbox
                          aria-label={`Include all elevations for ${room.name}`}
                          checked={roomState}
                          onCheckedChange={() =>
                            setElevations(
                              selectableWalls(room).map((wall) => wall.wallId),
                              roomState !== true
                            )
                          }
                        />
                        <button
                          className="export-tree-label"
                          type="button"
                          onClick={() =>
                            setElevations(
                              selectableWalls(room).map((wall) => wall.wallId),
                              roomState !== true
                            )
                          }
                        >
                          {room.name}
                        </button>
                        <span className="export-tree-count">
                          {roomWallValues.filter(Boolean).length} of{" "}
                          {roomWallValues.length}
                        </span>
                      </div>
                      <CollapsibleContent>
                        <div className="export-wall-list">
                          {/* Open walls render as explicit disabled rows rather
                              than vanishing: a wall the user knows exists,
                              silently missing from the tree, reads as a bug. */}
                          {room.walls.map((wall) => (
                            <div
                              className="export-tree-row export-tree-wall"
                              data-open={wall.isOpenSide ? "true" : undefined}
                              key={wall.wallId}
                            >
                              <Checkbox
                                aria-label={`Include ${room.name}, ${wall.name} elevation`}
                                checked={wall.included}
                                disabled={wall.isOpenSide}
                                onCheckedChange={(checked) =>
                                  setElevations(
                                    [wall.wallId],
                                    checked === true
                                  )
                                }
                              />
                              <button
                                className="export-tree-label"
                                type="button"
                                disabled={wall.isOpenSide}
                                onClick={() =>
                                  setElevations(
                                    [wall.wallId],
                                    !wall.included
                                  )
                                }
                              >
                                {wall.name}
                              </button>
                              {wall.isOpenSide ? (
                                <span className="export-tree-tag">Open</span>
                              ) : null}
                            </div>
                          ))}
                        </div>
                      </CollapsibleContent>
                    </Collapsible>
                  );
                })}
              </ExportSection>

              <ExportSection
                count={savedViewValues.filter(Boolean).length}
                countTotal={validSavedViews.length}
                disabled={validSavedViews.length === 0}
                label="3D views"
                open={openSections.threeDViews}
                sectionState={selectionState(savedViewValues)}
                onOpenChange={(next) =>
                  setOpenSections((current) => ({
                    ...current,
                    threeDViews: next
                  }))
                }
                onToggle={() =>
                  handleParentToggle({
                    values: savedViewValues,
                    setAll: (included) =>
                      setSavedViews(
                        validSavedViews.map((choice) => choice.view.id),
                        included
                      )
                  })
                }
              >
                {settings.savedViews.length > 0 ? (
                  <div className="export-saved-view-list">
                    {settings.savedViews.map((choice) => {
                      const { composedLabel, defaultTitle, isRenamed } =
                        composeSavedViewLabel(project, choice.view);
                      return (
                        <div
                          className="export-saved-view-row"
                          data-invalid={!choice.valid ? "" : undefined}
                          key={choice.view.id}
                        >
                          <Checkbox
                            aria-label={`Include ${composedLabel}`}
                            checked={choice.included}
                            disabled={!choice.valid}
                            onCheckedChange={(checked) =>
                              setSavedViews(
                                [choice.view.id],
                                checked === true
                              )
                            }
                          />
                          <SavedViewThumbnail
                            label={composedLabel}
                            src={thumbnailUrls[choice.view.id]}
                          />
                          <div className="export-saved-view-copy">
                            <strong>{composedLabel}</strong>
                            {choice.valid ? (
                              isRenamed && <span>{defaultTitle}</span>
                            ) : (
                              <span>
                                <WarningIcon aria-hidden="true" size={13} />
                                Invalid camera pose. Excluded from export.
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="export-empty-hint">
                    Save views from the 3D view to include them here.
                  </p>
                )}
              </ExportSection>
            </div>
          </section>

          <aside className="export-setup" aria-label="PDF preview and options">
            <ExportPdfPreview
              project={project}
              settings={settings}
              artworksById={artworksById}
              thumbnailUrls={thumbnailUrls}
            />
            {/* Preview stays pinned; only the controls scroll (print-dialog
                pattern), so Paper size is never stranded below the fold. */}
            <div className="export-setup-scroll">
            <section className="export-setup-group">
              <h3 className="export-group-title">Options</h3>
              <ExportSwitchRow
                checked={settings.dimensions}
                label="Show dimensions"
                onCheckedChange={(dimensions) =>
                  setPreferences((current) => ({
                    ...current,
                    dimensions
                  }))
                }
              />
              {settings.dimensions && (
                <div className="export-unit-rows">
                  <ExportUnitRow
                    label="Plan units"
                    value={settings.planUnit}
                    autoUnit={resolveDocumentExportUnit(
                      "auto",
                      project.unit,
                      "plan"
                    )}
                    onValueChange={(planUnit) =>
                      setPreferences((current) => ({ ...current, planUnit }))
                    }
                  />
                  <ExportUnitRow
                    label="Elevation units"
                    value={settings.elevationUnit}
                    autoUnit={resolveDocumentExportUnit(
                      "auto",
                      project.unit,
                      "elevation"
                    )}
                    onValueChange={(elevationUnit) =>
                      setPreferences((current) => ({
                        ...current,
                        elevationUnit
                      }))
                    }
                  />
                </div>
              )}
              <ExportSwitchRow
                checked={settings.grid}
                label="Show grid"
                onCheckedChange={(grid) =>
                  setPreferences((current) => ({ ...current, grid }))
                }
              />
              <label className="export-paper-field">
                <span>Paper size</span>
                <Select
                  value={settings.paperSize}
                  onValueChange={(paperSize) =>
                    setPreferences((current) => ({
                      ...current,
                      paperSize: paperSize as DocumentPaperSize
                    }))
                  }
                >
                  <SelectTrigger aria-label="Paper size">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PAPER_SIZE_GROUPS.map((group) => (
                      <SelectGroup key={group.label}>
                        <SelectLabel>{group.label}</SelectLabel>
                        {group.options.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    ))}
                  </SelectContent>
                </Select>
              </label>
              <p className="export-setup-note">
                Orientation is chosen automatically for each page.
              </p>
            </section>
            </div>
          </aside>
        </fieldset>

        <DialogFooter className="export-pdf-footer">
          {isExporting ? (
            <div className="export-progress">
              <Progress
                aria-label="Export progress"
                className="export-progress-bar"
                max={exportState.total}
                value={exportState.done}
              />
              <p className="export-progress-status" aria-live="polite">
                Composing your document…
              </p>
            </div>
          ) : (
            <div className="export-page-summary" aria-live="polite">
              {pageCount > 0 ? (
                <>
                  Exports <strong>{pageCount}</strong>{" "}
                  {pageCount === 1 ? "page" : "pages"}
                </>
              ) : (
                <span className="export-page-error">
                  Select at least one page.
                </span>
              )}
            </div>
          )}
          <div className="export-footer-actions">
            <Button
              variant="ghost"
              onClick={() =>
                isExporting ? onCancelExport?.() : onOpenChange(false)
              }
            >
              Cancel
            </Button>
            <Button
              disabled={isExporting || pageCount === 0}
              variant="primary"
              onClick={() => onExport(settings)}
            >
              {isExporting ? (
                <>
                  <CircleNotchIcon
                    aria-hidden="true"
                    className="animate-spin"
                    size={15}
                  />
                  Exporting…
                </>
              ) : (
                "Export PDF"
              )}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ExportSection({
  children,
  count,
  countTotal,
  disabled = false,
  label,
  open,
  sectionState,
  onOpenChange,
  onToggle
}: {
  children: React.ReactNode;
  count: number;
  countTotal?: number;
  disabled?: boolean;
  label: string;
  open: boolean;
  sectionState: boolean | "indeterminate";
  onOpenChange: (open: boolean) => void;
  onToggle: () => void;
}) {
  return (
    <Collapsible
      className="export-section"
      open={open}
      onOpenChange={onOpenChange}
    >
      <div className="export-section-row" data-disabled={disabled || undefined}>
        <CollapsibleTrigger asChild>
          <button
            aria-label={`${open ? "Collapse" : "Expand"} ${label}`}
            className="export-section-disclosure"
            type="button"
          >
            <CaretDownIcon aria-hidden="true" size={14} />
          </button>
        </CollapsibleTrigger>
        <Checkbox
          aria-label={`Include ${label}`}
          checked={sectionState}
          disabled={disabled}
          onCheckedChange={onToggle}
        />
        <button
          className="export-section-label"
          disabled={disabled}
          type="button"
          onClick={onToggle}
        >
          {label}
        </button>
        <span className="export-section-count">
          {countTotal === undefined ? count : `${count} of ${countTotal}`}
        </span>
      </div>
      <CollapsibleContent>
        <div className="export-section-content">{children}</div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function ExportSwitchRow({
  checked,
  label,
  onCheckedChange
}: {
  checked: boolean;
  label: string;
  onCheckedChange: (checked: boolean) => void;
}) {
  const id = useId();
  return (
    <label className="export-switch-row" htmlFor={id}>
      <strong>{label}</strong>
      <Switch
        aria-label={label}
        checked={checked}
        className="export-switch-control"
        id={id}
        onCheckedChange={onCheckedChange}
      />
    </label>
  );
}

// A compact unit picker reusing the Paper size row's exact label+Select
// structure (the row-grid select-trigger styling is finicky — see the Settings
// row-grid history — so this deliberately does not invent a new layout). The
// leading "Auto (…)" option resolves through the same function the pipeline
// uses, so the hint always matches what prints.
function ExportUnitRow({
  autoUnit,
  label,
  onValueChange,
  value
}: {
  autoUnit: string;
  label: string;
  onValueChange: (value: DocumentExportUnitPreference) => void;
  value: DocumentExportUnitPreference;
}) {
  return (
    <label className="export-paper-field">
      <span>{label}</span>
      <Select
        value={value}
        onValueChange={(next) =>
          onValueChange(next as DocumentExportUnitPreference)
        }
      >
        <SelectTrigger aria-label={label}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="auto">{`Auto (${autoUnit})`}</SelectItem>
          {EXPORT_UNIT_OPTIONS.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </label>
  );
}

function SavedViewThumbnail({
  label,
  src
}: {
  label: string;
  src?: string;
}) {
  return src ? (
    <img className="export-saved-view-thumbnail" src={src} alt={label} />
  ) : (
    <span
      aria-label={label}
      className="export-saved-view-thumbnail export-saved-view-placeholder"
      role="img"
    >
      <CubeIcon aria-hidden="true" size={22} />
    </span>
  );
}
