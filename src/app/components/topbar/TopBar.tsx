import type { RefObject } from "react";
import { ArrowClockwiseIcon } from "@phosphor-icons/react/dist/csr/ArrowClockwise";
import { ArrowCounterClockwiseIcon } from "@phosphor-icons/react/dist/csr/ArrowCounterClockwise";
import { ArchiveIcon } from "@phosphor-icons/react/dist/csr/Archive";
import { CameraIcon } from "@phosphor-icons/react/dist/csr/Camera";
import { CaretDownIcon } from "@phosphor-icons/react/dist/csr/CaretDown";
import { CircleNotchIcon } from "@phosphor-icons/react/dist/csr/CircleNotch";
import { FilePdfIcon } from "@phosphor-icons/react/dist/csr/FilePdf";
import { DownloadSimpleIcon } from "@phosphor-icons/react/dist/csr/DownloadSimple";
import { FileDashedIcon } from "@phosphor-icons/react/dist/csr/FileDashed";
import { FloppyDiskIcon } from "@phosphor-icons/react/dist/csr/FloppyDisk";
import { MapTrifoldIcon } from "@phosphor-icons/react/dist/csr/MapTrifold";
import { PackageIcon } from "@phosphor-icons/react/dist/csr/Package";
import { PresentationIcon } from "@phosphor-icons/react/dist/csr/Presentation";
import { CubeIcon } from "@phosphor-icons/react/dist/csr/Cube";
import { UploadSimpleIcon } from "@phosphor-icons/react/dist/csr/UploadSimple";
import type { Project, Wall } from "../../../domain/project";
import type { PackageExportMode } from "../../../domain/schema/packageSchema";
import {
  getStorageNoteCopy,
  type StoragePersistenceState
} from "../../hooks/useStoragePersistence";
import type { AppState, ViewMode } from "../../store";
import { ProjectPicker } from "../library/ProjectPicker";
import { StatusBadge } from "../toolbar";
import { ToolbarTooltipKbd } from "../toolbar/ToolbarTooltipKbd";
import { Button } from "../ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger
} from "../ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import {
  UnderlineToggleGroup,
  UnderlineToggleGroupItem
} from "../ui/segmented";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from "../ui/tooltip";
import { ProjectTitleInput } from "./ProjectTitleInput";

type TopBarProps = {
  project: Project;
  viewMode: ViewMode;
  setViewMode: AppState["setViewMode"];
  selectedWall: Wall | null;
  saveState: AppState["saveState"];
  undoStack: AppState["undoStack"];
  redoStack: AppState["redoStack"];
  undo: AppState["undo"];
  redo: AppState["redo"];
  renameProject: AppState["renameProject"];
  listProjectSummaries: AppState["listProjectSummaries"];
  createProject: AppState["createProject"];
  deleteProject: AppState["deleteProject"];
  duplicateProject: AppState["duplicateProject"];
  openProject: AppState["openProject"];
  renameProjectById: AppState["renameProjectById"];
  storagePersistence: StoragePersistenceState;
  retryStoragePersistence: () => void;
  isExportingPackage: boolean;
  handleExportPackage: (mode: PackageExportMode) => Promise<void>;
  handleExportProjectById: (id: string) => Promise<void>;
  handleExportImage: (format?: "png" | "jpeg") => Promise<void>;
  handleImportFile: (file: File) => Promise<void>;
  setIsSettingsOpen: (open: boolean) => void;
  setIsExportPdfOpen: (open: boolean) => void;
  fileInputRef: RefObject<HTMLInputElement>;
};

export function TopBar({
  project,
  viewMode,
  setViewMode,
  selectedWall,
  saveState,
  undoStack,
  redoStack,
  undo,
  redo,
  renameProject,
  listProjectSummaries,
  createProject,
  deleteProject,
  duplicateProject,
  openProject,
  renameProjectById,
  storagePersistence,
  retryStoragePersistence,
  isExportingPackage,
  handleExportPackage,
  handleExportProjectById,
  handleExportImage,
  handleImportFile,
  setIsSettingsOpen,
  setIsExportPdfOpen,
  fileInputRef
}: TopBarProps) {
  return (
    <header className="topbar">
      <div className="topbar-left">
        <p className="app-name">Sightlines</p>
        <div className="brand-divider" aria-hidden="true" />
        <div className="project-switcher">
          <ProjectTitleInput title={project.title} onCommit={renameProject} />
          <ProjectPicker
            currentProjectId={project.id}
            listProjectSummaries={listProjectSummaries}
            onCreateProject={createProject}
            onDeleteProject={deleteProject}
            onDuplicateProject={duplicateProject}
            onExportProject={handleExportProjectById}
            onOpenProject={openProject}
            onRenameProject={renameProjectById}
          />
        </div>
      </div>

      <div className="view-tabs topbar-center">
        <UnderlineToggleGroup
          aria-label="Workspace view"
          className="view-tabs"
          orientation="horizontal"
          type="single"
          value={viewMode}
          onValueChange={(value) => {
            if (value === "plan" || value === "elevation" || value === "3d") {
              setViewMode(value);
            }
          }}
        >
          <Tooltip>
            <TooltipTrigger asChild>
              <UnderlineToggleGroupItem value="plan">
                <MapTrifoldIcon aria-hidden="true" size={16} />
                <span>Plan</span>
              </UnderlineToggleGroupItem>
            </TooltipTrigger>
            <TooltipContent className="toolbar-tooltip" side="bottom">
              View rooms from above
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <UnderlineToggleGroupItem value="elevation">
                <PresentationIcon aria-hidden="true" size={16} />
                <span>Elevation</span>
              </UnderlineToggleGroupItem>
            </TooltipTrigger>
            <TooltipContent className="toolbar-tooltip" side="bottom">
              View one wall straight on
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <UnderlineToggleGroupItem value="3d">
                <CubeIcon aria-hidden="true" size={16} />
                <span>3D</span>
              </UnderlineToggleGroupItem>
            </TooltipTrigger>
            <TooltipContent className="toolbar-tooltip" side="bottom">
              Preview exhibition in 3D
            </TooltipContent>
          </Tooltip>
        </UnderlineToggleGroup>
      </div>

      <div className="topbar-right" aria-label="Project actions">
        <Popover>
          <Tooltip>
            <TooltipTrigger asChild>
              <PopoverTrigger asChild>
                <StatusBadge state={saveState} />
              </PopoverTrigger>
            </TooltipTrigger>
            <TooltipContent className="toolbar-tooltip" side="bottom">
              Saved automatically on this device. Open for details.
            </TooltipContent>
          </Tooltip>
          <PopoverContent side="bottom" align="end" className="storage-popover">
            <div className="storage-popover-heading">
              <FloppyDiskIcon aria-hidden="true" size={16} />
              <h3>Where your work is saved</h3>
            </div>
            <p className="storage-popover-body">{getStorageNoteCopy(storagePersistence)}</p>
            {storagePersistence === "denied" ? (
              <Button
                className="storage-popover-retry"
                size="sm"
                variant="ghost"
                onClick={retryStoragePersistence}
              >
                Retry
              </Button>
            ) : null}
            <div className="storage-popover-footer">
              <Button
                size="sm"
                variant="outline"
                onClick={() => void handleExportPackage("display")}
              >
                Export a backup
              </Button>
              <Button size="sm" variant="outline" onClick={() => setIsSettingsOpen(true)}>
                Storage settings
              </Button>
            </div>
          </PopoverContent>
        </Popover>
        <div className="toolbar-group">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                className="icon-button"
                aria-label="Undo"
                disabled={undoStack.length === 0}
                size="icon"
                variant="ghost"
                onClick={() => void undo()}
              >
                <ArrowCounterClockwiseIcon aria-hidden="true" size={18} />
              </Button>
            </TooltipTrigger>
            <TooltipContent className="toolbar-tooltip" side="bottom">
              Undo
              <ToolbarTooltipKbd hint="⌘Z" />
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                className="icon-button"
                aria-label="Redo"
                disabled={redoStack.length === 0}
                size="icon"
                variant="ghost"
                onClick={() => void redo()}
              >
                <ArrowClockwiseIcon aria-hidden="true" size={18} />
              </Button>
            </TooltipTrigger>
            <TooltipContent className="toolbar-tooltip" side="bottom">
              Redo
              <ToolbarTooltipKbd hint="⇧⌘Z" />
            </TooltipContent>
          </Tooltip>
        </div>
        <div className="toolbar-divider" aria-hidden="true" />
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              className="icon-button"
              aria-label="Import a project file (.sightlines)"
              size="icon"
              variant="ghost"
              onClick={() => fileInputRef.current?.click()}
            >
              <UploadSimpleIcon aria-hidden="true" size={18} />
            </Button>
          </TooltipTrigger>
          <TooltipContent className="toolbar-tooltip" side="bottom">
            Import project (.sightlines)
          </TooltipContent>
        </Tooltip>
        {viewMode === "library" ? null : viewMode === "3d" ? (
          <div className="snapshot-split">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  className="icon-button"
                  aria-label="Export image of 3D view (PNG)"
                  disabled={project.floor.rooms.length === 0}
                  size="icon"
                  variant="ghost"
                  onClick={() => void handleExportImage("png")}
                >
                  <CameraIcon aria-hidden="true" size={18} />
                </Button>
              </TooltipTrigger>
              <TooltipContent className="toolbar-tooltip" side="bottom">
                Download view as PNG
              </TooltipContent>
            </Tooltip>
            <DropdownMenu modal={false}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <DropdownMenuTrigger asChild>
                    <Button
                      className="icon-button compact"
                      aria-label="Choose image format"
                      disabled={project.floor.rooms.length === 0}
                      size="icon"
                      variant="ghost"
                    >
                      <CaretDownIcon aria-hidden="true" size={14} />
                    </Button>
                  </DropdownMenuTrigger>
                </TooltipTrigger>
                <TooltipContent className="toolbar-tooltip" side="bottom">
                  Choose download format
                </TooltipContent>
              </Tooltip>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  disabled={project.floor.rooms.length === 0}
                  onSelect={() => void handleExportImage("jpeg")}
                >
                  Download as JPG
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ) : (
          (() => {
            const disabledReason =
              project.floor.rooms.length === 0
                ? "Add a room first"
                : viewMode === "elevation" && !selectedWall
                  ? "Select a wall first"
                  : null;
            const label = `Export image of ${viewMode === "plan" ? "plan" : "elevation"} (PNG)`;
            const button = (
              <Button
                className="icon-button"
                aria-label={label}
                disabled={disabledReason !== null}
                size="icon"
                variant="ghost"
                onClick={() => void handleExportImage("png")}
              >
                <CameraIcon aria-hidden="true" size={18} />
              </Button>
            );
            // Disabled buttons drop pointer events, so the hint rides a span
            // under the Tooltip (asChild on a plain span keeps them reachable
            // on hover AND focus, replacing the old pointer-only title hack).
            return (
              <Tooltip>
                <TooltipTrigger asChild>
                  {disabledReason ? <span>{button}</span> : button}
                </TooltipTrigger>
                <TooltipContent className="toolbar-tooltip" side="bottom">
                  {disabledReason ?? "Download view as PNG"}
                </TooltipContent>
              </Tooltip>
            );
          })()
        )}
        {/* modal={false}: this menu launches the Export PDF dialog, and a
            modal menu's body pointer-events lock can be captured as the
            dialog's "restore" value while the menu's exit animation overlaps
            the dialog mount — cancelling the dialog then re-applies
            pointer-events:none to body and freezes the app. */}
        <DropdownMenu modal={false}>
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                <Button
                  className="topbar-button"
                  aria-label="Export"
                  aria-busy={isExportingPackage}
                  disabled={isExportingPackage}
                  size="default"
                  variant="outline"
                >
                  {isExportingPackage ? (
                    <CircleNotchIcon aria-hidden="true" className="animate-spin" size={18} />
                  ) : (
                    <DownloadSimpleIcon aria-hidden="true" size={18} />
                  )}
                  <span>{isExportingPackage ? "Exporting…" : "Export"}</span>
                  <CaretDownIcon aria-hidden="true" className="topbar-button-caret" size={14} />
                </Button>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent className="toolbar-tooltip" side="bottom">
              Export PDF or project backup
            </TooltipContent>
          </Tooltip>
          <DropdownMenuContent align="end" className="w-72">
            <DropdownMenuItem
              className="dropdown-menu-item-stacked"
              disabled={project.floor.rooms.length === 0}
              onSelect={() => setIsExportPdfOpen(true)}
            >
              <FilePdfIcon aria-hidden="true" size={16} />
              <span className="flex min-w-0 flex-col gap-0.5">
                <span>Export PDF…</span>
                <span className="[font-size:var(--type-xs)] leading-snug text-muted-foreground">
                  Composed pages: overview, room plans, elevations, 3D views
                </span>
              </span>
            </DropdownMenuItem>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger className="dropdown-menu-item-stacked">
                <PackageIcon aria-hidden="true" size={16} />
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span>Project backup (.sightlines)</span>
                  <span className="[font-size:var(--type-xs)] leading-snug text-muted-foreground">
                    Portable project file for backup or handoff
                  </span>
                </span>
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuItem
                  className="dropdown-menu-item-stacked"
                  onSelect={() => void handleExportPackage("display")}
                >
                  <PackageIcon aria-hidden="true" size={16} />
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span>Standard</span>
                    <span className="[font-size:var(--type-xs)] leading-snug text-muted-foreground">
                      Display-quality images. Recommended for sharing and backup.
                    </span>
                  </span>
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="dropdown-menu-item-stacked"
                  onSelect={() => void handleExportPackage("originals")}
                >
                  <ArchiveIcon aria-hidden="true" size={16} />
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span>With originals</span>
                    <span className="[font-size:var(--type-xs)] leading-snug text-muted-foreground">
                      Adds full-resolution files. Largest export; archival handoff.
                    </span>
                  </span>
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="dropdown-menu-item-stacked"
                  onSelect={() => void handleExportPackage("metadata-only")}
                >
                  <FileDashedIcon aria-hidden="true" size={16} />
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span>Without images</span>
                    <span className="[font-size:var(--type-xs)] leading-snug text-muted-foreground">
                      Checklist and layout only. Relinks images on machines that have them.
                    </span>
                  </span>
                </DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          </DropdownMenuContent>
        </DropdownMenu>
        <input
          ref={fileInputRef}
          aria-label="Import a project file (.sightlines)"
          className="visually-hidden"
          type="file"
          accept="application/json,.json,.sightlines,application/zip"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (!file) return;
            void handleImportFile(file);
            event.target.value = "";
          }}
        />
      </div>
    </header>
  );
}
