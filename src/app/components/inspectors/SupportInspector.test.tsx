import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SupportFloorObject } from "../../../domain/project";
import { TooltipProvider } from "../ui/tooltip";
import { SupportInspector } from "./SupportInspector";

// Radix Select drives itself through Pointer Events and a portal, neither of
// which jsdom implements usefully. Same lightweight stand-in OpeningInspector's
// and the old StandsOnField's suites use: the trigger keeps its combobox role
// and aria-label, and every item is a clickable option reporting its own value.
vi.mock("../ui/select", async () => {
  const { createContext, useContext } = await import("react");
  const Context = createContext<{
    value?: string;
    onValueChange?: (value: string) => void;
  }>({});
  return {
    Select: ({
      value,
      onValueChange,
      children
    }: {
      value?: string;
      onValueChange?: (value: string) => void;
      children: React.ReactNode;
    }) => <Context.Provider value={{ value, onValueChange }}>{children}</Context.Provider>,
    SelectTrigger: ({ children, ...props }: React.ComponentProps<"button">) => (
      <button type="button" role="combobox" {...props}>
        {children}
      </button>
    ),
    SelectValue: () => {
      const context = useContext(Context);
      return <span>{context.value}</span>;
    },
    SelectContent: ({ children }: { children: React.ReactNode }) => (
      <div role="listbox">{children}</div>
    ),
    SelectItem: ({ children, value }: { children: React.ReactNode; value: string }) => {
      const context = useContext(Context);
      return (
        <button role="option" type="button" onClick={() => context.onValueChange?.(value)}>
          {children}
        </button>
      );
    }
  };
});

afterEach(cleanup);

const pedestal: SupportFloorObject = {
  id: "support-1",
  kind: "support",
  supportKind: "pedestal",
  xMm: 1200,
  yMm: 800,
  widthMm: 500,
  depthMm: 400,
  heightMm: 1100,
  rotationDeg: 0,
  wallYMm: 0
};

function renderInspector(overrides: Partial<Parameters<typeof SupportInspector>[0]> = {}) {
  const props = {
    support: pedestal,
    riderCount: 0,
    unit: "cm" as const,
    onSelectRiders: vi.fn(),
    onCommitKind: vi.fn(),
    onCommitPosition: vi.fn(),
    onCommitSize: vi.fn(),
    onCommitTop: vi.fn(),
    onCommitRotation: vi.fn(),
    onCommitOverhangAllowed: vi.fn(),
    onCommitBonnet: vi.fn(),
    onFitToWorks: vi.fn(),
    onDelete: vi.fn(),
    ...overrides
  };
  render(
    <TooltipProvider>
      <SupportInspector {...props} />
    </TooltipProvider>
  );
  return props;
}

function commit(label: string, value: string) {
  const input = screen.getByLabelText(label);
  fireEvent.change(input, { target: { value } });
  fireEvent.blur(input);
}

describe("SupportInspector", () => {
  describe("Holds", () => {
    // Nothing standing on it yet: the notice teaches the gesture instead of
    // showing a readout with nothing to select.
    it("teaches the drag gesture at zero", () => {
      renderInspector({ riderCount: 0 });

      expect(
        screen.getByText("Nothing stands on it yet. Drag a work onto it in plan or 3D.")
      ).toBeInTheDocument();
      expect(screen.queryByText("Holds")).toBeNull();
      expect(screen.queryByRole("button", { name: "Select works" })).toBeNull();
    });

    it("counts the works and selects them", () => {
      const props = renderInspector({ riderCount: 3 });

      expect(screen.getByText("Holds")).toBeInTheDocument();
      expect(screen.getByText("3 works")).toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: "Select works" }));
      expect(props.onSelectRiders).toHaveBeenCalledTimes(1);
    });

    it("says one work in the singular", () => {
      renderInspector({ riderCount: 1 });
      expect(screen.getByText("1 work")).toBeInTheDocument();
    });
  });

  it("switches kind through the select", () => {
    const props = renderInspector();

    expect(screen.getByRole("combobox", { name: "Kind" })).toHaveTextContent("pedestal");
    fireEvent.click(screen.getByRole("option", { name: "Plinth" }));
    expect(props.onCommitKind).toHaveBeenCalledWith("plinth");
  });

  // heightMm on a support is the face a work stands on, so the field says so —
  // the same reading the shelf's "Top height" gives.
  it("labels the height as the TOP face and commits it", () => {
    const props = renderInspector();

    expect(screen.getByLabelText("Top height")).toHaveValue("110 cm");
    expect(screen.queryByLabelText("Height")).toBeNull();
    // A support never hangs, so there is no base-height field at all.
    expect(screen.queryByLabelText("Height off floor")).toBeNull();

    commit("Top height", "90");
    expect(props.onCommitTop).toHaveBeenCalledWith(900);
  });

  it("wires the shared floor placement fields", () => {
    const props = renderInspector();

    commit("X (floor)", "150");
    expect(props.onCommitPosition).toHaveBeenCalledWith(1500, 800);
    commit("Width", "60");
    expect(props.onCommitSize).toHaveBeenLastCalledWith(600, 400);
    commit("Depth", "35");
    expect(props.onCommitSize).toHaveBeenLastCalledWith(500, 350);

    const angle = screen.getByLabelText("Angle in degrees");
    fireEvent.change(angle, { target: { value: "45" } });
    fireEvent.blur(angle);
    expect(props.onCommitRotation).toHaveBeenCalledWith(45);
  });

  describe("overhang", () => {
    it("toggles the switch and explains what off means", () => {
      const props = renderInspector();

      const overhang = screen.getByLabelText("Allow overhang");
      expect(overhang).not.toBeChecked();
      expect(
        screen.getByText("Off keeps every work inside the top face.")
      ).toBeInTheDocument();

      fireEvent.click(overhang);
      expect(props.onCommitOverhangAllowed).toHaveBeenCalledWith(true);
    });

    // Glass clears overhang, so the switch is disabled rather than hidden —
    // the rule stays visible where a curator goes looking for it.
    it("is disabled while a bonnet is on", () => {
      renderInspector({ support: { ...pedestal, bonnetHeightMm: 600 } });

      expect(screen.getByLabelText("Allow overhang")).toBeDisabled();
    });
  });

  describe("plexi bonnet", () => {
    it("shows no height row until the bonnet is on, and enables it", () => {
      const props = renderInspector();

      expect(screen.getByLabelText("Plexi bonnet")).not.toBeChecked();
      expect(screen.queryByLabelText("Bonnet height")).toBeNull();

      fireEvent.click(screen.getByLabelText("Plexi bonnet"));
      expect(props.onCommitBonnet).toHaveBeenCalledWith({ enabled: true });
    });

    it("commits a typed height and toggles the lock", () => {
      const props = renderInspector({
        support: { ...pedestal, bonnetHeightMm: 600 }
      });

      expect(screen.getByLabelText("Plexi bonnet")).toBeChecked();
      expect(screen.getByLabelText("Bonnet height")).toHaveValue("60 cm");

      commit("Bonnet height", "80");
      expect(props.onCommitBonnet).toHaveBeenLastCalledWith({ heightMm: 800 });

      fireEvent.click(screen.getByRole("button", { name: "Lock the bonnet height" }));
      expect(props.onCommitBonnet).toHaveBeenLastCalledWith({ locked: true });
    });

    it("unlocks a locked height back to tracking the works", () => {
      const props = renderInspector({
        support: { ...pedestal, bonnetHeightMm: 600, bonnetHeightLocked: true }
      });

      fireEvent.click(screen.getByRole("button", { name: "Lock the bonnet height" }));
      expect(props.onCommitBonnet).toHaveBeenLastCalledWith({ locked: false });
    });

    it("turns the bonnet off", () => {
      const props = renderInspector({
        support: { ...pedestal, bonnetHeightMm: 600 }
      });

      fireEvent.click(screen.getByLabelText("Plexi bonnet"));
      expect(props.onCommitBonnet).toHaveBeenCalledWith({ enabled: false });
    });
  });

  // Disabled, not hidden: the verb is what this box is for, and a button that
  // appeared the moment a work landed would read as a new feature.
  it("disables Fit to works with nothing standing on it", () => {
    renderInspector({ riderCount: 0 });
    expect(screen.getByRole("button", { name: "Fit to works" })).toBeDisabled();
  });

  it("fits to works once something stands on it", () => {
    const props = renderInspector({ riderCount: 2 });

    const fit = screen.getByRole("button", { name: "Fit to works" });
    expect(fit).toBeEnabled();
    fireEvent.click(fit);
    expect(props.onFitToWorks).toHaveBeenCalledTimes(1);
  });

  it("deletes by the kind's own noun", () => {
    const props = renderInspector();

    fireEvent.click(screen.getByRole("button", { name: "Delete pedestal" }));
    expect(props.onDelete).toHaveBeenCalledTimes(1);

    cleanup();
    renderInspector({ support: { ...pedestal, supportKind: "plinth" } });
    expect(screen.getByRole("button", { name: "Delete plinth" })).toBeInTheDocument();
  });

  it("never says rider or seat", () => {
    const { container } = render(
      <TooltipProvider>
        <SupportInspector
          support={{ ...pedestal, bonnetHeightMm: 600 }}
          riderCount={2}
          unit="cm"
          onSelectRiders={vi.fn()}
          onCommitKind={vi.fn()}
          onCommitPosition={vi.fn()}
          onCommitSize={vi.fn()}
          onCommitTop={vi.fn()}
          onCommitRotation={vi.fn()}
          onCommitOverhangAllowed={vi.fn()}
          onCommitBonnet={vi.fn()}
          onFitToWorks={vi.fn()}
          onDelete={vi.fn()}
        />
      </TooltipProvider>
    );

    expect(container.textContent?.toLowerCase()).not.toMatch(/rider|seat/);
  });
});
