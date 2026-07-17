import { useMemo, useState } from "react";
import { CaretDownIcon } from "@phosphor-icons/react/dist/csr/CaretDown";
import { CheckIcon } from "@phosphor-icons/react/dist/csr/Check";
import { CircleNotchIcon } from "@phosphor-icons/react/dist/csr/CircleNotch";
import { CubeIcon } from "@phosphor-icons/react/dist/csr/Cube";
import { PencilSimpleIcon } from "@phosphor-icons/react/dist/csr/PencilSimple";
import { TrashIcon } from "@phosphor-icons/react/dist/csr/Trash";
import { WarningIcon } from "@phosphor-icons/react/dist/csr/Warning";
import { XIcon } from "@phosphor-icons/react/dist/csr/X";
import {
  countDocumentPages,
  selectionState,
  type DocumentExportPreferences,
  type DocumentPaperSize,
  type DocumentSectionId,
  type EffectiveDocumentSettings
} from "../../domain/export/documentSettings";
import type { Project, SavedView } from "../../domain/project";
import { resolveSavedViewRoomLabel } from "../../domain/savedViews";
import { useDocumentExportPreferences } from "../hooks/useDocumentExportPreferences";
import { Button } from "./ui/button";
import { Checkbox } from "./ui/checkbox";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger
} from "./ui/collapsible";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "./ui/dialog";
import { Input } from "./ui/input";
import { Progress } from "./ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "./ui/select";
import { Switch } from "./ui/switch";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from "./ui/tooltip";

const PAPER_SIZE_OPTIONS: {
  value: DocumentPaperSize;
  label: string;
}[] = [
  { value: "a4", label: "A4" },
  { value: "letter", label: "Letter" },
  { value: "a3", label: "A3" },
  { value: "tabloid", label: "Tabloid 11 × 17" }
];

type ExportPdfDialogProps = {
  open: boolean;
  project: Project;
  onOpenChange: (open: boolean) => void;
  onExport: (settings: EffectiveDocumentSettings) => void;
  onRenameSavedView: (viewId: string, title: string) => Promise<void>;
  onDeleteSavedView: (viewId: string) => Promise<void>;
  onPersistenceError?: (message: string) => void;
  thumbnailUrls?: Readonly<Record<string, string>>;
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
  onRenameSavedView,
  onDeleteSavedView,
  onPersistenceError,
  thumbnailUrls = {},
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
  const [editingViewId, setEditingViewId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState("");
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

  const handleParentToggle = ({
    sectionId,
    values,
    setAll
  }: {
    sectionId: Exclude<DocumentSectionId, "overview">;
    values: readonly boolean[];
    setAll: (included: boolean) => void;
  }) => {
    const enabled = settings.sections[sectionId];
    const state = selectionState(values);
    if (!enabled) {
      setSection(sectionId, true);
      if (state === false) setAll(true);
    } else if (state !== true) {
      setAll(true);
    } else {
      setSection(sectionId, false);
    }
  };

  const startRename = (view: SavedView) => {
    setEditingViewId(view.id);
    setDraftTitle(view.title);
  };

  const cancelRename = () => {
    setEditingViewId(null);
    setDraftTitle("");
  };

  const commitRename = async (view: SavedView) => {
    const title = draftTitle.trim();
    if (!title) {
      setDraftTitle(view.title);
      return;
    }
    cancelRename();
    await onRenameSavedView(view.id, title);
  };

  const roomPlanValues = settings.rooms.map((room) => room.planIncluded);
  const wallValues = settings.rooms.flatMap((room) =>
    room.walls.map((wall) => wall.included)
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
                count={
                  settings.sections.roomPlans
                    ? roomPlanValues.filter(Boolean).length
                    : 0
                }
                countTotal={settings.rooms.length}
                label="Room plans"
                open={openSections.roomPlans}
                sectionState={
                  settings.sections.roomPlans
                    ? selectionState(roomPlanValues)
                    : false
                }
                onOpenChange={(next) =>
                  setOpenSections((current) => ({
                    ...current,
                    roomPlans: next
                  }))
                }
                onToggle={() =>
                  handleParentToggle({
                    sectionId: "roomPlans",
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
                count={
                  settings.sections.elevations
                    ? wallValues.filter(Boolean).length
                    : 0
                }
                countTotal={wallValues.length}
                label="Elevations"
                open={openSections.elevations}
                sectionState={
                  settings.sections.elevations
                    ? selectionState(wallValues)
                    : false
                }
                onOpenChange={(next) =>
                  setOpenSections((current) => ({
                    ...current,
                    elevations: next
                  }))
                }
                onToggle={() =>
                  handleParentToggle({
                    sectionId: "elevations",
                    values: wallValues,
                    setAll: (included) =>
                      setElevations(
                        settings.rooms.flatMap((room) =>
                          room.walls.map((wall) => wall.wallId)
                        ),
                        included
                      )
                  })
                }
              >
                {settings.rooms.map((room) => {
                  const roomWallValues = room.walls.map(
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
                              room.walls.map((wall) => wall.wallId),
                              roomState !== true
                            )
                          }
                        />
                        <button
                          className="export-tree-label"
                          type="button"
                          onClick={() =>
                            setElevations(
                              room.walls.map((wall) => wall.wallId),
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
                          {room.walls.map((wall) => (
                            <div
                              className="export-tree-row export-tree-wall"
                              key={wall.wallId}
                            >
                              <Checkbox
                                aria-label={`Include ${room.name}, ${wall.name} elevation`}
                                checked={wall.included}
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
                                onClick={() =>
                                  setElevations(
                                    [wall.wallId],
                                    !wall.included
                                  )
                                }
                              >
                                {wall.name}
                              </button>
                            </div>
                          ))}
                        </div>
                      </CollapsibleContent>
                    </Collapsible>
                  );
                })}
              </ExportSection>

              <ExportSection
                count={
                  settings.sections.threeDViews
                    ? savedViewValues.filter(Boolean).length
                    : 0
                }
                countTotal={validSavedViews.length}
                disabled={validSavedViews.length === 0}
                label="3D views"
                open={openSections.threeDViews}
                sectionState={
                  settings.sections.threeDViews
                    ? selectionState(savedViewValues)
                    : false
                }
                onOpenChange={(next) =>
                  setOpenSections((current) => ({
                    ...current,
                    threeDViews: next
                  }))
                }
                onToggle={() =>
                  handleParentToggle({
                    sectionId: "threeDViews",
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
                      const roomLabel = resolveSavedViewRoomLabel(
                        project,
                        choice.view
                      );
                      const composedLabel = roomLabel
                        ? `${roomLabel} · ${choice.view.title}`
                        : choice.view.title;
                      const isEditing = editingViewId === choice.view.id;
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
                          {isEditing ? (
                            <form
                              className="export-saved-view-rename"
                              onSubmit={(event) => {
                                event.preventDefault();
                                void commitRename(choice.view);
                              }}
                            >
                              <Input
                                aria-label={`Rename ${composedLabel}`}
                                autoFocus
                                size="compact"
                                value={draftTitle}
                                onChange={(event) =>
                                  setDraftTitle(event.target.value)
                                }
                                onKeyDown={(event) => {
                                  if (event.key === "Escape") {
                                    event.preventDefault();
                                    cancelRename();
                                  }
                                }}
                              />
                              <Button
                                aria-label="Save view title"
                                className="icon-button compact"
                                disabled={!draftTitle.trim()}
                                size="icon-sm"
                                type="submit"
                                variant="ghost"
                              >
                                <CheckIcon aria-hidden="true" size={14} />
                              </Button>
                              <Button
                                aria-label="Cancel rename"
                                className="icon-button compact"
                                size="icon-sm"
                                variant="ghost"
                                onClick={cancelRename}
                              >
                                <XIcon aria-hidden="true" size={14} />
                              </Button>
                            </form>
                          ) : (
                            <>
                              <div className="export-saved-view-copy">
                                <strong>{composedLabel}</strong>
                                {choice.valid ? (
                                  choice.view.title.trim() !==
                                    `Saved view ${choice.view.ordinal}` && (
                                    <span>
                                      {`Saved view ${choice.view.ordinal}`}
                                    </span>
                                  )
                                ) : (
                                  <span>
                                    <WarningIcon
                                      aria-hidden="true"
                                      size={13}
                                    />
                                    Invalid camera pose. Excluded from export.
                                  </span>
                                )}
                              </div>
                              <div className="export-saved-view-actions">
                                <IconTooltip label={`Rename ${composedLabel}`}>
                                  <Button
                                    aria-label={`Rename ${composedLabel}`}
                                    className="icon-button compact"
                                    size="icon-sm"
                                    variant="ghost"
                                    onClick={() => startRename(choice.view)}
                                  >
                                    <PencilSimpleIcon
                                      aria-hidden="true"
                                      size={14}
                                    />
                                  </Button>
                                </IconTooltip>
                                <IconTooltip label={`Delete ${composedLabel}`}>
                                  <Button
                                    aria-label={`Delete ${composedLabel}`}
                                    className="icon-button compact"
                                    size="icon-sm"
                                    variant="ghost"
                                    onClick={() =>
                                      void onDeleteSavedView(choice.view.id)
                                    }
                                  >
                                    <TrashIcon
                                      aria-hidden="true"
                                      size={14}
                                    />
                                  </Button>
                                </IconTooltip>
                              </div>
                            </>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="export-empty-hint">
                    Save views from the 3D window to include them here.
                  </p>
                )}
              </ExportSection>
            </div>
          </section>

          <aside className="export-setup" aria-label="PDF options and page setup">
            <section className="export-setup-group">
              <h3 className="export-group-title">Options</h3>
              <ExportSwitchRow
                checked={settings.dimensions}
                description="Automatic measurements"
                label="Dimensions"
                onCheckedChange={(dimensions) =>
                  setPreferences((current) => ({
                    ...current,
                    dimensions
                  }))
                }
              />
              <ExportSwitchRow
                checked={settings.grid}
                description="Show the drawing grid"
                label="Grid"
                onCheckedChange={(grid) =>
                  setPreferences((current) => ({ ...current, grid }))
                }
              />
            </section>

            <section className="export-setup-group">
              <h3 className="export-group-title">Page setup</h3>
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
                    {PAPER_SIZE_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>
              <p className="export-setup-note">
                Orientation is chosen automatically for each page.
              </p>
            </section>
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
      <div className="export-section-row">
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
  description,
  label,
  onCheckedChange
}: {
  checked: boolean;
  description: string;
  label: string;
  onCheckedChange: (checked: boolean) => void;
}) {
  const id = useMemo(
    () => `export-${label.toLowerCase().replace(/\s+/g, "-")}`,
    [label]
  );
  return (
    <label className="export-switch-row" htmlFor={id}>
      <Switch
        aria-label={label}
        checked={checked}
        className="export-switch-control"
        id={id}
        onCheckedChange={onCheckedChange}
      />
      <span>
        <strong>{label}</strong>
        <small>{description}</small>
      </span>
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

function IconTooltip({
  children,
  label
}: {
  children: React.ReactElement;
  label: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
