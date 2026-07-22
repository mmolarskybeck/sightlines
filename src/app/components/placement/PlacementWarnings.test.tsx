import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PlacementWarnings, groupPlacementWarnings } from "./PlacementWarnings";

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
});
