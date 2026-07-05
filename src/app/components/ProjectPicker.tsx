import { useEffect, useState } from "react";
import { CaretDownIcon } from "@phosphor-icons/react/dist/csr/CaretDown";
import { PlusIcon } from "@phosphor-icons/react/dist/csr/Plus";
import { TrashIcon } from "@phosphor-icons/react/dist/csr/Trash";
import type { ProjectSummary } from "../../domain/project";
import { Button } from "./ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from "./ui/dropdown-menu";

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

  useEffect(() => {
    if (!isOpen) return;

    let cancelled = false;
    void listProjectSummaries().then((result) => {
      if (!cancelled) setSummaries(result);
    });

    return () => {
      cancelled = true;
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
    <DropdownMenu open={isOpen} onOpenChange={setIsOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          aria-label="Projects"
          className="icon-button project-switcher-trigger"
          size="icon"
          title="Switch project"
          variant="ghost"
        >
          <CaretDownIcon aria-hidden="true" size={18} />
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent
        align="end"
        aria-label="Saved projects"
        className="project-picker-panel"
      >
        <DropdownMenuItem
          className="project-picker-new"
          disabled={busy}
          onSelect={(event) => {
            event.preventDefault();
            void handleCreate();
          }}
        >
          <PlusIcon aria-hidden="true" size={16} />
          <span>New project</span>
        </DropdownMenuItem>

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
                <DropdownMenuItem
                  className="project-picker-open"
                  disabled={busy}
                  onSelect={(event) => {
                    event.preventDefault();
                    void handleOpen(summary.id);
                  }}
                >
                  <span className="project-picker-title">{summary.title}</span>
                  <span className="project-picker-updated">
                    {formatUpdatedAt(summary.updatedAt)}
                  </span>
                </DropdownMenuItem>
                <DropdownMenuItem
                  aria-label={`Delete ${summary.title}`}
                  className="icon-button compact"
                  disabled={busy}
                  onSelect={(event) => {
                    event.preventDefault();
                    void handleDelete(summary);
                  }}
                >
                  <TrashIcon aria-hidden="true" size={14} />
                </DropdownMenuItem>
              </div>
            ))
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
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
