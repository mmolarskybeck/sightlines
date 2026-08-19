import { useEffect, useMemo, useState } from "react";
import { CaretRightIcon } from "@phosphor-icons/react/dist/csr/CaretRight";
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
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../ui/collapsible";
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
// value) and whether the line is shown at all for non-forced fields. `short`
// is the field's name inside the collapsed one-line summary, where the copy
// runs as a sentence rather than as a column heading.
type DiffLine = {
  key: string;
  label: string;
  short: string;
  yours: string;
  theirs: string;
  changed: boolean;
};

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
      short: "title",
      yours: text(existing.title),
      theirs: text(incoming.title),
      changed: !sameText(existing.title, incoming.title)
    },
    {
      key: "artist",
      label: "Artist",
      short: "artist",
      yours: text(existing.artist),
      theirs: text(incoming.artist),
      changed: !sameText(existing.artist, incoming.artist)
    },
    {
      key: "date",
      label: "Date",
      short: "date",
      yours: text(existing.date),
      theirs: text(incoming.date),
      changed: !sameText(existing.date, incoming.date)
    },
    {
      key: "accessionNumber",
      label: "Accession",
      short: "accession",
      yours: text(existing.accessionNumber),
      theirs: text(incoming.accessionNumber),
      changed: !sameText(existing.accessionNumber, incoming.accessionNumber)
    },
    {
      key: "locationOrLender",
      label: "Location / lender",
      short: "location",
      yours: text(existing.locationOrLender),
      theirs: text(incoming.locationOrLender),
      changed: !sameText(existing.locationOrLender, incoming.locationOrLender)
    },
    {
      key: "dimensions",
      label: "Dimensions",
      short: "dimensions",
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
      short: "mat",
      yours: matText(existing, unit),
      theirs: matText(incoming, unit),
      changed: (existing.matWidthMm ?? 0) !== (incoming.matWidthMm ?? 0)
    },
    {
      key: "frame",
      label: "Frame",
      short: "frame",
      yours: framingText(existing, unit),
      theirs: framingText(incoming, unit),
      changed:
        (existing.frame?.widthMm ?? 0) !== (incoming.frame?.widthMm ?? 0) ||
        existing.frame?.finish !== incoming.frame?.finish
    },
    {
      key: "frameIncludedInImage",
      label: "Size includes frame",
      short: "frame in size",
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

// What the row says while collapsed. Rows start closed, so this line carries
// the whole decision context: which KIND of difference is being judged, and —
// when two rows share one label — which of the two works this row is.
// `identity` is rendered ahead of the phrase, separated by a middot.
type RowSummary = { identity: string | null; phrase: string };

function sentenceCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function buildRowSummary(
  conflict: ArtworkConflict,
  lines: DiffLine[],
  unit: DisplayUnit,
  disambiguate: boolean
): RowSummary {
  // Only genuinely changed fields; the identity lines forced in for
  // same-labelled rows are context, not differences.
  const names = lines.filter((line) => line.changed).map((line) => line.short);
  if (conflict.imageChanged) names.push("image");
  // A conflict always differs somewhere, but it can differ only in fields this
  // diff does not list (notes, metadata), which leaves nothing to name.
  const phrase = names.length > 0 ? `differs in ${names.join(", ")}` : "details differ";

  if (!disambiguate) return { identity: null, phrase: sentenceCase(phrase) };

  const { existing } = conflict;
  const identityParts = [
    formatDimensionsSummary(existing.dimensions, unit),
    existing.date?.trim(),
    existing.accessionNumber?.trim()
  ].filter((part): part is string => Boolean(part));

  if (identityParts.length === 0) return { identity: null, phrase: sentenceCase(phrase) };
  return { identity: identityParts.join(", "), phrase };
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

function RowSummaryText({ summary }: { summary: RowSummary }) {
  return (
    <span className="import-conflict-summary">
      {summary.identity ? (
        <>
          Yours is {summary.identity} <span aria-hidden="true">·</span> {summary.phrase}
        </>
      ) : (
        summary.phrase
      )}
    </span>
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
  // Rows open closed: the list is a decision queue first and a diff second.
  // Keyed by the same id as `resolutions`, absent = collapsed.
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

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

  // One pass over the list: the diff, the collapsed summary, and whether the
  // row has anything to open at all. A conflict can differ only in fields this
  // diff does not list, which leaves an empty body — such a row is a plain
  // header, never a dead disclosure.
  const rows = useMemo(
    () =>
      conflicts.map((conflict) => {
        const label = artworkLabel(conflict.existing);
        const duplicate = duplicateLabels.has(label);
        const lines = buildDiffLines(conflict, displayUnit, duplicate);
        return {
          conflict,
          label,
          lines,
          summary: buildRowSummary(conflict, lines, displayUnit, duplicate),
          expandable: lines.length > 0 || conflict.imageChanged
        };
      }),
    [conflicts, displayUnit, duplicateLabels]
  );

  const expandableRows = rows.filter((row) => row.expandable);
  const allExpanded =
    expandableRows.length > 0 &&
    expandableRows.every((row) => expanded[row.conflict.incoming.id] === true);

  const toggleAll = () => {
    const next = !allExpanded;
    setExpanded(
      Object.fromEntries(expandableRows.map((row) => [row.conflict.incoming.id, next]))
    );
  };

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
          {expandableRows.length > 0 ? (
            <Button
              className="import-conflict-expand-all"
              size="sm"
              variant="ghost"
              onClick={toggleAll}
            >
              {allExpanded ? "Hide all details" : "Show all details"}
            </Button>
          ) : null}
          <div className="import-conflict-bulk-choice">
            <span className="import-conflict-bulk-label">Apply to all</span>
            <ResolutionChoice
              label="Resolution for all artworks"
              value={uniformChoice}
              onChange={applyToAll}
            />
          </div>
        </div>
      ) : null}

      <ul className="import-conflict-list">
        {rows.map(({ conflict, expandable, label, lines, summary }) => {
          const yoursUrl = conflict.existing.assetId
            ? localUrls.get(conflict.existing.assetId)
            : undefined;
          const theirsUrl = conflict.incoming.assetId
            ? incomingUrls.get(conflict.incoming.assetId) ??
              localUrls.get(conflict.incoming.assetId)
            : undefined;

          // The choice control is a SIBLING of the disclosure trigger, never a
          // child: a button cannot nest inside a button, and the resolution
          // has to stay clickable and tabbable while the row is closed.
          const head = (
            <div className="import-conflict-head">
              {expandable ? (
                <CollapsibleTrigger className="import-conflict-headtext">
                  <CaretRightIcon
                    aria-hidden="true"
                    className="import-conflict-caret"
                    size={11}
                    weight="bold"
                  />
                  <span className="import-conflict-title">{label}</span>
                  <RowSummaryText summary={summary} />
                </CollapsibleTrigger>
              ) : (
                <div className="import-conflict-headtext">
                  <span className="import-conflict-title">{label}</span>
                  <RowSummaryText summary={summary} />
                </div>
              )}

              <ResolutionChoice
                label={`Resolution for ${label}`}
                value={resolutionFor(conflict)}
                onChange={(next) =>
                  setResolutions((current) => ({ ...current, [conflict.incoming.id]: next }))
                }
              />
            </div>
          );

          if (!expandable) {
            return (
              <li className="import-conflict-row" key={conflict.incoming.id}>
                {head}
              </li>
            );
          }

          return (
            <Collapsible
              asChild
              key={conflict.incoming.id}
              open={expanded[conflict.incoming.id] === true}
              onOpenChange={(next) =>
                setExpanded((current) => ({ ...current, [conflict.incoming.id]: next }))
              }
            >
              <li className="import-conflict-row">
                {head}
                <CollapsibleContent>
                  <div className="import-conflict-detail">
                    {lines.length > 0 ? (
                      <dl className="import-conflict-diff">
                        {lines.map((line) => (
                          <div key={line.key}>
                            <dt>{line.label}</dt>
                            <dd>
                              {line.changed ? (
                                <>
                                  <span className="import-conflict-side">Yours:</span>{" "}
                                  {line.yours} <span aria-hidden="true">·</span>{" "}
                                  <span className="import-conflict-side">Theirs:</span>{" "}
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
                </CollapsibleContent>
              </li>
            </Collapsible>
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
