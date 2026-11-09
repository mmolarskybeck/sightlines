import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SupportFloorObject } from "../../../domain/project";
import type { FloorStandsOn } from "../../../domain/placement/floorRiders";
import { FloorArtworkSupportRow } from "./FloorArtworkSupportRow";

afterEach(cleanup);

const pedestal: SupportFloorObject = {
  id: "support-1",
  kind: "support",
  supportKind: "pedestal",
  xMm: 1000,
  yMm: 1000,
  widthMm: 500,
  depthMm: 400,
  heightMm: 1100,
  rotationDeg: 0,
  wallYMm: 0
};

function renderRow(
  standsOn: FloorStandsOn,
  overrides: Partial<Parameters<typeof FloorArtworkSupportRow>[0]> = {}
) {
  const props = {
    placementId: "floor-a",
    standsOn,
    unit: "cm" as const,
    onCenterOnSupport: vi.fn(),
    onCommitSuspensionHeight: vi.fn(),
    onPutOnSupport: vi.fn(),
    onSelectSupport: vi.fn(),
    onSetOnFloor: vi.fn(),
    onSuspend: vi.fn(),
    ...overrides
  };
  render(<FloorArtworkSupportRow {...props} />);
  return props;
}

function actionLabels(): string[] {
  return screen.getAllByRole("button").map((button) => button.textContent ?? "");
}

describe("FloorArtworkSupportRow", () => {
  describe("on the floor", () => {
    it("reads On the floor and offers both supports plus Suspend", () => {
      const props = renderRow({ kind: "floor" });

      expect(screen.getByText("Support")).toBeInTheDocument();
      expect(screen.getByText("On the floor")).toBeInTheDocument();
      expect(actionLabels()).toEqual(["Put on pedestal", "Put on plinth", "Suspend"]);

      fireEvent.click(screen.getByRole("button", { name: "Put on pedestal" }));
      expect(props.onPutOnSupport).toHaveBeenLastCalledWith("pedestal");
      fireEvent.click(screen.getByRole("button", { name: "Put on plinth" }));
      expect(props.onPutOnSupport).toHaveBeenLastCalledWith("plinth");
      fireEvent.click(screen.getByRole("button", { name: "Suspend" }));
      expect(props.onSuspend).toHaveBeenCalledTimes(1);
    });

    // A CRT does not hang on wires — the rule resolveFloorStandsOn, the
    // elevation ghost and CrtMonitorMesh all already apply.
    it("hides Suspend for a box monitor", () => {
      renderRow({ kind: "floor" }, { isMonitor: true });

      expect(actionLabels()).toEqual(["Put on pedestal", "Put on plinth"]);
    });
  });

  describe("on a support", () => {
    it("reads the pedestal's own size and offers its three verbs", () => {
      const props = renderRow({ kind: "support", support: pedestal });

      expect(screen.getByText("On pedestal")).toBeInTheDocument();
      // The support's size is the quiet second line, so the value never runs
      // past the panel edge at 300px.
      expect(screen.getByText("50 cm × 40 cm × 110 cm")).toBeInTheDocument();
      expect(actionLabels()).toEqual([
        "Select pedestal",
        "Center on pedestal",
        "Set on floor"
      ]);

      fireEvent.click(screen.getByRole("button", { name: "Select pedestal" }));
      expect(props.onSelectSupport).toHaveBeenCalledTimes(1);
      fireEvent.click(screen.getByRole("button", { name: "Center on pedestal" }));
      expect(props.onCenterOnSupport).toHaveBeenCalledTimes(1);
      fireEvent.click(screen.getByRole("button", { name: "Set on floor" }));
      expect(props.onSetOnFloor).toHaveBeenCalledTimes(1);
    });

    // The kind noun carries through the whole row: a panel that said "Select
    // plinth" beside "Center on pedestal" would read as two objects.
    it("says plinth everywhere when the support is one", () => {
      renderRow({
        kind: "support",
        support: { ...pedestal, supportKind: "plinth", heightMm: 150 }
      });

      expect(screen.getByText("On plinth")).toBeInTheDocument();
      expect(screen.getByText("50 cm × 40 cm × 15 cm")).toBeInTheDocument();
      expect(actionLabels()).toEqual([
        "Select plinth",
        "Center on plinth",
        "Set on floor"
      ]);
    });

    it("never offers Suspend or a way to put it on a second support", () => {
      renderRow({ kind: "support", support: pedestal });

      expect(screen.queryByRole("button", { name: "Suspend" })).toBeNull();
      expect(screen.queryByRole("button", { name: "Put on pedestal" })).toBeNull();
    });
  });

  describe("suspended", () => {
    it("reads Suspended, carries the height field, and offers the two exits", () => {
      const props = renderRow({ kind: "suspended", heightMm: 1000 });

      expect(screen.getByText("Suspended")).toBeInTheDocument();
      expect(screen.getByLabelText("Height off floor")).toHaveValue("100 cm");
      expect(actionLabels()).toEqual(["Set on floor", "Put on pedestal"]);

      const input = screen.getByLabelText("Height off floor");
      fireEvent.change(input, { target: { value: "150" } });
      fireEvent.blur(input);
      expect(props.onCommitSuspensionHeight).toHaveBeenCalledWith(1500);
    });

    it("puts a suspended work on a pedestal", () => {
      const props = renderRow({ kind: "suspended", heightMm: 1000 });

      fireEvent.click(screen.getByRole("button", { name: "Put on pedestal" }));
      expect(props.onPutOnSupport).toHaveBeenLastCalledWith("pedestal");
    });
  });

  // "Rider" and "seat" are internal words for this relationship and must never
  // reach a curator (floor-supports spec §7).
  it("never says rider or seat in any state", () => {
    for (const standsOn of [
      { kind: "floor" } as const,
      { kind: "suspended", heightMm: 1000 } as const,
      { kind: "support", support: pedestal } as const
    ]) {
      const { container } = render(
        <FloorArtworkSupportRow
          placementId="floor-a"
          standsOn={standsOn}
          unit="cm"
          onCenterOnSupport={vi.fn()}
          onCommitSuspensionHeight={vi.fn()}
          onPutOnSupport={vi.fn()}
          onSelectSupport={vi.fn()}
          onSetOnFloor={vi.fn()}
          onSuspend={vi.fn()}
        />
      );
      expect(container.textContent?.toLowerCase()).not.toMatch(/rider|seat/);
      cleanup();
    }
  });
});
