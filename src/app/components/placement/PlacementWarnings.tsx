import { WarningIcon } from "@phosphor-icons/react/dist/csr/Warning";

export type LabeledPlacementWarning = {
  id: string;
  message: string;
  subject?: string;
  wallObjectId?: string;
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

export function PlacementWarnings({
  warnings,
  selectedWallObjectId = null
}: {
  warnings: LabeledPlacementWarning[];
  selectedWallObjectId?: string | null;
}) {
  if (warnings.length === 0) return null;

  const groupedWarnings = groupPlacementWarnings(warnings);
  const issueLabel = `${warnings.length} issue${warnings.length === 1 ? "" : "s"}`;
  const singleWarning = warnings.length === 1 ? groupedWarnings[0] : null;

  return (
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
                {issueLabel}
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

      <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {issueLabel} need{warnings.length === 1 ? "s" : ""} review.
      </span>
    </section>
  );
}
