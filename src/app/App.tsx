import { useEffect, useMemo, useRef, useState } from "react";
import {
  Download,
  FileJson,
  Grid2X2,
  Grid3X3,
  Link2,
  ListChecks,
  Ruler,
  Save,
  Upload,
  AlertTriangle
} from "lucide-react";
import {
  getOrthogonalQuadWallPair,
  getPlacedRoomBounds
} from "../domain/geometry/walls";
import { formatLength, parseLength } from "../domain/units/length";
import {
  exportProjectJson,
  getProjectWalls,
  getSelectedWall,
  useAppStore
} from "./store";

type Project = NonNullable<ReturnType<typeof useAppStore.getState>["project"]>;

type WallDimensionLink = {
  pairedWallName: string;
  roomName: string;
};

export function App() {
  const {
    project,
    selectedWallId,
    viewMode,
    saveState,
    error,
    placementWarnings,
    lastGeometryEdit,
    boot,
    setViewMode,
    selectWall,
    renameProject,
    resizeSelectedWall,
    importProjectJson
  } = useAppStore();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [gridVisible, setGridVisible] = useState(false);

  useEffect(() => {
    void boot();
  }, [boot]);

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
            <input
              className="project-title"
              value={project.title}
              aria-label="Project title"
              onChange={(event) => void renameProject(event.target.value)}
            />
          </div>
        </div>

        <div className="toolbar" aria-label="Project actions">
          <StatusBadge state={saveState} />
          <button
            className="icon-button"
            type="button"
            title="Import project JSON"
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload aria-hidden="true" size={18} />
          </button>
          <button
            className="icon-button"
            type="button"
            title="Export project JSON"
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
            <span>{walls.length} walls</span>
          </div>

          <nav className="wall-list" aria-label="Walls">
            {walls.map((wall) => (
              <button
                className={wall.id === selectedWall?.id ? "wall-row active" : "wall-row"}
                key={wall.id}
                type="button"
                onClick={() => selectWall(wall.id)}
              >
                <span>{wall.name}</span>
                <strong>{formatLength(wall.lengthMm, { unit: project.unit })}</strong>
              </button>
            ))}
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
                active={gridVisible}
                disabled={viewMode === "data"}
                icon={<Grid3X3 aria-hidden="true" size={16} />}
                label="Grid"
                onClick={() => setGridVisible((visible) => !visible)}
              />
            </div>
          </div>

          {viewMode === "plan" ? (
            <PlanView
              gridVisible={gridVisible}
              project={project}
              selectedWallId={selectedWall?.id ?? null}
            />
          ) : null}
          {viewMode === "elevation" && selectedWall ? (
            <ElevationView
              wallName={selectedWall.name}
              wallLengthMm={selectedWall.lengthMm}
              wallHeightMm={selectedWall.heightMm}
              centerlineMm={
                selectedWall.defaultCenterlineHeightMm ??
                project.defaultCenterlineHeightMm
              }
              gridVisible={gridVisible}
              unit={project.unit}
            />
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

function PlanView({
  gridVisible,
  project,
  selectedWallId
}: {
  gridVisible: boolean;
  project: Project;
  selectedWallId: string | null;
}) {
  const placement = project.floor.rooms[0];
  const bounds = getPlacedRoomBounds(placement);
  const padding = 900;
  const viewBoxBounds = {
    x: bounds.minX - padding,
    y: bounds.minY - padding,
    width: bounds.width + padding * 2,
    height: bounds.height + padding * 2
  };
  const viewBox = `${viewBoxBounds.x} ${viewBoxBounds.y} ${viewBoxBounds.width} ${viewBoxBounds.height}`;
  const gridSpacingMm = getGridSpacingMm(project.unit);

  return (
    <div className="drawing-surface" aria-label="Plan view">
      <svg className="plan-svg" viewBox={viewBox} role="img">
        <title>{placement.room.name} plan</title>
        {gridVisible ? (
          <GridOverlay
            id="plan-grid"
            height={viewBoxBounds.height}
            spacingMm={gridSpacingMm}
            width={viewBoxBounds.width}
            x={viewBoxBounds.x}
            y={viewBoxBounds.y}
          />
        ) : null}
        <polygon
          className="room-fill"
          points={placement.room.vertices
            .map(
              (vertex) =>
                `${vertex.xMm + placement.offsetXMm},${vertex.yMm + placement.offsetYMm}`
            )
            .join(" ")}
        />
        {placement.room.walls.map((wall) => {
          const start = placement.room.vertices.find(
            (vertex) => vertex.id === wall.startVertexId
          );
          const end = placement.room.vertices.find(
            (vertex) => vertex.id === wall.endVertexId
          );
          if (!start || !end) return null;

          return (
            <line
              className={wall.id === selectedWallId ? "wall-line active" : "wall-line"}
              key={wall.id}
              x1={start.xMm + placement.offsetXMm}
              y1={start.yMm + placement.offsetYMm}
              x2={end.xMm + placement.offsetXMm}
              y2={end.yMm + placement.offsetYMm}
              vectorEffect="non-scaling-stroke"
            />
          );
        })}
      </svg>
    </div>
  );
}

function ElevationView({
  gridVisible,
  wallName,
  wallLengthMm,
  wallHeightMm,
  centerlineMm,
  unit
}: {
  gridVisible: boolean;
  wallName: string;
  wallLengthMm: number;
  wallHeightMm: number;
  centerlineMm: number;
  unit: "in" | "ft" | "cm" | "m";
}) {
  const viewBox = `0 0 ${wallLengthMm} ${wallHeightMm}`;
  const gridSpacingMm = getGridSpacingMm(unit);

  return (
    <div className="drawing-surface" aria-label="Wall elevation view">
      <div className="surface-label">
        <strong>{wallName}</strong>
        <span>
          {formatLength(wallLengthMm, { unit })} by{" "}
          {formatLength(wallHeightMm, { unit })}
        </span>
      </div>
      <svg className="elevation-svg" viewBox={viewBox} role="img">
        <title>{wallName} elevation</title>
        <rect className="wall-fill" x="0" y="0" width={wallLengthMm} height={wallHeightMm} />
        {gridVisible ? (
          <GridOverlay
            id="elevation-grid"
            height={wallHeightMm}
            spacingMm={gridSpacingMm}
            width={wallLengthMm}
            x={0}
            y={0}
          />
        ) : null}
        <line
          className="centerline"
          x1="0"
          y1={wallHeightMm - centerlineMm}
          x2={wallLengthMm}
          y2={wallHeightMm - centerlineMm}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    </div>
  );
}

function GridOverlay({
  height,
  id,
  spacingMm,
  width,
  x,
  y
}: {
  height: number;
  id: string;
  spacingMm: number;
  width: number;
  x: number;
  y: number;
}) {
  const majorSpacingMm = spacingMm * 4;

  return (
    <>
      <defs>
        <pattern
          id={`${id}-minor`}
          width={spacingMm}
          height={spacingMm}
          patternUnits="userSpaceOnUse"
        >
          <path
            className="grid-line minor"
            d={`M ${spacingMm} 0 L 0 0 0 ${spacingMm}`}
            vectorEffect="non-scaling-stroke"
          />
        </pattern>
        <pattern
          id={`${id}-major`}
          width={majorSpacingMm}
          height={majorSpacingMm}
          patternUnits="userSpaceOnUse"
        >
          <path
            className="grid-line major"
            d={`M ${majorSpacingMm} 0 L 0 0 0 ${majorSpacingMm}`}
            vectorEffect="non-scaling-stroke"
          />
        </pattern>
      </defs>
      <rect
        className="grid-fill"
        fill={`url(#${id}-minor)`}
        x={x}
        y={y}
        width={width}
        height={height}
      />
      <rect
        className="grid-fill"
        fill={`url(#${id}-major)`}
        x={x}
        y={y}
        width={width}
        height={height}
      />
    </>
  );
}

function DataView({ json }: { json: string }) {
  return (
    <div className="data-surface">
      <pre>{json}</pre>
    </div>
  );
}

function WallInspector({
  centerlineMm,
  changedWallNames,
  dimensionLink,
  lastGeometryEdit,
  onCommitLength,
  placementWarnings,
  unit,
  wallHeightMm,
  wallLengthMm,
  wallName
}: {
  centerlineMm: number;
  changedWallNames: string[];
  dimensionLink: WallDimensionLink | null;
  lastGeometryEdit: {
    anchorVertexId: string;
    changedWallIds: string[];
  } | null;
  onCommitLength: (lengthMm: number) => Promise<void>;
  placementWarnings: { id: string; message: string; wallObjectId: string }[];
  unit: "in" | "ft" | "cm" | "m";
  wallHeightMm: number;
  wallLengthMm: number;
  wallName: string;
}) {
  const [lengthInput, setLengthInput] = useState(() =>
    formatLength(wallLengthMm, { unit })
  );
  const [lengthError, setLengthError] = useState<string | null>(null);

  useEffect(() => {
    setLengthInput(formatLength(wallLengthMm, { unit }));
    setLengthError(null);
  }, [unit, wallLengthMm]);

  const commitLength = async () => {
    const parsed = parseLength(lengthInput, unit);

    if (!parsed.ok) {
      setLengthError(parsed.error);
      return;
    }

    if (parsed.valueMm <= 0) {
      setLengthError("Wall length must be greater than zero.");
      return;
    }

    setLengthError(null);
    await onCommitLength(parsed.valueMm);
    setLengthInput(formatLength(parsed.valueMm, { unit }));
  };

  return (
    <form
      className="inspector-form"
      onSubmit={(event) => {
        event.preventDefault();
        void commitLength();
      }}
    >
      <label className="field-row">
        <span>Selected wall</span>
        <input readOnly value={wallName} />
      </label>

      <label className="field-row">
        <span>Length</span>
        <input
          aria-describedby={lengthError ? "wall-length-error" : undefined}
          aria-invalid={lengthError ? "true" : "false"}
          inputMode="decimal"
          value={lengthInput}
          onBlur={() => void commitLength()}
          onChange={(event) => setLengthInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            void commitLength();
          }}
        />
      </label>
      {lengthError ? (
        <p className="field-error" id="wall-length-error">
          {lengthError}
        </p>
      ) : (
        <p className="field-hint">Accepts 28', 28 ft, 336", 853.4 cm, or 8.53 m.</p>
      )}
      {dimensionLink ? (
        <div className="constraint-panel" aria-label="Linked rectangle dimension">
          <Link2 aria-hidden="true" size={17} />
          <div>
            <h3>{wallName} + {dimensionLink.pairedWallName}</h3>
            <p>{dimensionLink.roomName} keeps opposing wall lengths linked.</p>
          </div>
        </div>
      ) : null}
      {lastGeometryEdit ? (
        <p className="field-hint">
          Last edit updated{" "}
          {changedWallNames.length > 0 ? changedWallNames.join(", ") : "no walls"}.
        </p>
      ) : null}

      {placementWarnings.length > 0 ? (
        <div className="warning-panel" role="status" aria-live="polite">
          <AlertTriangle aria-hidden="true" size={18} />
          <div>
            <h3>Placement needs review</h3>
            <ul>
              {placementWarnings.map((warning) => (
                <li key={warning.id}>
                  {warning.message} <span>{warning.wallObjectId}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}

      <dl className="property-list compact">
        <div>
          <dt>Height</dt>
          <dd>{formatLength(wallHeightMm, { unit })}</dd>
        </div>
        <div>
          <dt>Centerline</dt>
          <dd>
            {formatLength(centerlineMm, {
              unit: "ft",
              secondaryUnit: "cm"
            })}
          </dd>
        </div>
      </dl>
    </form>
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
  onClick
}: {
  active: boolean;
  disabled: boolean;
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      aria-pressed={active}
      className={active ? "view-option-button active" : "view-option-button"}
      disabled={disabled}
      type="button"
      title={active ? "Hide grid" : "Show grid"}
      onClick={onClick}
    >
      {icon}
      <span>{label}</span>
    </button>
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

function getGridSpacingMm(unit: Project["unit"]): number {
  return unit === "cm" || unit === "m" ? 500 : 304.8;
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
