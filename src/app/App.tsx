import { useEffect, useMemo, useRef, useState } from "react";
import {
  Download,
  FileJson,
  Grid2X2,
  Grid3X3,
  ListChecks,
  Magnet,
  Plus,
  Redo2,
  Ruler,
  Save,
  Undo2,
  Upload
} from "lucide-react";
import {
  getWallsWithGeometry,
  getOrthogonalQuadWallPair,
  getRectangleRoomDimensions,
} from "../domain/geometry/walls";
import type { DisplayUnit, Project } from "../domain/project";
import { formatLength } from "../domain/units/length";
import { DataView } from "./components/DataView";
import { ElevationView } from "./components/ElevationView";
import { PlanView } from "./components/PlanView";
import { ProjectPicker } from "./components/ProjectPicker";
import { RoomDimensionFields } from "./components/RoomDimensionFields";
import { WallInspector, type WallDimensionLink } from "./components/WallInspector";
import { useViewPreferences } from "./hooks/useViewPreferences";
import {
  exportProjectJson,
  getProjectWalls,
  getSelectedWall,
  useAppStore
} from "./store";

export function App() {
  const {
    project,
    selectedWallId,
    viewMode,
    saveState,
    error,
    placementWarnings,
    lastGeometryEdit,
    undoStack,
    redoStack,
    boot,
    setViewMode,
    selectWall,
    addRectangleRoom,
    renameProject,
    setUnit,
    resizeSelectedWall,
    resizeWall,
    undo,
    redo,
    importProjectJson,
    listProjectSummaries,
    openProject,
    createProject,
    deleteProject
  } = useAppStore();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { showGrid, snapToGrid, toggleShowGrid, toggleSnapToGrid } = useViewPreferences();

  useEffect(() => {
    void boot();
  }, [boot]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!(event.metaKey || event.ctrlKey)) return;
      if (isEditableTarget(event.target)) return;

      const key = event.key.toLowerCase();
      if (key === "z") {
        event.preventDefault();
        void (event.shiftKey ? redo() : undo());
      } else if (key === "y") {
        event.preventDefault();
        void redo();
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [undo, redo]);

  const walls = useMemo(() => (project ? getProjectWalls(project) : []), [project]);
  const selectedWall = project ? getSelectedWall(project, selectedWallId) : null;
  const wallDimensionLink =
    project && selectedWall
      ? getWallDimensionLink(project, selectedWall.id)
      : null;

  if (!project) {
    return (
      <main className="loading-shell">
        <div className="skeleton-panel" />
      </main>
    );
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-lockup" aria-label="Sightlines">
          <div className="brand-mark">S</div>
          <div>
            <p className="app-name">Sightlines</p>
            <ProjectTitleInput title={project.title} onCommit={renameProject} />
          </div>
        </div>

        <div className="toolbar" aria-label="Project actions">
          <StatusBadge state={saveState} />
          <button
            className="icon-button"
            type="button"
            title="Undo"
            aria-label="Undo"
            disabled={undoStack.length === 0}
            onClick={() => void undo()}
          >
            <Undo2 aria-hidden="true" size={18} />
          </button>
          <button
            className="icon-button"
            type="button"
            title="Redo"
            aria-label="Redo"
            disabled={redoStack.length === 0}
            onClick={() => void redo()}
          >
            <Redo2 aria-hidden="true" size={18} />
          </button>
          <ProjectPicker
            currentProjectId={project.id}
            listProjectSummaries={listProjectSummaries}
            onCreateProject={createProject}
            onDeleteProject={deleteProject}
            onOpenProject={openProject}
          />
          <button
            className="icon-button"
            type="button"
            title="Import project JSON"
            aria-label="Import project JSON"
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload aria-hidden="true" size={18} />
          </button>
          <button
            className="icon-button"
            type="button"
            title="Export project JSON"
            aria-label="Export project JSON"
            onClick={() => downloadProject(project)}
          >
            <Download aria-hidden="true" size={18} />
          </button>
          <input
            ref={fileInputRef}
            className="visually-hidden"
            type="file"
            accept="application/json,.json"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (!file) return;
              void file.text().then(importProjectJson);
              event.target.value = "";
            }}
          />
        </div>
      </header>

      {error ? <p className="error-banner">{error}</p> : null}

      <section className="workspace">
        <aside className="sidebar" aria-label="Project structure">
          <div className="panel-heading">
            <h2>Gallery</h2>
            <div className="panel-heading-actions">
              <span>
                {project.floor.rooms.length} rooms · {walls.length} walls
              </span>
              <button
                aria-label="Add rectangular room"
                className="icon-button compact"
                title="Add rectangular room"
                type="button"
                onClick={() => void addRectangleRoom()}
              >
                <Plus aria-hidden="true" size={16} />
              </button>
            </div>
          </div>

          <nav className="room-list" aria-label="Rooms and walls">
            {project.floor.rooms.length === 0 ? (
              <p className="empty-copy">
                No rooms yet — draw one, or skip straight to the checklist.
              </p>
            ) : null}
            {project.floor.rooms.map((placement) => {
              const roomWalls = getWallsWithGeometry(placement.room);
              const rectangleDimensions = getRectangleRoomDimensions(placement.room);

              return (
                <section className="room-group" key={placement.roomId}>
                  <div className="room-heading">
                    <h3>{placement.room.name}</h3>
                    <span>{roomWalls.length} walls</span>
                  </div>
                  {rectangleDimensions ? (
                    <RoomDimensionFields
                      depthMm={rectangleDimensions.depthMm}
                      unit={project.unit}
                      widthMm={rectangleDimensions.widthMm}
                      onCommitDepth={(lengthMm) =>
                        resizeWall(rectangleDimensions.depthWallId, lengthMm)
                      }
                      onCommitWidth={(lengthMm) =>
                        resizeWall(rectangleDimensions.widthWallId, lengthMm)
                      }
                    />
                  ) : null}
                  <div className="wall-list">
                    {roomWalls.map((wall) => (
                      <button
                        className={
                          wall.id === selectedWall?.id ? "wall-row active" : "wall-row"
                        }
                        key={wall.id}
                        type="button"
                        onClick={() => selectWall(wall.id)}
                      >
                        <span>{wall.name}</span>
                        <strong>
                          {formatLength(wall.lengthMm, { unit: project.unit })}
                        </strong>
                      </button>
                    ))}
                  </div>
                </section>
              );
            })}
          </nav>

          <div className="storage-note">
            <Save aria-hidden="true" size={16} />
            <span>
              Saved locally in this browser. Export a backup for long-term
              safekeeping.
            </span>
          </div>
        </aside>

        <section className="canvas-column">
          <div className="view-toolbar">
            <div className="view-tabs" role="tablist" aria-label="Workspace view">
              <TabButton
                active={viewMode === "plan"}
                icon={<Grid2X2 aria-hidden="true" size={16} />}
                label="Plan"
                onClick={() => setViewMode("plan")}
              />
              <TabButton
                active={viewMode === "elevation"}
                icon={<Ruler aria-hidden="true" size={16} />}
                label="Elevation"
                onClick={() => setViewMode("elevation")}
              />
              <TabButton
                active={viewMode === "data"}
                icon={<FileJson aria-hidden="true" size={16} />}
                label="Data"
                onClick={() => setViewMode("data")}
              />
            </div>

            <div className="view-options" aria-label="View options">
              <ViewOptionButton
                active={showGrid}
                disabled={viewMode === "data"}
                icon={<Grid3X3 aria-hidden="true" size={16} />}
                label="Grid"
                title={showGrid ? "Hide grid" : "Show grid"}
                onClick={toggleShowGrid}
              />
              <ViewOptionButton
                active={snapToGrid}
                disabled={viewMode === "data"}
                icon={<Magnet aria-hidden="true" size={16} />}
                label="Snap"
                title={snapToGrid ? "Disable snap to grid" : "Enable snap to grid"}
                onClick={toggleSnapToGrid}
              />
              <UnitSelect
                disabled={viewMode === "data"}
                unit={project.unit}
                onChange={setUnit}
              />
            </div>
          </div>

          {viewMode === "plan" ? (
            <PlanView
              gridVisible={showGrid}
              project={project}
              selectedWallId={selectedWall?.id ?? null}
              snapToGrid={snapToGrid}
              onCommitWallLength={resizeWall}
            />
          ) : null}
          {viewMode === "elevation" ? (
            selectedWall ? (
              <ElevationView
                wallName={selectedWall.name}
                wallLengthMm={selectedWall.lengthMm}
                wallHeightMm={selectedWall.heightMm}
                centerlineMm={
                  selectedWall.defaultCenterlineHeightMm ??
                  project.defaultCenterlineHeightMm
                }
                gridVisible={showGrid}
                unit={project.unit}
              />
            ) : (
              <div className="drawing-surface-empty">
                <p className="empty-copy">
                  Add a room and select a wall to see its elevation.
                </p>
              </div>
            )
          ) : null}
          {viewMode === "data" ? <DataView json={exportProjectJson(project)} /> : null}
        </section>

        <aside className="inspector" aria-label="Inspector">
          <div className="panel-heading">
            <h2>Inspector</h2>
            <span>MVP 1A</span>
          </div>

          {selectedWall ? (
            <WallInspector
              centerlineMm={project.defaultCenterlineHeightMm}
              changedWallNames={getWallNames(
                project,
                lastGeometryEdit?.changedWallIds ?? []
              )}
              dimensionLink={wallDimensionLink}
              lastGeometryEdit={lastGeometryEdit}
              onCommitLength={resizeSelectedWall}
              placementWarnings={placementWarnings}
              unit={project.unit}
              wallHeightMm={selectedWall.heightMm}
              wallLengthMm={selectedWall.lengthMm}
              wallName={selectedWall.name}
            />
          ) : (
            <p className="empty-copy">Select a wall to inspect its measurements.</p>
          )}

          <div className="next-panel">
            <ListChecks aria-hidden="true" size={18} />
            <div>
              <h3>Checklist coming next</h3>
              <p>
                The domain model already separates library records, checklist
                membership, and wall placement.
              </p>
            </div>
          </div>
        </aside>
      </section>
    </main>
  );
}

function ProjectTitleInput({
  title,
  onCommit
}: {
  title: string;
  onCommit: (title: string) => Promise<void>;
}) {
  const [value, setValue] = useState(title);

  useEffect(() => {
    setValue(title);
  }, [title]);

  const commit = () => {
    if (value.trim().length === 0) {
      setValue(title);
      return;
    }

    void onCommit(value);
  };

  return (
    <input
      className="project-title"
      value={value}
      aria-label="Project title"
      onChange={(event) => setValue(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key !== "Enter") return;
        event.preventDefault();
        event.currentTarget.blur();
      }}
    />
  );
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;

  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target.isContentEditable
  );
}

function TabButton({
  active,
  icon,
  label,
  onClick
}: {
  active: boolean;
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      className={active ? "tab-button active" : "tab-button"}
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

function ViewOptionButton({
  active,
  disabled,
  icon,
  label,
  title,
  onClick
}: {
  active: boolean;
  disabled: boolean;
  icon: React.ReactNode;
  label: string;
  title: string;
  onClick: () => void;
}) {
  return (
    <button
      aria-pressed={active}
      className={active ? "view-option-button active" : "view-option-button"}
      disabled={disabled}
      type="button"
      title={title}
      onClick={onClick}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

function UnitSelect({
  disabled,
  unit,
  onChange
}: {
  disabled: boolean;
  unit: DisplayUnit;
  onChange: (unit: DisplayUnit) => void;
}) {
  return (
    <label className="unit-select">
      <span className="unit-select-label">Units</span>
      <select
        disabled={disabled}
        value={unit}
        onChange={(event) => onChange(event.target.value as DisplayUnit)}
      >
        <optgroup label="Imperial">
          <option value="ft">ft</option>
          <option value="in">in</option>
        </optgroup>
        <optgroup label="Metric">
          <option value="m">m</option>
          <option value="cm">cm</option>
        </optgroup>
      </select>
    </label>
  );
}

function StatusBadge({ state }: { state: "idle" | "saving" | "saved" | "error" }) {
  const label =
    state === "saving"
      ? "Saving"
      : state === "saved"
        ? "Saved"
        : state === "error"
          ? "Save issue"
          : "Idle";

  return <span className={`status-badge ${state}`}>{label}</span>;
}

function getWallDimensionLink(
  project: Project,
  wallId: string
): WallDimensionLink | null {
  for (const placement of project.floor.rooms) {
    const pair = getOrthogonalQuadWallPair(placement.room, wallId);
    if (!pair) continue;

    return {
      pairedWallName: pair.pairedWall.name,
      roomName: placement.room.name
    };
  }

  return null;
}

function getWallNames(project: Project, wallIds: string[]): string[] {
  if (wallIds.length === 0) return [];

  const namesById = new Map(
    project.floor.rooms.flatMap((placement) =>
      placement.room.walls.map((wall) => [wall.id, wall.name])
    )
  );

  return wallIds.map((wallId) => namesById.get(wallId) ?? wallId);
}

function downloadProject(project: Project) {
  const blob = new Blob([exportProjectJson(project)], {
    type: "application/json"
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${project.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.json`;
  link.click();
  URL.revokeObjectURL(url);
}
