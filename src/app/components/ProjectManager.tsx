import { useEffect, useState } from "react";
import { CheckIcon } from "@phosphor-icons/react/dist/csr/Check";
import { CircleNotchIcon } from "@phosphor-icons/react/dist/csr/CircleNotch";
import { DownloadSimpleIcon } from "@phosphor-icons/react/dist/csr/DownloadSimple";
import { PencilSimpleIcon } from "@phosphor-icons/react/dist/csr/PencilSimple";
import { PlusIcon } from "@phosphor-icons/react/dist/csr/Plus";
import { TrashIcon } from "@phosphor-icons/react/dist/csr/Trash";
import { XIcon } from "@phosphor-icons/react/dist/csr/X";
import type { ProjectSummary } from "../../domain/project";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "./ui/dialog";
import { Input } from "./ui/input";

// The project switcher's list role, upgraded from a caret dropdown into a
// modal: same open/rename/delete verbs as before, plus per-project counts and
// a quick export, none of which fit a DropdownMenuItem. Rename and delete
// follow the same row-level, no-window.confirm idioms as RoomsPanel (rename:
// icon swaps the row for an input; delete: icon swaps the row for an inline
// "Delete?" confirm) so this reads as the same family rather than a new one.
export function ProjectManager({
  open,
  onOpenChange,
  currentProjectId,
  listProjectSummaries,
  onCreateProject,
  onRenameProject,
  onDeleteProject,
  onOpenProject,
  onExportProject
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentProjectId: string;
  listProjectSummaries: () => Promise<ProjectSummary[]>;
  onCreateProject: (title: string) => Promise<void>;
  onRenameProject: (id: string, title: string) => Promise<void>;
  onDeleteProject: (id: string) => Promise<void>;
  onOpenProject: (id: string) => Promise<void>;
  onExportProject: (id: string) => Promise<void>;
}) {
  const [summaries, setSummaries] = useState<ProjectSummary[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState("");
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);
  const [exportingId, setExportingId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      // Nothing carries across a close/reopen — a stale rename draft or
      // delete confirm from the last visit would otherwise resurface armed.
      setEditingId(null);
      setConfirmingDeleteId(null);
      return;
    }

    let cancelled = false;
    void listProjectSummaries().then((result) => {
      if (!cancelled) setSummaries(result);
    });

    return () => {
      cancelled = true;
    };
  }, [open, listProjectSummaries]);

  const refresh = () => {
    void listProjectSummaries().then((result) => setSummaries(result));
  };

  const handleCreate = async () => {
    setBusy(true);
    try {
      await onCreateProject(nextUntitledName(summaries ?? []));
      onOpenChange(false);
    } finally {
      setBusy(false);
    }
  };

  const handleOpen = async (id: string) => {
    if (id === currentProjectId) {
      onOpenChange(false);
      return;
    }

    setBusy(true);
    try {
      await onOpenProject(id);
      onOpenChange(false);
    } finally {
      setBusy(false);
    }
  };

  const startRename = (summary: ProjectSummary) => {
    setConfirmingDeleteId(null);
    setEditingId(summary.id);
    setDraftTitle(summary.title);
  };

  const cancelRename = () => {
    setEditingId(null);
    setDraftTitle("");
  };

  const commitRename = async (id: string) => {
    const trimmed = draftTitle.trim();
    if (trimmed.length === 0) return;
    cancelRename();
    setBusy(true);
    try {
      await onRenameProject(id, trimmed);
      refresh();
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (id: string) => {
    setConfirmingDeleteId(null);
    setBusy(true);
    try {
      await onDeleteProject(id);
      setSummaries((current) => (current ?? []).filter((candidate) => candidate.id !== id));
    } finally {
      setBusy(false);
    }
  };

  const handleExport = async (id: string) => {
    setExportingId(id);
    try {
      await onExportProject(id);
    } finally {
      setExportingId(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="project-manager-dialog">
        <DialogHeader>
          <DialogTitle>Projects</DialogTitle>
        </DialogHeader>

        <div className="project-manager-toolbar">
          <span className="project-manager-count">
            {summaries ? pluralize(summaries.length, "project") : ""}
          </span>
          <Button disabled={busy} size="sm" variant="outline" onClick={() => void handleCreate()}>
            <PlusIcon aria-hidden="true" size={14} />
            <span>New project</span>
          </Button>
        </div>

        <div className="project-manager-list" aria-label="Saved projects">
          {summaries === null ? (
            <p className="project-manager-empty">Loading…</p>
          ) : summaries.length === 0 ? (
            <p className="project-manager-empty">No saved projects yet.</p>
          ) : (
            summaries.map((summary) => {
              const isCurrent = summary.id === currentProjectId;
              const isEditing = editingId === summary.id;
              const isConfirmingDelete = confirmingDeleteId === summary.id;
              const isExporting = exportingId === summary.id;
              const draftIsValid = draftTitle.trim().length > 0;

              return (
                <div
                  className={
                    isCurrent ? "project-manager-row is-current" : "project-manager-row"
                  }
                  key={summary.id}
                >
                  {isEditing ? (
                    <form
                      className="project-manager-rename-form"
                      onSubmit={(event) => {
                        event.preventDefault();
                        void commitRename(summary.id);
                      }}
                    >
                      <Input
                        aria-label={`Rename ${summary.title}`}
                        autoFocus
                        size="compact"
                        value={draftTitle}
                        onChange={(event) => setDraftTitle(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Escape") {
                            event.preventDefault();
                            cancelRename();
                          }
                        }}
                      />
                      <Button
                        aria-label="Save project name"
                        className="icon-button compact"
                        disabled={!draftIsValid}
                        size="icon-sm"
                        title="Save project name"
                        type="submit"
                        variant="ghost"
                      >
                        <CheckIcon aria-hidden="true" size={14} />
                      </Button>
                      <Button
                        aria-label="Cancel rename"
                        className="icon-button compact"
                        size="icon-sm"
                        title="Cancel rename"
                        variant="ghost"
                        onClick={cancelRename}
                      >
                        <XIcon aria-hidden="true" size={14} />
                      </Button>
                    </form>
                  ) : (
                    <>
                      <button
                        className="project-manager-open"
                        disabled={busy}
                        type="button"
                        onClick={() => void handleOpen(summary.id)}
                      >
                        <span className="project-manager-title">
                          {summary.title}
                          {isCurrent ? (
                            <span className="project-manager-current-tag">Current</span>
                          ) : null}
                        </span>
                        <span className="project-manager-meta">
                          {formatUpdatedAt(summary.updatedAt)} ·{" "}
                          {pluralize(summary.roomCount, "room")} ·{" "}
                          {pluralize(summary.artworkCount, "work")}
                        </span>
                      </button>

                      {isConfirmingDelete ? (
                        <div className="project-manager-delete-confirm">
                          <span>Delete?</span>
                          <Button
                            disabled={busy}
                            size="sm"
                            variant="destructive"
                            onClick={() => void handleDelete(summary.id)}
                          >
                            Delete
                          </Button>
                          <Button
                            aria-label="Cancel delete"
                            className="icon-button compact"
                            size="icon-sm"
                            title="Cancel delete"
                            variant="ghost"
                            onClick={() => setConfirmingDeleteId(null)}
                          >
                            <XIcon aria-hidden="true" size={14} />
                          </Button>
                        </div>
                      ) : (
                        <div className="project-manager-actions">
                          <Button
                            aria-busy={isExporting}
                            aria-label={`Export ${summary.title}`}
                            className="icon-button compact"
                            disabled={isExporting}
                            size="icon-sm"
                            title="Export package"
                            variant="ghost"
                            onClick={() => void handleExport(summary.id)}
                          >
                            {isExporting ? (
                              <CircleNotchIcon
                                aria-hidden="true"
                                className="animate-spin"
                                size={14}
                              />
                            ) : (
                              <DownloadSimpleIcon aria-hidden="true" size={14} />
                            )}
                          </Button>
                          <Button
                            aria-label={`Rename ${summary.title}`}
                            className="icon-button compact"
                            disabled={busy}
                            size="icon-sm"
                            title="Rename project"
                            variant="ghost"
                            onClick={() => startRename(summary)}
                          >
                            <PencilSimpleIcon aria-hidden="true" size={14} />
                          </Button>
                          <Button
                            aria-label={`Delete ${summary.title}`}
                            className="icon-button compact"
                            disabled={busy}
                            size="icon-sm"
                            title="Delete project"
                            variant="ghost"
                            onClick={() => {
                              setEditingId(null);
                              setConfirmingDeleteId(summary.id);
                            }}
                          >
                            <TrashIcon aria-hidden="true" size={14} />
                          </Button>
                        </div>
                      )}
                    </>
                  )}
                </div>
              );
            })
          )}
        </div>
      </DialogContent>
    </Dialog>
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

function pluralize(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}
