import { useEffect, useState } from "react";
import type { ArtworkConflict, ConflictResolution } from "../../domain/package/importPackage";
import type { Artwork } from "../../domain/project";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "./ui/dialog";
import { SegmentedToggleGroup, SegmentedToggleGroupItem } from "./ui/segmented";

function artworkLabel(artwork: Artwork): string {
  const title = artwork.title?.trim() || "Untitled";
  return artwork.artist ? `${title} — ${artwork.artist}` : title;
}

// ONE review step for every §6 same-id-different-content conflict in a
// package import (docs/plan.md §6): each row picks keep mine / use theirs /
// keep both, defaulting to the safe choice (keep mine — the local library is
// never changed without an explicit decision). Cancel discards the whole
// import; nothing has been persisted while this dialog is open.
export function ImportConflictDialog({
  conflicts,
  onResolve,
  onDismiss
}: {
  conflicts: ArtworkConflict[] | null;
  onResolve: (resolutions: Record<string, ConflictResolution>) => void;
  onDismiss: () => void;
}) {
  const [resolutions, setResolutions] = useState<Record<string, ConflictResolution>>({});

  // Fresh dialog per import: reset choices whenever a new conflict set opens.
  useEffect(() => {
    if (conflicts) setResolutions({});
  }, [conflicts]);

  const open = conflicts !== null && conflicts.length > 0;
  if (!open) return null;

  return (
    <Dialog open onOpenChange={(next) => (next ? undefined : onDismiss())}>
      <DialogContent showClose={false}>
        <DialogHeader>
          <DialogTitle>
            {conflicts.length === 1
              ? "One artwork already exists with different details"
              : `${conflicts.length} artworks already exist with different details`}
          </DialogTitle>
          <DialogDescription>
            This package contains artworks that are already in your library but whose details
            differ. Choose what to keep for each; “Keep both” adds the imported version as a
            separate work.
          </DialogDescription>
        </DialogHeader>

        {/* Tailwind utilities only — no new global.css surface (a concurrent
            session owns that file); spacing does the structuring, per the
            overlay grammar (no hairline grids inside dialogs). */}
        <ul className="my-1 flex max-h-72 list-none flex-col gap-3 overflow-y-auto p-0">
          {conflicts.map((conflict) => {
            const value = resolutions[conflict.incoming.id] ?? "mine";
            return (
              <li
                key={conflict.incoming.id}
                className="flex items-center justify-between gap-4"
              >
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className="truncate [font-size:var(--type-sm)] [font-weight:var(--weight-medium)]">
                    {artworkLabel(conflict.existing)}
                  </span>
                  {artworkLabel(conflict.incoming) !== artworkLabel(conflict.existing) ? (
                    <span className="truncate [font-size:var(--type-xs)] text-muted-foreground">
                      Imported as: {artworkLabel(conflict.incoming)}
                    </span>
                  ) : null}
                </div>
                <SegmentedToggleGroup
                  aria-label={`Resolution for ${artworkLabel(conflict.existing)}`}
                  className="shrink-0"
                  type="single"
                  value={value}
                  onValueChange={(next) => {
                    if (next === "mine" || next === "theirs" || next === "both") {
                      setResolutions((current) => ({
                        ...current,
                        [conflict.incoming.id]: next
                      }));
                    }
                  }}
                >
                  <SegmentedToggleGroupItem value="mine">Keep mine</SegmentedToggleGroupItem>
                  <SegmentedToggleGroupItem value="theirs">Use theirs</SegmentedToggleGroupItem>
                  <SegmentedToggleGroupItem value="both">Keep both</SegmentedToggleGroupItem>
                </SegmentedToggleGroup>
              </li>
            );
          })}
        </ul>

        <DialogFooter>
          <Button variant="ghost" onClick={onDismiss}>
            Cancel import
          </Button>
          <Button variant="primary" onClick={() => onResolve(resolutions)}>
            Import
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
