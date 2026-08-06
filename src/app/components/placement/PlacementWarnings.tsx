import { WarningIcon } from "@phosphor-icons/react/dist/csr/Warning";

export type LabeledPlacementWarning = {
  id: string;
  message: string;
  subject?: string;
  wallObjectId?: string;
};

// A standing problem with a shared opening (missing twin, disagreeing
// halves, ambiguous boundary…) rather than a transient reaction to the
// current edit. Distinct in kind from LabeledPlacementWarning: it is not
// recomputed off the in-progress edit and does not clear on its own —
// see selectSharedOpeningConflicts in domain/placement/sharedOpeningIssues.ts,
// which explicitly leaves merging the two lists to this component.
export type LabeledDocumentIssue = {
  id: string;
  openingId: string;
  subject: string;
  message: string;
};

type GroupedPlacementWarning = LabeledPlacementWarning & {
  count: number;
};

export function groupPlacementWarnings(
  warnings: LabeledPlacementWarning[]
): GroupedPlacementWarning[] {
  const groups = new Map<string, GroupedPlacementWarning>();

  for (const warning of warnings) {
    const key = `${warning.subject ?? ""}\u0000${warning.message}`;
    const existing = groups.get(key);

    if (existing) {
      existing.count += 1;
    } else {
      groups.set(key, { ...warning, count: 1 });
    }
  }

  return [...groups.values()];
}

// Document issues are NOT collapsed the way groupPlacementWarnings collapses
// placement warnings. Placement warnings recompute from scratch on every
// edit and can legitimately re-derive the same subject+message for the same
// underlying condition, so folding duplicates into a "×N" count is a
// presentation nicety. Document issues are already deduplicated at the
// source (selectSharedOpeningConflicts keys each conflict by
// `${openingId}:${reason}`), and two issues that happen to share a subject
// and message ("Door" / "Missing its other half.") almost always name two
// different openings, not the same standing problem twice. Grouping them by
// text would silently hide one of two real, distinct structural problems —
// exactly the kind of loss this feature exists to prevent.
//
// Instead, every document-issue row is its own <button> that selects its
// opening (onSelectIssue). Two rows can legitimately carry the same visible
// subject and message — that is the whole reason grouping is wrong for this
// list — so when that happens their *accessible* name still has to differ,
// or a screen-reader user has no way to tell two buttons apart. The ordinal
// suffix below is computed from documentIssues' own order (which comes from
// selectSharedOpeningConflicts' deterministic id sort), never from render
// timing or array identity, and it is never shown to sighted users — a row
// with a one-of-a-kind subject+message pair gets no ordinal at all.

type DocumentIssueOrdinal = { index: number; total: number };

function computeDocumentIssueOrdinals(
  issues: LabeledDocumentIssue[]
): Map<string, DocumentIssueOrdinal | null> {
  const totals = new Map<string, number>();
  for (const issue of issues) {
    const key = `${issue.subject} ${issue.message}`;
    totals.set(key, (totals.get(key) ?? 0) + 1);
  }

  const seen = new Map<string, number>();
  const ordinals = new Map<string, DocumentIssueOrdinal | null>();
  for (const issue of issues) {
    const key = `${issue.subject} ${issue.message}`;
    const total = totals.get(key) ?? 1;
    if (total <= 1) {
      ordinals.set(issue.id, null);
      continue;
    }
    const index = (seen.get(key) ?? 0) + 1;
    seen.set(key, index);
    ordinals.set(issue.id, { index, total });
  }
  return ordinals;
}

function documentIssueAccessibleName(
  visibleSubject: string,
  message: string,
  ordinal: DocumentIssueOrdinal | null
): string {
  const base = `${visibleSubject}: ${message}`;
  return ordinal ? `${base} (${ordinal.index} of ${ordinal.total})` : base;
}

export function PlacementWarnings({
  warnings,
  documentIssues = [],
  selectedWallObjectId = null,
  onSelectIssue
}: {
  warnings: LabeledPlacementWarning[];
  documentIssues?: LabeledDocumentIssue[];
  selectedWallObjectId?: string | null;
  onSelectIssue?: (openingId: string) => void;
}) {
  const hasWarnings = warnings.length > 0;
  const hasDocumentIssues = documentIssues.length > 0;
  if (!hasWarnings && !hasDocumentIssues) return null;

  const groupedWarnings = groupPlacementWarnings(warnings);
  const warningIssueLabel = `${warnings.length} issue${warnings.length === 1 ? "" : "s"}`;
  // A single-item panel collapses onto one compact row per group — never
  // across groups. If placement has 3 items and document issues has 1, the
  // document group still gets its own compact row; the "single" shorthand
  // is a density choice for a group that truly holds one item, not a claim
  // that this render pass has only one thing to say overall. That keeps a
  // mix of one-of-each from ever being squeezed into a layout built to show
  // exactly one subject and one message.
  const singleWarning = warnings.length === 1 ? groupedWarnings[0] : null;

  const documentIssueLabel = `${documentIssues.length} issue${documentIssues.length === 1 ? "" : "s"}`;
  const singleDocumentIssue = documentIssues.length === 1 ? documentIssues[0] : null;
  const documentIssueOrdinals = computeDocumentIssueOrdinals(documentIssues);

  // One shared live-region sentence, not one per group: a screen reader
  // user should hear a single coherent status update, not two competing
  // announcements. But the sentence never collapses into a bare "N issues" —
  // that would erase exactly the distinction this feature exists to
  // preserve (a transient nudge vs. a standing structural problem), so each
  // clause names its own kind and only combines when both are present.
  const warningClause = hasWarnings
    ? `${warningIssueLabel} need${warnings.length === 1 ? "s" : ""} review`
    : null;
  const documentClause = hasDocumentIssues
    ? `${documentIssueLabel} with shared openings need${documentIssues.length === 1 ? "s" : ""} review`
    : null;
  const statusMessage =
    warningClause && documentClause
      ? `${warningClause}; ${documentClause}.`
      : `${warningClause ?? documentClause}.`;

  return (
    <>
      {hasWarnings ? (
        <section
          className={`warning-panel${singleWarning ? " warning-panel-single" : ""}`}
          aria-label={singleWarning ? "Placement issue" : undefined}
          aria-labelledby={singleWarning ? undefined : "placement-warning-title"}
        >
          {singleWarning ? (
            <div className="warning-panel-single-row">
              <WarningIcon aria-hidden="true" className="warning-panel-icon" size={18} />
              <div className="warning-panel-single-content">
                <div className="warning-panel-subject">
                  <span>
                    {singleWarning.wallObjectId === selectedWallObjectId
                      ? "Placement issue"
                      : (singleWarning.subject ?? "Placement")}
                  </span>
                </div>
                <p>{singleWarning.message}</p>
              </div>
            </div>
          ) : (
            <>
              <div className="warning-panel-header">
                <WarningIcon aria-hidden="true" className="warning-panel-icon" size={18} />
                <div className="warning-panel-title-row">
                  <h3 id="placement-warning-title">Placement needs review</h3>
                  <span className="warning-panel-count" aria-hidden="true">
                    {warningIssueLabel}
                  </span>
                </div>
              </div>

              <ul>
                {groupedWarnings.map((warning) => (
                  <li key={warning.id}>
                    <div className="warning-panel-subject">
                      <span>{warning.subject ?? "Placement"}</span>
                      {warning.count > 1 ? (
                        <span
                          className="warning-panel-group-count"
                          aria-label={`${warning.count} matching issues`}
                        >
                          ×{warning.count}
                        </span>
                      ) : null}
                    </div>
                    <p>{warning.message}</p>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      ) : null}

      {hasDocumentIssues ? (
        <section
          className={`warning-panel warning-panel-document${
            singleDocumentIssue ? " warning-panel-single" : ""
          }`}
          aria-label={singleDocumentIssue ? "Shared opening issue" : undefined}
          aria-labelledby={singleDocumentIssue ? undefined : "document-issue-title"}
        >
          {singleDocumentIssue ? (
            (() => {
              const isSelected = singleDocumentIssue.openingId === selectedWallObjectId;
              const visibleSubject = isSelected ? "Shared opening issue" : singleDocumentIssue.subject;
              return (
                <button
                  type="button"
                  className={`warning-panel-single-row warning-panel-issue-row${
                    isSelected ? " selected" : ""
                  }`}
                  aria-current={isSelected ? "true" : undefined}
                  aria-label={documentIssueAccessibleName(
                    visibleSubject,
                    singleDocumentIssue.message,
                    null
                  )}
                  onClick={() => onSelectIssue?.(singleDocumentIssue.openingId)}
                >
                  <WarningIcon
                    aria-hidden="true"
                    weight="fill"
                    className="warning-panel-icon"
                    size={18}
                  />
                  <div className="warning-panel-single-content">
                    <div className="warning-panel-subject">
                      <span>{visibleSubject}</span>
                    </div>
                    <p>{singleDocumentIssue.message}</p>
                  </div>
                </button>
              );
            })()
          ) : (
            <>
              <div className="warning-panel-header">
                <WarningIcon
                  aria-hidden="true"
                  weight="fill"
                  className="warning-panel-icon"
                  size={18}
                />
                <div className="warning-panel-title-row">
                  <h3 id="document-issue-title">Shared openings need review</h3>
                  <span className="warning-panel-count" aria-hidden="true">
                    {documentIssueLabel}
                  </span>
                </div>
              </div>

              <ul>
                {documentIssues.map((issue) => {
                  const isSelected = issue.openingId === selectedWallObjectId;
                  const ordinal = documentIssueOrdinals.get(issue.id) ?? null;
                  return (
                    <li key={issue.id}>
                      <button
                        type="button"
                        className={`warning-panel-issue-row warning-panel-issue-list-row${
                          isSelected ? " selected" : ""
                        }`}
                        aria-current={isSelected ? "true" : undefined}
                        aria-label={documentIssueAccessibleName(issue.subject, issue.message, ordinal)}
                        onClick={() => onSelectIssue?.(issue.openingId)}
                      >
                        <div className="warning-panel-subject">
                          <span>{issue.subject}</span>
                        </div>
                        <p>{issue.message}</p>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </section>
      ) : null}

      <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {statusMessage}
      </span>
    </>
  );
}
