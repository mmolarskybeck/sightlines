import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  PlacementWarnings,
  groupPlacementWarnings,
  type LabeledDocumentIssue,
  type LabeledPlacementWarning
} from "./PlacementWarnings";

const doorMissingTwin: LabeledDocumentIssue = {
  id: "door-a:missing-twin",
  openingId: "door-a",
  subject: "Door",
  message: "Missing its other half on the facing wall."
};

const windowDisagreement: LabeledDocumentIssue = {
  id: "window-b:width-mismatch",
  openingId: "window-b",
  subject: "Window",
  message: "The two faces disagree on width."
};

describe("PlacementWarnings", () => {
  it("groups repeated subject and message pairs without losing the issue count", () => {
    const warnings = [
      { id: "window-a", subject: "Window", message: "Placement overlaps another object." },
      { id: "window-b", subject: "Window", message: "Placement overlaps another object." },
      { id: "door-a", subject: "Door", message: "Placement extends beyond the wall." }
    ];

    expect(groupPlacementWarnings(warnings)).toEqual([
      { ...warnings[0], count: 2 },
      { ...warnings[2], count: 1 }
    ]);

    render(<PlacementWarnings warnings={warnings} />);

    expect(screen.getByText("3 issues")).toBeInTheDocument();
    expect(screen.getByLabelText("2 matching issues")).toHaveTextContent("×2");
    expect(screen.getAllByText("Placement overlaps another object.")).toHaveLength(1);
    expect(screen.getByRole("status")).toHaveTextContent("3 issues need review.");
  });

  it("uses singular grammar for one issue", () => {
    render(
      <PlacementWarnings
        warnings={[
          {
            id: "window-a",
            wallObjectId: "window-a",
            subject: "Window",
            message: "Placement is outside the wall."
          }
        ]}
        selectedWallObjectId="window-a"
      />
    );

    expect(screen.getByRole("region", { name: "Placement issue" })).toBeInTheDocument();
    expect(screen.getByText("Placement issue")).toBeInTheDocument();
    expect(screen.queryByText("Window")).not.toBeInTheDocument();
    expect(screen.queryByText("1 issue")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("1 issue needs review.");
  });

  it("renders nothing when both warnings and document issues are empty", () => {
    const { container } = render(<PlacementWarnings warnings={[]} documentIssues={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when documentIssues is omitted and warnings is empty", () => {
    const { container } = render(<PlacementWarnings warnings={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders document issues even when there are no placement warnings", () => {
    render(
      <PlacementWarnings warnings={[]} documentIssues={[doorMissingTwin, windowDisagreement]} />
    );

    expect(
      screen.queryByRole("region", { name: /placement/i })
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Shared openings need review" })
    ).toBeInTheDocument();
    expect(screen.getByText("Missing its other half on the facing wall.")).toBeInTheDocument();
    expect(screen.getByText("The two faces disagree on width.")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("2 issues with shared openings need review.");
  });

  it("distinguishes placement warnings from document issues, both to sighted users and to a screen reader", () => {
    const warnings: LabeledPlacementWarning[] = [
      { id: "w1", subject: "Window", message: "Placement overlaps another object." },
      { id: "w2", subject: "Door", message: "Placement extends beyond the wall." }
    ];

    render(<PlacementWarnings warnings={warnings} documentIssues={[doorMissingTwin, windowDisagreement]} />);

    // Two independent landmark regions, each with its own accessible name —
    // a screen reader user can tell them apart without reading every row.
    expect(
      screen.getByRole("heading", { name: "Placement needs review" })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Shared openings need review" })
    ).toBeInTheDocument();

    const placementSection = screen.getByRole("heading", {
      name: "Placement needs review"
    }).closest("section");
    const documentSection = screen.getByRole("heading", {
      name: "Shared openings need review"
    }).closest("section");

    expect(placementSection).not.toBeNull();
    expect(documentSection).not.toBeNull();
    expect(placementSection).not.toBe(documentSection);
    expect(placementSection).not.toHaveClass("warning-panel-document");
    expect(documentSection).toHaveClass("warning-panel-document");

    // One combined, honest live-region sentence: it must not collapse into
    // an undifferentiated "4 issues" that hides which two are structural.
    expect(screen.getByRole("status")).toHaveTextContent(
      "2 issues need review; 2 issues with shared openings need review."
    );
    expect(screen.getByRole("status").textContent).not.toMatch(/^4 issues?/);
  });

  it("keeps a single document issue in its own compact row, distinct from a single placement warning", () => {
    render(
      <PlacementWarnings
        warnings={[{ id: "w1", subject: "Window", message: "Placement is outside the wall." }]}
        documentIssues={[doorMissingTwin]}
      />
    );

    // Two compact single-item cards, not one card wearing two subjects: a
    // mixed one-of-each never falls into a layout meant for a single issue.
    expect(screen.getByRole("region", { name: "Placement issue" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Shared opening issue" })).toBeInTheDocument();
    expect(screen.getByText("Missing its other half on the facing wall.")).toBeInTheDocument();
    // Not selected, so the document issue keeps its own subject rather than
    // being swapped for the generic "Shared opening issue" label.
    expect(screen.getByText("Door")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(
      "1 issue needs review; 1 issue with shared openings needs review."
    );
  });

  it("swaps a single document issue's subject for 'Shared opening issue' only when it matches the selected wall object", () => {
    const { rerender } = render(
      <PlacementWarnings warnings={[]} documentIssues={[doorMissingTwin]} />
    );
    expect(screen.getByText("Door")).toBeInTheDocument();
    expect(screen.queryByText("Shared opening issue")).not.toBeInTheDocument();

    rerender(
      <PlacementWarnings
        warnings={[]}
        documentIssues={[doorMissingTwin]}
        selectedWallObjectId="door-a"
      />
    );
    expect(screen.queryByText("Door")).not.toBeInTheDocument();
    expect(screen.getByText("Shared opening issue")).toBeInTheDocument();
  });

  it("does not group document issues by subject and message, unlike placement warnings", () => {
    const sameTextTwice: LabeledDocumentIssue[] = [
      { id: "door-a:missing-twin", openingId: "door-a", subject: "Door", message: "Missing its other half." },
      { id: "door-c:missing-twin", openingId: "door-c", subject: "Door", message: "Missing its other half." }
    ];

    render(<PlacementWarnings warnings={[]} documentIssues={sameTextTwice} />);

    // Both distinct openings must remain visible — grouping by text would
    // silently drop one of two real, separate structural problems.
    expect(screen.getAllByText("Missing its other half.")).toHaveLength(2);
    expect(screen.queryByText(/×2/)).not.toBeInTheDocument();
    expect(screen.getByText("2 issues")).toBeInTheDocument();
  });

  it("offers no action or resolution affordance for document issues", () => {
    render(<PlacementWarnings warnings={[]} documentIssues={[doorMissingTwin, windowDisagreement]} />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
