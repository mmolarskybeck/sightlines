import { type ReactElement, useEffect, useState } from "react";
import { CheckIcon } from "@phosphor-icons/react/dist/csr/Check";
import { CircleNotchIcon } from "@phosphor-icons/react/dist/csr/CircleNotch";
import { CopyIcon } from "@phosphor-icons/react/dist/csr/Copy";
import { DownloadSimpleIcon } from "@phosphor-icons/react/dist/csr/DownloadSimple";
import { PencilSimpleIcon } from "@phosphor-icons/react/dist/csr/PencilSimple";
import { PlusIcon } from "@phosphor-icons/react/dist/csr/Plus";
import { TrashIcon } from "@phosphor-icons/react/dist/csr/Trash";
import { XIcon } from "@phosphor-icons/react/dist/csr/X";
import type { ProjectSummary } from "../../../domain/project";
import {
  CLOUD_PROJECT_ABSENT_TAG,
  formatCloudProjectMeta,
  getCloudProjectActionAriaLabel,
  getCloudProjectActionLabel,
  getCloudProjectsSectionState
} from "../../cloud/cloudBackupCopy";
import type {
  CloudBackupProviderStatus,
  CloudProjectFolder
} from "../../cloud/provider";
import type { CloudProjectsStatus } from "../../store/cloudProjectsSlice";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../ui/dialog";
import { Input } from "../ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";

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
  onDuplicateProject,
  onRenameProject,
  onDeleteProject,
  onOpenProject,
  onExportProject,
  cloudBackupConfigured,
  cloudBackupProviderStatus,
  cloudProjects,
  cloudProjectsStatus,
  cloudProjectOpening,
  onRefreshCloudProjects,
  onOpenCloudProject,
  onReconnectCloudBackup
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentProjectId: string;
  listProjectSummaries: () => Promise<ProjectSummary[]>;
  onCreateProject: (title: string) => Promise<void>;
  onDuplicateProject: (id: string) => Promise<void>;
  onRenameProject: (id: string, title: string) => Promise<void>;
  onDeleteProject: (id: string) => Promise<void>;
  onOpenProject: (id: string) => Promise<void>;
  onExportProject: (id: string) => Promise<void>;
  cloudBackupConfigured: boolean;
  cloudBackupProviderStatus: CloudBackupProviderStatus;
  cloudProjects: CloudProjectFolder[] | null;
  cloudProjectsStatus: CloudProjectsStatus;
  cloudProjectOpening: string | null;
  onRefreshCloudProjects: () => Promise<void>;
  // Resolves true once the backup has been imported (or parked in the artwork
  // review dialog), which is when this modal should get out of the way.
  onOpenCloudProject: (folder: CloudProjectFolder) => Promise<boolean>;
  onReconnectCloudBackup: () => Promise<void>;
}) {
  const [summaries, setSummaries] = useState<ProjectSummary[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState("");
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);
  const [exportingId, setExportingId] = useState<string | null>(null);
  const [duplicatingId, setDuplicatingId] = useState<string | null>(null);

  // Disconnected users see nothing new here — Settings owns connecting. A grant
  // that needs reauthorization still shows the section, because that state has
  // its own one-click fix and hiding it would just look like nothing is there.
  const showCloudProjects =
    cloudBackupConfigured &&
    (cloudBackupProviderStatus === "connected" ||
      cloudBackupProviderStatus === "reauthorization-required");

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
    if (showCloudProjects) void onRefreshCloudProjects();

    return () => {
      cancelled = true;
    };
  }, [open, listProjectSummaries, showCloudProjects, onRefreshCloudProjects]);

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

  const handleOpenCloudProject = async (folder: CloudProjectFolder) => {
    // The import commit opens the document itself; this modal only has to step
    // aside once the package has been accepted.
    if (await onOpenCloudProject(folder)) onOpenChange(false);
  };

  const handleDuplicate = async (id: string) => {
    setBusy(true);
    setDuplicatingId(id);
    try {
      await onDuplicateProject(id);
      onOpenChange(false);
    } finally {
      setDuplicatingId(null);
      setBusy(false);
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
              const isDuplicating = duplicatingId === summary.id;
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
                      <IconTooltip disabled={!draftIsValid} label="Save name">
                        <Button
                          aria-label="Save project name"
                          className="icon-button compact"
                          disabled={!draftIsValid}
                          size="icon-sm"
                          type="submit"
                          variant="ghost"
                        >
                          <CheckIcon aria-hidden="true" size={14} />
                        </Button>
                      </IconTooltip>
                      <IconTooltip label="Cancel">
                        <Button
                          aria-label="Cancel rename"
                          className="icon-button compact"
                          size="icon-sm"
                          variant="ghost"
                          onClick={cancelRename}
                        >
                          <XIcon aria-hidden="true" size={14} />
                        </Button>
                      </IconTooltip>
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
                          <IconTooltip label="Cancel">
                            <Button
                              aria-label="Cancel delete"
                              className="icon-button compact"
                              size="icon-sm"
                              variant="ghost"
                              onClick={() => setConfirmingDeleteId(null)}
                            >
                              <XIcon aria-hidden="true" size={14} />
                            </Button>
                          </IconTooltip>
                        </div>
                      ) : (
                        <div className="project-manager-actions">
                          <IconTooltip disabled={busy} label="Duplicate project">
                            <Button
                              aria-busy={isDuplicating}
                              aria-label={`Duplicate ${summary.title}`}
                              className="icon-button compact"
                              disabled={busy}
                              size="icon-sm"
                              variant="ghost"
                              onClick={() => void handleDuplicate(summary.id)}
                            >
                              {isDuplicating ? (
                                <CircleNotchIcon
                                  aria-hidden="true"
                                  className="animate-spin"
                                  size={14}
                                />
                              ) : (
                                <CopyIcon aria-hidden="true" size={14} />
                              )}
                            </Button>
                          </IconTooltip>
                          <IconTooltip disabled={busy || isExporting} label="Export project backup">
                            <Button
                              aria-busy={isExporting}
                              aria-label={`Export ${summary.title}`}
                              className="icon-button compact"
                              disabled={busy || isExporting}
                              size="icon-sm"
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
                          </IconTooltip>
                          <IconTooltip disabled={busy} label="Rename project">
                            <Button
                              aria-label={`Rename ${summary.title}`}
                              className="icon-button compact"
                              disabled={busy}
                              size="icon-sm"
                              variant="ghost"
                              onClick={() => startRename(summary)}
                            >
                              <PencilSimpleIcon aria-hidden="true" size={14} />
                            </Button>
                          </IconTooltip>
                          <IconTooltip disabled={busy} label="Delete project">
                            <Button
                              aria-label={`Delete ${summary.title}`}
                              className="icon-button compact"
                              disabled={busy}
                              size="icon-sm"
                              variant="ghost"
                              onClick={() => {
                                setEditingId(null);
                                setConfirmingDeleteId(summary.id);
                              }}
                            >
                              <TrashIcon aria-hidden="true" size={14} />
                            </Button>
                          </IconTooltip>
                        </div>
                      )}
                    </>
                  )}
                </div>
              );
            })
          )}
        </div>

        {showCloudProjects ? (
          <CloudProjectsSection
            busy={busy}
            folders={cloudProjects}
            localProjectIds={(summaries ?? []).map((summary) => summary.id)}
            openingFolderName={cloudProjectOpening}
            providerStatus={cloudBackupProviderStatus}
            status={cloudProjectsStatus}
            onOpenFolder={handleOpenCloudProject}
            onReconnect={onReconnectCloudBackup}
            onRetry={onRefreshCloudProjects}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

// Cloud backup folders from the connected provider, listed under the projects
// on this device. Stage 1 is read-only: a folder can be restored or copied in,
// never written back and never used to replace a local project.
function CloudProjectsSection({
  busy,
  folders,
  localProjectIds,
  openingFolderName,
  providerStatus,
  status,
  onOpenFolder,
  onReconnect,
  onRetry
}: {
  busy: boolean;
  folders: CloudProjectFolder[] | null;
  localProjectIds: string[];
  openingFolderName: string | null;
  providerStatus: CloudBackupProviderStatus;
  status: CloudProjectsStatus;
  onOpenFolder: (folder: CloudProjectFolder) => Promise<void>;
  onReconnect: () => Promise<void>;
  onRetry: () => Promise<void>;
}) {
  const section = getCloudProjectsSectionState({
    providerStatus,
    status,
    count: folders?.length ?? 0
  });

  return (
    <section className="project-manager-cloud">
      <h3 className="project-manager-cloud-heading">{section.heading}</h3>

      {section.message ? (
        <p className="project-manager-empty">
          {section.message}
          {section.action ? (
            <Button
              className="project-manager-cloud-inline-action"
              size="sm"
              variant="ghost"
              onClick={() => {
                void (section.action === "reconnect" ? onReconnect() : onRetry());
              }}
            >
              {section.actionLabel}
            </Button>
          ) : null}
        </p>
      ) : (
        <div className="project-manager-cloud-list" aria-label="Cloud backups">
          {(folders ?? []).map((folder) => {
            // Prefix agreement is a guess about identity, so it only chooses
            // which offer to make — the import pipeline decides what is written.
            const matchesLocalProject =
              folder.projectIdPrefix.length > 0 &&
              localProjectIds.some((id) => id.startsWith(folder.projectIdPrefix));
            const isOpening = openingFolderName === folder.folderName;

            return (
              <div className="project-manager-row" key={folder.folderName}>
                <div className="project-manager-cloud-summary">
                  <span className="project-manager-title">
                    {folder.title}
                    {matchesLocalProject ? null : (
                      <span className="project-manager-cloud-tag">
                        {CLOUD_PROJECT_ABSENT_TAG}
                      </span>
                    )}
                  </span>
                  <span className="project-manager-meta">
                    {formatCloudProjectMeta({
                      latestBackupIso: folder.latestBackup?.serverModifiedIso ?? null,
                      backupCount: folder.backupCount
                    })}
                  </span>
                </div>

                <div className="project-manager-actions">
                  <Button
                    aria-busy={isOpening}
                    aria-label={getCloudProjectActionAriaLabel(
                      matchesLocalProject,
                      folder.title
                    )}
                    disabled={busy || openingFolderName !== null}
                    size="sm"
                    variant="ghost"
                    onClick={() => void onOpenFolder(folder)}
                  >
                    {isOpening ? (
                      <CircleNotchIcon aria-hidden="true" className="animate-spin" size={14} />
                    ) : null}
                    <span>{getCloudProjectActionLabel(matchesLocalProject)}</span>
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function IconTooltip({
  children,
  disabled = false,
  label
}: {
  children: ReactElement;
  disabled?: boolean;
  label: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {disabled ? <span className="inline-flex">{children}</span> : children}
      </TooltipTrigger>
      <TooltipContent className="toolbar-tooltip" side="bottom">
        {label}
      </TooltipContent>
    </Tooltip>
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
