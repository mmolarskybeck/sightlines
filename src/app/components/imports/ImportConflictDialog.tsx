import { useEffect, useMemo, useState } from "react";
import type {
  ArtworkConflict,
  ConflictResolution,
  PreparedAssetSave
} from "../../../domain/package/importPackage";
import { FRAME_FINISHES } from "../../../domain/framing";
import type { Artwork, DisplayUnit } from "../../../domain/project";
import { formatLength } from "../../../domain/units/length";
import { useAssetImageUrls } from "../../hooks/useAssetImageUrls";
import { formatDimensionsSummary } from "../inspectors/artworkInspectorSummaries";
import { getScopedUnitContext } from "../shared/scopedUnits";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "../ui/dialog";
import { SegmentedToggleGroup, SegmentedToggleGroupItem } from "../ui/segmented";

const EM_DASH = "—";

function artworkLabel(artwork: Artwork): string {
  const title = artwork.title?.trim() || "Untitled";
  return artwork.artist ? `${title}, ${artwork.artist}` : title;
}

function text(value: string | undefined): string {
  const trimmed = value?.trim();
  return trimmed ? trimmed : EM_DASH;
}

// Compare on the NORMALIZED value, not the raw one: an absent field and a
// field holding whitespace are the same fact about the work, and surfacing
// them as a "change" would bury the differences that matter.
function sameText(a: string | undefined, b: string | undefined): boolean {
  return (a?.trim() ?? "") === (b?.trim() ?? "");
}

function finishLabel(finish: string): string {
  return FRAME_FINISHES.find((entry) => entry.value === finish)?.label ?? finish;
}

function framingText(artwork: Artwork, unit: DisplayUnit): string {
  if (!artwork.frame || artwork.frame.widthMm <= 0) return "None";
  return `${formatLength(artwork.frame.widthMm, { unit })} ${finishLabel(artwork.frame.finish)}`;
}

function matText(artwork: Artwork, unit: DisplayUnit): string {
  const mat = artwork.matWidthMm;
  return mat !== undefined && mat > 0 ? formatLength(mat, { unit }) : "None";
}

// One row of the compact field diff. `changed` drives BOTH the copy (a
// changed field states both sides; an unchanged one states the single shared
// value) and whether the line is shown at all for non-forced fields.
type DiffLine = { key: string; label: string; yours: string; theirs: string; changed: boolean };

// Fields that make two same-titled works tellable apart. When several rows
// share one label these are shown even when identical, so the curator can see
// WHICH work each row is rather than guessing between two "Untitled, —" rows.
const IDENTITY_FIELD_KEYS = new Set(["dimensions", "date", "accessionNumber"]);

function buildDiffLines(
  conflict: ArtworkConflict,
  unit: DisplayUnit,
  forceIdentityFields: boolean
): DiffLine[] {
  const { existing, incoming } = conflict;

  const lines: DiffLine[] = [
    {
      key: "title",
      label: "Title",
      yours: text(existing.title),
      theirs: text(incoming.title),
      changed: !sameText(existing.title, incoming.title)
    },
    {
      key: "artist",
      label: "Artist",
      yours: text(existing.artist),
      theirs: text(incoming.artist),
      changed: !sameText(existing.artist, incoming.artist)
    },
    {
      key: "date",
      label: "Date",
      yours: text(existing.date),
      theirs: text(incoming.date),
      changed: !sameText(existing.date, incoming.date)
    },
    {
      key: "accessionNumber",
      label: "Accession",
      yours: text(existing.accessionNumber),
      theirs: text(incoming.accessionNumber),
      changed: !sameText(existing.accessionNumber, incoming.accessionNumber)
    },
    {
      key: "locationOrLender",
      label: "Location / lender",
      yours: text(existing.locationOrLender),
      theirs: text(incoming.locationOrLender),
      changed: !sameText(existing.locationOrLender, incoming.locationOrLender)
    },
    {
      key: "dimensions",
      label: "Dimensions",
      yours: formatDimensionsSummary(existing.dimensions, unit) ?? EM_DASH,
      theirs: formatDimensionsSummary(incoming.dimensions, unit) ?? EM_DASH,
      // Compare the stored millimetres, not the rendered string: two sizes a
      // rounding step apart are a real difference the curator should see.
      changed:
        JSON.stringify(existing.dimensions) !== JSON.stringify(incoming.dimensions)
    },
    {
      key: "matWidthMm",
      label: "Mat",
      yours: matText(existing, unit),
      theirs: matText(incoming, unit),
      changed: (existing.matWidthMm ?? 0) !== (incoming.matWidthMm ?? 0)
    },
    {
      key: "frame",
      label: "Frame",
      yours: framingText(existing, unit),
      theirs: framingText(incoming, unit),
      changed:
        (existing.frame?.widthMm ?? 0) !== (incoming.frame?.widthMm ?? 0) ||
        existing.frame?.finish !== incoming.frame?.finish
    },
    {
      key: "frameIncludedInImage",
      label: "Size includes frame",
      yours: existing.frameIncludedInImage ? "Yes" : "No",
      theirs: incoming.frameIncludedInImage ? "Yes" : "No",
      changed:
        Boolean(existing.frameIncludedInImage) !== Boolean(incoming.frameIncludedInImage)
    }
  ];

  return lines.filter(
    (line) => line.changed || (forceIdentityFields && IDENTITY_FIELD_KEYS.has(line.key))
  );
}

// The three choices, in one place so the per-row control and the apply-to-all
// control can never drift apart.
const CHOICES: { value: ConflictResolution; label: string }[] = [
  { value: "mine", label: "Keep mine" },
  { value: "theirs", label: "Use theirs" },
  { value: "both", label: "Keep both" }
];

function isResolution(value: string): value is ConflictResolution {
  return value === "mine" || value === "theirs" || value === "both";
}

function ResolutionChoice({
  label,
  value,
  onChange
}: {
  label: string;
  // "" = no uniform choice across the list (apply-to-all only); Radix renders
  // that as nothing selected.
  value: ConflictResolution | "";
  onChange: (next: ConflictResolution) => void;
}) {
  return (
    <SegmentedToggleGroup
      aria-label={label}
      className="import-conflict-seg"
      type="single"
      value={value}
      onValueChange={(next) => {
        // Radix's single toggle emits "" when the ACTIVE segment is clicked
        // again. These are exclusive choices with no empty state, so a
        // re-click must be a no-op rather than clearing the row.
        if (isResolution(next)) onChange(next);
      }}
    >
      {CHOICES.map((choice) => (
        <SegmentedToggleGroupItem key={choice.value} value={choice.value}>
          {choice.label}
        </SegmentedToggleGroupItem>
      ))}
    </SegmentedToggleGroup>
  );
}

function ConflictThumbnail({
  caption,
  url
}: {
  caption: string;
  url: string | undefined;
}) {
  return (
    <figure className="import-conflict-thumb">
      <span className="import-conflict-thumb-pane">
        {url ? <img alt="" src={url} /> : <span className="import-conflict-thumb-empty">No image</span>}
      </span>
      <figcaption>{caption}</figcaption>
    </figure>
  );
}

// ONE review step for every §6 same-id-different-content conflict in a
// package import (docs/plan.md §6): each row picks keep mine / use theirs /
// keep both, defaulting to the safe choice (keep mine — the local library is
// never changed without an explicit decision). Cancel discards the whole
// import; nothing has been persisted while this dialog is open.
//
// Hooks live in ConflictReview, which only mounts while the dialog is open, so
// a fresh import always starts from fresh choices and fresh object URLs.
export function ImportConflictDialog({
  conflicts,
  assetsToSave,
  getBlob,
  unit = "in",
  onResolve,
  onDismiss
}: {
  conflicts: ArtworkConflict[] | null;
  // The import plan's prepared assets: the ONLY place the incoming images
  // exist at review time (nothing is written to the asset store until the
  // resolutions come back). Absent in tests that only exercise the choices.
  assetsToSave?: PreparedAssetSave[] | null;
  getBlob?: (key: string) => Promise<Blob>;
  unit?: DisplayUnit;
  onResolve: (resolutions: Record<string, ConflictResolution>) => void;
  onDismiss: () => void;
}) {
  if (conflicts === null || conflicts.length === 0) return null;

  return (
    <Dialog open onOpenChange={(next) => (next ? undefined : onDismiss())}>
      <DialogContent className="import-conflict-dialog" showClose={false}>
        <ConflictReview
          assetsToSave={assetsToSave ?? null}
          conflicts={conflicts}
          getBlob={getBlob}
          unit={unit}
          onDismiss={onDismiss}
          onResolve={onResolve}
        />
      </DialogContent>
    </Dialog>
  );
}

const NO_BLOBS = () => Promise.reject(new Error("no asset store"));

function ConflictReview({
  conflicts,
  assetsToSave,
  getBlob,
  unit,
  onResolve,
  onDismiss
}: {
  conflicts: ArtworkConflict[];
  assetsToSave: PreparedAssetSave[] | null;
  getBlob: ((key: string) => Promise<Blob>) | undefined;
  unit: DisplayUnit;
  onResolve: (resolutions: Record<string, ConflictResolution>) => void;
  onDismiss: () => void;
}) {
  const [resolutions, setResolutions] = useState<Record<string, ConflictResolution>>({});

  // Artwork sizes read in the artwork scope's unit (in/cm), never the
  // project's feet — a canvas is specced in inches.
  const { displayUnit } = getScopedUnitContext(unit, "artwork");

  // Rows whose headline reads identically are DIFFERENT works whose labels
  // merely match. They get the identity fields (size/date/accession) whether
  // or not those differ, so the rows are tellable apart.
  const duplicateLabels = useMemo(() => {
    const counts = new Map<string, number>();
    for (const conflict of conflicts) {
      const label = artworkLabel(conflict.existing);
      counts.set(label, (counts.get(label) ?? 0) + 1);
    }
    return new Set([...counts].filter(([, count]) => count > 1).map(([label]) => label));
  }, [conflicts]);

  // "Yours" side (and any incoming record whose image deduped onto a blob
  // already in the local store): the shared hook owns the URL lifecycle.
  const localAssetIds = useMemo(() => {
    const ids: (string | undefined)[] = [];
    for (const conflict of conflicts) {
      if (!conflict.imageChanged) continue;
      ids.push(conflict.existing.assetId, conflict.incoming.assetId);
    }
    return ids;
  }, [conflicts]);
  const localUrls = useAssetImageUrls(localAssetIds, getBlob ?? NO_BLOBS);

  // "Theirs" side: thumbnails that ship inside the package and are not in the
  // asset store yet. Keyed by the plan's resolved local asset id, which is
  // what the rebound incoming artwork points at.
  const incomingThumbnailBlobs = useMemo(() => {
    const wanted = new Set(
      conflicts
        .filter((conflict) => conflict.imageChanged)
        .map((conflict) => conflict.incoming.assetId)
        .filter((id): id is string => id !== undefined)
    );
    return (assetsToSave ?? []).filter((prepared) => wanted.has(prepared.asset.id));
  }, [assetsToSave, conflicts]);

  const [incomingUrls, setIncomingUrls] = useState<Map<string, string>>(() => new Map());
  useEffect(() => {
    const created = new Map<string, string>();
    for (const prepared of incomingThumbnailBlobs) {
      const { bytes, mimeType } = prepared.blobs.thumbnail;
      // Copy into a fresh ArrayBuffer-backed part: the zip may have inflated
      // into a pooled buffer that Blob's part type does not accept.
      const copy = new Uint8Array(bytes.byteLength);
      copy.set(bytes);
      created.set(prepared.asset.id, URL.createObjectURL(new Blob([copy], { type: mimeType })));
    }
    setIncomingUrls(created);
    return () => {
      for (const url of created.values()) URL.revokeObjectURL(url);
    };
  }, [incomingThumbnailBlobs]);

  const resolutionFor = (conflict: ArtworkConflict): ConflictResolution =>
    resolutions[conflict.incoming.id] ?? "mine";

  // The apply-to-all control mirrors the rows: it shows the shared choice when
  // every row agrees and nothing when they don't, so it never misreports a
  // list the curator has since touched row by row.
  const first = resolutionFor(conflicts[0]!);
  const uniformChoice: ConflictResolution | "" = conflicts.every(
    (conflict) => resolutionFor(conflict) === first
  )
    ? first
    : "";

  const applyToAll = (next: ConflictResolution) => {
    setResolutions(Object.fromEntries(conflicts.map((c) => [c.incoming.id, next])));
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>
          {conflicts.length === 1
            ? "One artwork already exists with different details"
            : `${conflicts.length} artworks already exist with different details`}
        </DialogTitle>
        <DialogDescription>
          These works are already in your library but the package has different details for
          them. Choose what to keep for each; “Keep both” adds the imported version as a
          separate work.
        </DialogDescription>
      </DialogHeader>

      {conflicts.length > 1 ? (
        <div className="import-conflict-bulk">
          <span className="import-conflict-bulk-label">Apply to all</span>
          <ResolutionChoice
            label="Resolution for all artworks"
            value={uniformChoice}
            onChange={applyToAll}
          />
        </div>
      ) : null}

      <ul className="import-conflict-list">
        {conflicts.map((conflict) => {
          const label = artworkLabel(conflict.existing);
          const lines = buildDiffLines(conflict, displayUnit, duplicateLabels.has(label));
          const yoursUrl = conflict.existing.assetId
            ? localUrls.get(conflict.existing.assetId)
            : undefined;
          const theirsUrl = conflict.incoming.assetId
            ? incomingUrls.get(conflict.incoming.assetId) ??
              localUrls.get(conflict.incoming.assetId)
            : undefined;

          return (
            <li className="import-conflict-row" key={conflict.incoming.id}>
              <div className="import-conflict-identity">
                <span className="import-conflict-title">{label}</span>

                {lines.length > 0 ? (
                  <dl className="import-conflict-diff">
                    {lines.map((line) => (
                      <div key={line.key}>
                        <dt>{line.label}</dt>
                        <dd>
                          {line.changed ? (
                            <>
                              Yours: {line.yours} <span aria-hidden="true">·</span> Theirs:{" "}
                              {line.theirs}
                            </>
                          ) : (
                            line.yours
                          )}
                        </dd>
                      </div>
                    ))}
                  </dl>
                ) : null}

                {conflict.imageChanged ? (
                  <div className="import-conflict-thumbs">
                    <ConflictThumbnail caption="Yours" url={yoursUrl} />
                    <ConflictThumbnail caption="Theirs" url={theirsUrl} />
                  </div>
                ) : null}
              </div>

              <ResolutionChoice
                label={`Resolution for ${label}`}
                value={resolutionFor(conflict)}
                onChange={(next) =>
                  setResolutions((current) => ({ ...current, [conflict.incoming.id]: next }))
                }
              />
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
    </>
  );
}
