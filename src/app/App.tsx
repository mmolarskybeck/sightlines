import { useEffect, useMemo, useRef } from "react";
import {
  Download,
  FileJson,
  FolderOpen,
  Grid2X2,
  ListChecks,
  Ruler,
  Save,
  Upload
} from "lucide-react";
import { getPlacedRoomBounds, getRoomBounds } from "../domain/geometry/walls";
import { formatLength } from "../domain/units/length";
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
    boot,
    setViewMode,
    selectWall,
    renameProject,
    importProjectJson
  } = useAppStore();
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void boot();
  }, [boot]);

  const walls = useMemo(() => (project ? getProjectWalls(project) : []), [project]);
  const selectedWall = project ? getSelectedWall(project, selectedWallId) : null;

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

          {viewMode === "plan" ? (
            <PlanView project={project} selectedWallId={selectedWall?.id ?? null} />
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
            <dl className="property-list">
              <div>
                <dt>Selected wall</dt>
                <dd>{selectedWall.name}</dd>
              </div>
              <div>
                <dt>Length</dt>
                <dd>{formatLength(selectedWall.lengthMm, { unit: project.unit })}</dd>
              </div>
              <div>
                <dt>Height</dt>
                <dd>{formatLength(selectedWall.heightMm, { unit: project.unit })}</dd>
              </div>
              <div>
                <dt>Centerline</dt>
                <dd>
                  {formatLength(project.defaultCenterlineHeightMm, {
                    unit: "ft",
                    secondaryUnit: "cm"
                  })}
                </dd>
              </div>
            </dl>
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
  project,
  selectedWallId
}: {
  project: NonNullable<ReturnType<typeof useAppStore.getState>["project"]>;
  selectedWallId: string | null;
}) {
  const placement = project.floor.rooms[0];
  const bounds = getPlacedRoomBounds(placement);
  const padding = 900;
  const viewBox = `${bounds.minX - padding} ${bounds.minY - padding} ${
    bounds.width + padding * 2
  } ${bounds.height + padding * 2}`;

  return (
    <div className="drawing-surface" aria-label="Plan view">
      <svg className="plan-svg" viewBox={viewBox} role="img">
        <title>{placement.room.name} plan</title>
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
  wallName,
  wallLengthMm,
  wallHeightMm,
  centerlineMm,
  unit
}: {
  wallName: string;
  wallLengthMm: number;
  wallHeightMm: number;
  centerlineMm: number;
  unit: "in" | "ft" | "cm" | "m";
}) {
  const viewBox = `0 0 ${wallLengthMm} ${wallHeightMm}`;

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

function DataView({ json }: { json: string }) {
  return (
    <div className="data-surface">
      <pre>{json}</pre>
    </div>
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

function downloadProject(project: NonNullable<ReturnType<typeof useAppStore.getState>["project"]>) {
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
