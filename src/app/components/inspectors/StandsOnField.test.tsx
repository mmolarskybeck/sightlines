import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ArtworkFloorObject } from "../../../domain/project";
import { StandsOnField } from "./StandsOnField";

// Radix Select drives itself through Pointer Events and a portal, neither of
// which jsdom implements usefully. Same lightweight stand-in OpeningInspector's
// and ExportPdfDialog's suites use: the trigger keeps its combobox role and
// aria-label, and every item is a clickable option that reports its own value.
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

const floorArtwork: ArtworkFloorObject = {
  id: "floor-a",
  kind: "artwork",
  artworkId: "art-a",
  xMm: 1000,
  yMm: 1000,
  widthMm: 400,
  depthMm: 400,
  heightMm: 600,
  wallYMm: 1450,
  rotationDeg: 0
};

function optionLabels(): string[] {
  return screen.getAllByRole("option").map((option) => option.textContent ?? "");
}

describe("StandsOnField", () => {
  it("offers all four states for an ordinary floor work", () => {
    render(
      <StandsOnField
        artwork={{ displayAs: "sculpture" }}
        floorObject={floorArtwork}
        isMonitor={false}
        onChange={vi.fn()}
      />
    );

    expect(optionLabels()).toEqual(["Floor", "Pedestal", "Plinth", "Suspended"]);
  });

  // A CRT does not hang on wires (resolveStandsOn refuses to report a monitor
  // as suspended, and the store action refuses to write it), so the option is
  // absent rather than present-and-refused.
  it("withholds Suspended for a box monitor", () => {
    render(
      <StandsOnField
        artwork={{ displayAs: "monitor" }}
        floorObject={floorArtwork}
        isMonitor
        onChange={vi.fn()}
      />
    );

    expect(optionLabels()).toEqual(["Floor", "Pedestal", "Plinth"]);
  });

  it("shows the resolved state, not the stored keys: an untouched monitor reads Pedestal", () => {
    render(
      <StandsOnField
        artwork={{ displayAs: "monitor" }}
        floorObject={floorArtwork}
        isMonitor
        onChange={vi.fn()}
      />
    );

    expect(screen.getByRole("combobox", { name: "Stands on" })).toHaveTextContent(
      "pedestal"
    );
  });

  it("an untouched non-monitor reads Floor, and a suspension height reads Suspended", () => {
    const { rerender } = render(
      <StandsOnField
        artwork={{ displayAs: "sculpture" }}
        floorObject={floorArtwork}
        isMonitor={false}
        onChange={vi.fn()}
      />
    );
    expect(screen.getByRole("combobox", { name: "Stands on" })).toHaveTextContent("floor");

    rerender(
      <StandsOnField
        artwork={{ displayAs: "sculpture" }}
        floorObject={{ ...floorArtwork, baseHeightMm: 1200 }}
        isMonitor={false}
        onChange={vi.fn()}
      />
    );
    expect(screen.getByRole("combobox", { name: "Stands on" })).toHaveTextContent(
      "suspended"
    );
  });

  // A support wins over a stale suspension height: the work's bottom edge is
  // the support's top face and every renderer ignores baseHeightMm there, so
  // reporting "suspended" would describe a drawing nobody sees.
  it("reads the support's kind even with a stale suspension height underneath", () => {
    render(
      <StandsOnField
        artwork={{ displayAs: "sculpture" }}
        floorObject={{
          ...floorArtwork,
          baseHeightMm: 1200,
          support: { kind: "plinth", widthMm: 900, depthMm: 900, heightMm: 150 }
        }}
        isMonitor={false}
        onChange={vi.fn()}
      />
    );

    expect(screen.getByRole("combobox", { name: "Stands on" })).toHaveTextContent("plinth");
  });

  it("reports the chosen state verbatim", () => {
    const onChange = vi.fn();
    render(
      <StandsOnField
        artwork={{ displayAs: "sculpture" }}
        floorObject={floorArtwork}
        isMonitor={false}
        onChange={onChange}
      />
    );

    fireEvent.click(screen.getByRole("option", { name: "Pedestal" }));

    expect(onChange).toHaveBeenCalledWith("pedestal");
  });
});
