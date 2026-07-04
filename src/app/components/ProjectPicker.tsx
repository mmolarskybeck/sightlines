import { useEffect, useRef, useState } from "react";
import { ChevronDown, Plus, Trash2 } from "lucide-react";
import type { ProjectSummary } from "../../domain/project";

export function ProjectPicker({
  currentProjectId,
  listProjectSummaries,
  onCreateProject,
  onDeleteProject,
  onOpenProject
}: {
  currentProjectId: string;
  listProjectSummaries: () => Promise<ProjectSummary[]>;
  onCreateProject: (title: string) => Promise<void>;
  onDeleteProject: (id: string) => Promise<void>;
  onOpenProject: (id: string) => Promise<void>;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [summaries, setSummaries] = useState<ProjectSummary[] | null>(null);
  const [busy, setBusy] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;

    let cancelled = false;
    void listProjectSummaries().then((result) => {
      if (!cancelled) setSummaries(result);
    });

    function onPointerDown(event: PointerEvent) {
      if (!containerRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setIsOpen(false);
    }

    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      cancelled = true;
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [isOpen, listProjectSummaries]);

  const handleCreate = async () => {
    setBusy(true);
    try {
      await onCreateProject(nextUntitledName(summaries ?? []));
      setIsOpen(false);
    } finally {
      setBusy(false);
    }
  };

  const handleOpen = async (id: string) => {
    if (id === currentProjectId) {
      setIsOpen(false);
      return;
    }

    setBusy(true);
    try {
      await onOpenProject(id);
      setIsOpen(false);
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (summary: ProjectSummary) => {
    if (!window.confirm(`Delete "${summary.title}"? This can't be undone.`)) return;

    setBusy(true);
    try {
      await onDeleteProject(summary.id);
      setSummaries((current) =>
        (current ?? []).filter((candidate) => candidate.id !== summary.id)
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="project-picker" ref={containerRef}>
      <button
        aria-expanded={isOpen}
        aria-label="Projects"
        className="icon-button project-switcher-trigger"
        title="Switch project"
        type="button"
        onClick={() => setIsOpen((open) => !open)}
      >
        <ChevronDown aria-hidden="true" size={18} />
      </button>

      {isOpen ? (
        <div className="project-picker-panel" role="menu" aria-label="Saved projects">
          <button
            className="project-picker-new"
            disabled={busy}
            type="button"
            onClick={() => void handleCreate()}
          >
            <Plus aria-hidden="true" size={16} />
            <span>New project</span>
          </button>

          <div className="project-picker-list">
            {summaries === null ? (
              <p className="project-picker-empty">Loading…</p>
            ) : summaries.length === 0 ? (
              <p className="project-picker-empty">No saved projects yet.</p>
            ) : (
              summaries.map((summary) => (
                <div
                  className={
                    summary.id === currentProjectId
                      ? "project-picker-row active"
                      : "project-picker-row"
                  }
                  key={summary.id}
                >
                  <button
                    className="project-picker-open"
                    disabled={busy}
                    type="button"
                    onClick={() => void handleOpen(summary.id)}
                  >
                    <span className="project-picker-title">{summary.title}</span>
                    <span className="project-picker-updated">
                      {formatUpdatedAt(summary.updatedAt)}
                    </span>
                  </button>
                  <button
                    aria-label={`Delete ${summary.title}`}
                    className="icon-button compact"
                    disabled={busy}
                    title="Delete project"
                    type="button"
                    onClick={() => void handleDelete(summary)}
                  >
                    <Trash2 aria-hidden="true" size={14} />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function nextUntitledName(summaries: ProjectSummary[]): string {
  const takenTitles = new Set(summaries.map((summary) => summary.title));
  if (!takenTitles.has("Untitled Exhibition")) return "Untitled Exhibition";

  let suffix = 2;
  while (takenTitles.has(`Untitled Exhibition ${suffix}`)) {
    suffix += 1;
  }

  return `Untitled Exhibition ${suffix}`;
}

function formatUpdatedAt(updatedAt: string): string {
  const date = new Date(updatedAt);
  if (Number.isNaN(date.getTime())) return "";

  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
