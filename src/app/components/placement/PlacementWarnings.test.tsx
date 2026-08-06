import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
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

  it("offers no resolution affordance for document issues — rows only select, they never resolve", () => {
    render(<PlacementWarnings warnings={[]} documentIssues={[doorMissingTwin, windowDisagreement]} />);
    // Rows are buttons now (selection), but Stage 6's resolver actions
    // (Resolve / Complete shared opening / Split / Realign / Keep…) must
    // never appear here — this component only ever selects an opening.
    for (const button of screen.getAllByRole("button")) {
      expect(button).not.toHaveAccessibleName(/resolve|complete|split|realign|keep/i);
    }
  });

  describe("row selection", () => {
    const doorA: LabeledDocumentIssue = {
      id: "door-a:missing-twin",
      openingId: "door-a",
      subject: "Door in Gallery 1",
      message: "Missing its other half on the facing wall."
    };
    const doorB: LabeledDocumentIssue = {
      id: "door-b:missing-twin",
      openingId: "door-b",
      subject: "Door in Gallery 1",
      message: "Missing its other half on the facing wall."
    };

    it("gives two document issues with identical subject and message distinct, individually clickable rows", () => {
      const onSelectIssue = vi.fn();
      render(
        <PlacementWarnings
          warnings={[]}
          documentIssues={[doorA, doorB]}
          onSelectIssue={onSelectIssue}
        />
      );

      const buttons = screen.getAllByRole("button");
      expect(buttons).toHaveLength(2);
      expect(buttons[0]).not.toBe(buttons[1]);

      // The regression: clicking the SECOND row must select the second
      // opening, not silently re-select the first.
      fireEvent.click(buttons[1]);
      expect(onSelectIssue).toHaveBeenCalledTimes(1);
      expect(onSelectIssue).toHaveBeenCalledWith("door-b");

      fireEvent.click(buttons[0]);
      expect(onSelectIssue).toHaveBeenCalledTimes(2);
      expect(onSelectIssue).toHaveBeenNthCalledWith(2, "door-a");
    });

    it("gives rows with identical visible subject and message different accessible names", () => {
      render(<PlacementWarnings warnings={[]} documentIssues={[doorA, doorB]} />);

      const buttons = screen.getAllByRole("button");
      const names = buttons.map((button) => button.getAttribute("aria-label"));
      expect(names[0]).not.toEqual(names[1]);
      // Both still carry the shared visible subject and message as a
      // recognizable prefix — only a stable differentiator is appended.
      expect(names[0]).toMatch(/^Door in Gallery 1: Missing its other half on the facing wall\./);
      expect(names[1]).toMatch(/^Door in Gallery 1: Missing its other half on the facing wall\./);
    });

    it("adds no ordinal noise to a row whose subject and message are already unique", () => {
      render(
        <PlacementWarnings
          warnings={[]}
          documentIssues={[doorMissingTwin, windowDisagreement]}
        />
      );

      const doorButton = screen.getByRole("button", {
        name: "Door: Missing its other half on the facing wall."
      });
      expect(doorButton).toBeInTheDocument();
      // No visible ordinal clutter either.
      const visibleSubjects = screen.getAllByText("Door");
      expect(visibleSubjects).toHaveLength(1);
    });

    it("renders selected state on the matching row only, via a class and aria-current", () => {
      render(
        <PlacementWarnings
          warnings={[]}
          documentIssues={[doorA, doorB]}
          selectedWallObjectId="door-b"
        />
      );

      const buttons = screen.getAllByRole("button");
      const [firstButton, secondButton] = buttons;

      expect(firstButton).not.toHaveClass("selected");
      expect(firstButton).not.toHaveAttribute("aria-current");

      expect(secondButton).toHaveClass("selected");
      expect(secondButton).toHaveAttribute("aria-current", "true");
    });

    it("is a native <button> so Enter/Space activation is native browser behavior, not a reimplemented handler", () => {
      const onSelectIssue = vi.fn();
      render(
        <PlacementWarnings
          warnings={[]}
          documentIssues={[doorMissingTwin]}
          onSelectIssue={onSelectIssue}
        />
      );

      const button = screen.getByRole("button", { name: /Door/ });
      // Real <button type="button">, not a <li>/<div role="button"> — this
      // is what makes native Enter/Space activation apply at all (jsdom does
      // not simulate that browser default action, so we assert the native
      // element/type and that the browser-dispatched click it produces
      // reaches onSelectIssue).
      expect(button.tagName).toBe("BUTTON");
      expect(button).toHaveAttribute("type", "button");

      button.focus();
      expect(document.activeElement).toBe(button);

      fireEvent.click(button);
      expect(onSelectIssue).toHaveBeenCalledWith(doorMissingTwin.openingId);
    });

    it("renders document-issue rows and does not throw when onSelectIssue is omitted", () => {
      expect(() =>
        render(<PlacementWarnings warnings={[]} documentIssues={[doorA, doorB]} />)
      ).not.toThrow();

      const buttons = screen.getAllByRole("button");
      expect(buttons).toHaveLength(2);

      // A missing-handler regression (e.g. calling onSelectIssue(...) instead
      // of onSelectIssue?.(...)) throws from inside a DOM event listener,
      // which jsdom reports via a global "error" event rather than
      // re-throwing synchronously out of fireEvent.click — so an
      // uncaught-error listener is what actually catches it here.
      const onUncaughtError = vi.fn();
      window.addEventListener("error", onUncaughtError);
      try {
        fireEvent.click(buttons[0]);
        fireEvent.click(buttons[1]);
      } finally {
        window.removeEventListener("error", onUncaughtError);
      }
      expect(onUncaughtError).not.toHaveBeenCalled();
    });

    it("makes the single-issue compact row a clickable, selectable button too", () => {
      const onSelectIssue = vi.fn();
      render(
        <PlacementWarnings
          warnings={[]}
          documentIssues={[doorMissingTwin]}
          selectedWallObjectId="door-a"
          onSelectIssue={onSelectIssue}
        />
      );

      const button = screen.getByRole("button", { name: /Shared opening issue/ });
      expect(button).toHaveClass("selected");
      expect(button).toHaveAttribute("aria-current", "true");

      fireEvent.click(button);
      expect(onSelectIssue).toHaveBeenCalledWith("door-a");
    });
  });
});
