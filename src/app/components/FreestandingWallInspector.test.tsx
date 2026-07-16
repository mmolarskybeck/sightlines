import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FreestandingWall } from "../../domain/project";
import type { PartitionClearances, SideClearance } from "../../domain/geometry/partitionSpacing";
import { FreestandingWallInspector } from "./FreestandingWallInspector";

afterEach(cleanup);

const wall: FreestandingWall = {
  id: "partition-1",
  roomId: "room-1",
  name: "Partition 1",
  startXMm: 1000,
  startYMm: 2000,
  endXMm: 3000,
  endYMm: 2000,
  thicknessMm: 304.8,
  heightMm: 2400
};

function side(xMm: number, yMm: number, distanceMm: number | null): SideClearance {
  return {
    originMm: { xMm: 0, yMm: 0 },
    dirUnit: { xMm, yMm },
    hit:
      distanceMm === null
        ? null
        : { distanceMm, pointMm: { xMm: 0, yMm: 0 }, obstacleId: "room-wall" }
  };
}

function renderInspector(clearances: PartitionClearances | null) {
  const onCommitClearance = vi.fn().mockResolvedValue(undefined);
  const onDuplicate = vi.fn().mockResolvedValue(undefined);
  render(
    <FreestandingWallInspector
      wall={wall}
      unit="m"
      clearances={clearances}
      onCenter={vi.fn()}
      onCommitAngle={vi.fn()}
      onCommitClearance={onCommitClearance}
      onCommitHeight={vi.fn()}
      onCommitLength={vi.fn()}
      onCommitThickness={vi.fn()}
      onDelete={vi.fn()}
      onDuplicate={onDuplicate}
      onViewFace={vi.fn()}
    />
  );
  return { onCommitClearance, onDuplicate };
}

describe("FreestandingWallInspector", () => {
  it("shows only hit clearances with directional and diagonal fallback labels", () => {
    renderInspector({
      normal: { plus: side(1, 0, 1000), minus: side(-1, 0, null) },
      span: { plus: side(0.5, 0.5, 500), minus: side(-0.5, -0.5, 750) }
    });

    expect(screen.getByRole("heading", { name: "Distances" })).toBeInTheDocument();
    expect(screen.getByLabelText("To right")).toBeInTheDocument();
    expect(screen.queryByLabelText("To left")).not.toBeInTheDocument();
    expect(screen.getByLabelText("End A")).toBeInTheDocument();
    expect(screen.getByLabelText("End B")).toBeInTheDocument();
  });

  it("duplicates the partition from the action above Delete", () => {
    const { onDuplicate } = renderInspector(null);

    fireEvent.click(screen.getByRole("button", { name: "Duplicate partition" }));

    expect(onDuplicate).toHaveBeenCalledOnce();
  });

  it("commits zero clearance but rejects a negative distance", async () => {
    const { onCommitClearance } = renderInspector({
      normal: { plus: side(0, -1, 1000), minus: side(0, 1, null) },
      span: { plus: side(1, 0, null), minus: side(-1, 0, null) }
    });
    const input = screen.getByLabelText("To up");

    fireEvent.change(input, { target: { value: "0" } });
    fireEvent.blur(input);
    await waitFor(() =>
      expect(onCommitClearance).toHaveBeenCalledWith("normal-plus", 0)
    );

    onCommitClearance.mockClear();
    fireEvent.change(input, { target: { value: "-1 m" } });
    fireEvent.blur(input);
    expect(await screen.findByText("Distance cannot be negative.")).toBeInTheDocument();
    expect(onCommitClearance).not.toHaveBeenCalled();
  });
});
