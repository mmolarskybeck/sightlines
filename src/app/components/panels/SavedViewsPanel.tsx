import { useState } from "react";
import { CheckIcon } from "@phosphor-icons/react/dist/csr/Check";
import { CubeIcon } from "@phosphor-icons/react/dist/csr/Cube";
import { PencilSimpleIcon } from "@phosphor-icons/react/dist/csr/PencilSimple";
import { TrashIcon } from "@phosphor-icons/react/dist/csr/Trash";
import { WarningIcon } from "@phosphor-icons/react/dist/csr/Warning";
import { XIcon } from "@phosphor-icons/react/dist/csr/X";
import type { Project, SavedView } from "../../../domain/project";
import { composeSavedViewLabel, isDegeneratePose } from "../../../domain/savedViews";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";

// The left workspace pane behind the rail's Saved views selector (saved-views
// spec §4): the browsable home for a project's camera bookmarks. Same idioms
// as the checklist/rooms panels — a flat white column with a hairline toward
// the canvas — and the same row composition (room label · title, "Saved view
// n" subtitle only once renamed, inline rename, delete-through-applyEdit) the
// Export dialog uses, so the two management surfaces read identically. Rows sit
// in creation order, the one order every consumer shares. Opening a valid row
// (click or Enter) hands off to App, which switches to 3D and flies to the
// stored pose; an invalid-pose row keeps its advisory and delete but is inert.
export function SavedViewsPanel({
  project,
  thumbnailUrls,
  onOpenView,
  onRenameSavedView,
  onDeleteSavedView
}: {
  project: Project;
  thumbnailUrls: Readonly<Record<string, string>>;
  onOpenView: (view: SavedView) => void;
  onRenameSavedView: (viewId: string, title: string) => Promise<void>;
  onDeleteSavedView: (viewId: string) => Promise<void>;
}) {
  const [editingViewId, setEditingViewId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState("");

  const savedViews = project.savedViews ?? [];

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

  return (
    <section className="saved-views-panel" aria-label="Saved views">
      <div className="panel-heading">
        <h2>Saved views</h2>
        <div className="panel-heading-actions">
          <span>· {savedViews.length}</span>
        </div>
      </div>

      {savedViews.length === 0 ? (
        <div className="saved-views-empty">
          <CubeIcon aria-hidden="true" size={26} />
          <p className="empty-copy">
            No saved views yet. In the 3D view, choose Export → Save view to
            bookmark the current angle.
          </p>
        </div>
      ) : (
        <ul className="saved-views-list">
          {savedViews.map((view) => (
            <SavedViewRow
              key={view.id}
              project={project}
              view={view}
              thumbnailUrl={thumbnailUrls[view.id]}
              isEditing={editingViewId === view.id}
              draftTitle={draftTitle}
              onDraftTitleChange={setDraftTitle}
              onStartRename={() => startRename(view)}
              onCancelRename={cancelRename}
              onCommitRename={() => void commitRename(view)}
              onOpen={() => onOpenView(view)}
              onDelete={() => void onDeleteSavedView(view.id)}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function SavedViewRow({
  project,
  view,
  thumbnailUrl,
  isEditing,
  draftTitle,
  onDraftTitleChange,
  onStartRename,
  onCancelRename,
  onCommitRename,
  onOpen,
  onDelete
}: {
  project: Project;
  view: SavedView;
  thumbnailUrl: string | undefined;
  isEditing: boolean;
  draftTitle: string;
  onDraftTitleChange: (title: string) => void;
  onStartRename: () => void;
  onCancelRename: () => void;
  onCommitRename: () => void;
  onOpen: () => void;
  onDelete: () => void;
}) {
  const { composedLabel, defaultTitle, isRenamed } = composeSavedViewLabel(
    project,
    view
  );
  // A degenerate pose has no camera to fly to (spec §4.2): the row keeps its
  // advisory and delete, but is not openable.
  const isValid = !isDegeneratePose(view.pose);
  // Only a valid, non-editing row behaves as a button — while renaming, or when
  // there's no pose to fly to, it's an inert container.
  const isOpenable = isValid && !isEditing;

  return (
    <li
      className="saved-view-row"
      data-invalid={!isValid ? "" : undefined}
      role={isOpenable ? "button" : undefined}
      tabIndex={isOpenable ? 0 : undefined}
      onClick={isOpenable ? onOpen : undefined}
      onKeyDown={
        isOpenable
          ? (event) => {
              // Only the row itself opens on Enter; keystrokes bubbling up from
              // the action buttons or (defensively) any child are ignored.
              if (event.target !== event.currentTarget) return;
              if (event.key !== "Enter" && event.key !== " ") return;
              event.preventDefault();
              onOpen();
            }
          : undefined
      }
    >
      <SavedViewThumbnail label={composedLabel} src={thumbnailUrl} />
      {isEditing ? (
        <form
          className="saved-view-rename"
          onClick={(event) => event.stopPropagation()}
          onSubmit={(event) => {
            event.preventDefault();
            onCommitRename();
          }}
        >
          <Input
            aria-label={`Rename ${composedLabel}`}
            autoFocus
            size="compact"
            value={draftTitle}
            onChange={(event) => onDraftTitleChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                onCancelRename();
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
            onClick={onCancelRename}
          >
            <XIcon aria-hidden="true" size={14} />
          </Button>
        </form>
      ) : (
        <>
          <div className="saved-view-copy">
            <strong>{composedLabel}</strong>
            {isValid ? (
              isRenamed && <span>{defaultTitle}</span>
            ) : (
              <span>
                <WarningIcon aria-hidden="true" size={13} />
                Invalid camera pose.
              </span>
            )}
          </div>
          <div className="saved-view-actions">
            {isValid ? (
              <IconTooltip label={`Rename ${composedLabel}`}>
                <Button
                  aria-label={`Rename ${composedLabel}`}
                  className="icon-button compact"
                  size="icon-sm"
                  variant="ghost"
                  onClick={(event) => {
                    event.stopPropagation();
                    onStartRename();
                  }}
                >
                  <PencilSimpleIcon aria-hidden="true" size={14} />
                </Button>
              </IconTooltip>
            ) : null}
            <IconTooltip label={`Delete ${composedLabel}`}>
              <Button
                aria-label={`Delete ${composedLabel}`}
                className="icon-button compact"
                size="icon-sm"
                variant="ghost"
                onClick={(event) => {
                  event.stopPropagation();
                  onDelete();
                }}
              >
                <TrashIcon aria-hidden="true" size={14} />
              </Button>
            </IconTooltip>
          </div>
        </>
      )}
    </li>
  );
}

// The 96×60 preview tile (downscaled from the 296×184 shared cache, spec §4.2):
// the rendered thumbnail, or the cube-on-grid placeholder while none exists yet
// (or for a degenerate pose that gets no render).
function SavedViewThumbnail({
  label,
  src
}: {
  label: string;
  src?: string;
}) {
  return src ? (
    <img className="saved-view-thumbnail" src={src} alt={label} />
  ) : (
    <span
      aria-label={label}
      className="saved-view-thumbnail saved-view-placeholder"
      role="img"
    >
      <CubeIcon aria-hidden="true" size={24} />
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
