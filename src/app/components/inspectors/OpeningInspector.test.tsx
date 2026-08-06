import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  sharedOpeningResolutions,
  type SharedOpeningStatus
} from "../../../domain/geometry/sharedOpeningStatus";
import type { OpeningFit } from "../../../domain/placement/fitOpeningOnWall";
import type {
  SharedOpeningConflictReason,
  SharedOpeningTarget
} from "../../../domain/placement/sharedOpeningAnalysis";
import type { OpeningWallObject } from "../../../domain/project";
import { OpeningInspector, type OpeningSharedSection } from "./OpeningInspector";

// Radix Select drives itself through Pointer Events and a portal, neither of
// which jsdom implements usefully. Same lightweight stand-in ExportPdfDialog's
// suite uses: the trigger keeps its combobox role and aria-label, and every
// item is a clickable option that reports its own value.
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
    SelectValue: ({ placeholder }: { placeholder?: string }) => {
      const context = useContext(Context);
      return <span>{context.value === undefined || context.value === "" ? placeholder : context.value}</span>;
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

const door: OpeningWallObject = {
  id: "door-a",
  kind: "door",
  blocksPlacement: true,
  wallId: "wall-a",
  xMm: 1000,
  yMm: 1000,
  widthMm: 900,
  heightMm: 2000
};

const window_: OpeningWallObject = {
  ...door,
  id: "window-a",
  kind: "window",
  yMm: 1450,
  heightMm: 1200
};

function props(
  opening: OpeningWallObject = door,
  sharedOpening: OpeningSharedSection | null = null
) {
  return {
    opening,
    unit: "m" as const,
    wallLengthMm: 6000,
    sharedOpening,
    onCommitPosition: vi.fn().mockResolvedValue(null),
    onCommitSize: vi.fn().mockResolvedValue(null),
    onFitToWall: vi.fn().mockResolvedValue(null),
    onDelete: vi.fn()
  };
}

function conflictStatus(
  reason: SharedOpeningConflictReason,
  candidates: SharedOpeningTarget[] = []
): SharedOpeningStatus {
  return {
    kind: "conflict",
    conflict: {
      id: `door-a:${reason}`,
      reason,
      openingId: "door-a",
      wallIds: ["wall-a", "wall-b"]
    },
    partnerId: null,
    candidates
  };
}

// `resolutions` defaults to what the domain's own exhaustiveness-guarded table
// says for this status, so these tests exercise the wiring App.tsx will supply
// rather than a hand-written guess at it. Overridable, so one test can prove
// the controls follow `resolutions` and not the conflict reason.
function sharedSection(
  status: SharedOpeningStatus,
  overrides: Partial<OpeningSharedSection> = {}
): OpeningSharedSection {
  return {
    status,
    resolutions: sharedOpeningResolutions(status),
    message: "Something needs attention here.",
    candidates: [],
    onResolve: vi.fn(),
    onComplete: vi.fn(),
    onRealign: vi.fn(),
    onSplit: vi.fn(),
    onKeepThisOnly: vi.fn(),
    ...overrides
  };
}

const RESOLUTION_BUTTONS = [
  "Realign",
  "Complete shared opening",
  "Keep both as separate doors",
  "Keep both as separate windows",
  "Keep this door only",
  "Keep this window only"
];

function resolutionButtonNames(): string[] {
  return screen
    .getAllByRole("button")
    .map((button) => button.textContent ?? "")
    .filter((text) => RESOLUTION_BUTTONS.includes(text));
}

describe("OpeningInspector shared opening section", () => {
  describe("exposed", () => {
    // The whole point of the state: an opening with no facing wall is not a
    // problem and gets no chrome. The old "Connects to" row, the Disconnect
    // button and the "No door on a facing wall to pair with." hint were all
    // mechanism talk about a choice the user does not have.
    it("renders no connection UI at all", () => {
      const { container } = render(
        <OpeningInspector
          {...props(door, sharedSection({ kind: "exposed" }, { message: null }))}
        />
      );

      expect(container.querySelector(".opening-connection-section")).toBeNull();
      expect(screen.queryByText("Connects to")).toBeNull();
      expect(screen.queryByRole("button", { name: "Disconnect" })).toBeNull();
      expect(screen.queryByText(/No door on a facing wall/)).toBeNull();
      expect(screen.queryByRole("combobox")).toBeNull();
      expect(screen.queryByRole("status")).toBeNull();
      expect(resolutionButtonNames()).toEqual([]);
    });

    // Even a message and a full set of handlers cannot make `exposed` render:
    // the state decides, not what App happens to pass alongside it.
    it("stays silent even when a message is supplied", () => {
      const { container } = render(
        <OpeningInspector
          {...props(
            door,
            sharedSection({ kind: "exposed" }, { message: "Connects Gallery 1 ↔ Gallery 2" })
          )}
        />
      );

      expect(container.querySelector(".opening-connection-section")).toBeNull();
      expect(screen.queryByText("Connects Gallery 1 ↔ Gallery 2")).toBeNull();
    });

    // A blocked zone never pairs, so App passes null rather than a status.
    it("renders nothing when there is no shared section at all", () => {
      const blockedZone: OpeningWallObject = {
        ...door,
        id: "zone-a",
        kind: "blocked-zone",
        yMm: 1450
      };
      const { container } = render(<OpeningInspector {...props(blockedZone, null)} />);

      expect(container.querySelector(".opening-connection-section")).toBeNull();
      expect(screen.queryByRole("combobox")).toBeNull();
    });
  });

  describe("shared", () => {
    const line = "Connects Gallery 1 ↔ Gallery 2";

    it("states the pairing once, quietly", () => {
      const { container } = render(
        <OpeningInspector
          {...props(
            { ...door, connectsToObjectId: "door-b" },
            sharedSection({ kind: "shared", partnerId: "door-b" }, { message: line })
          )}
        />
      );

      // role="status" sits on the inner span, so the live-region readout is
      // exactly the sentence with no trailing control text in it.
      expect(screen.getByRole("status").textContent).toBe(line);
      expect(container.querySelector(".opening-connection-status")).not.toBeNull();
      expect(container.querySelector(".inspector-notice.caution")).toBeNull();
    });

    it("offers no dropdown, no Disconnect and no resolution", () => {
      render(
        <OpeningInspector
          {...props(
            { ...door, connectsToObjectId: "door-b" },
            sharedSection({ kind: "shared", partnerId: "door-b" }, { message: line })
          )}
        />
      );

      expect(screen.queryByRole("combobox")).toBeNull();
      expect(screen.queryByRole("button", { name: "Disconnect" })).toBeNull();
      expect(screen.queryByText("Connects to")).toBeNull();
      expect(resolutionButtonNames()).toEqual([]);
    });
  });

  describe("drifted", () => {
    const message =
      "This door sits at a different point on the wall in Gallery 1 than in Gallery 2, so its two sides no longer line up.";

    it("cautions and offers Realign only — Split is refused here by design", () => {
      const section = sharedSection({ kind: "drifted", partnerId: "door-b" }, { message });
      const { container } = render(<OpeningInspector {...props(door, section)} />);

      expect(container.querySelector(".inspector-notice.caution")).not.toBeNull();
      expect(screen.getByRole("status").textContent).toBe(message);
      expect(resolutionButtonNames()).toEqual(["Realign"]);
      expect(screen.queryByRole("combobox")).toBeNull();

      fireEvent.click(screen.getByRole("button", { name: "Realign" }));
      expect(section.onRealign).toHaveBeenCalledTimes(1);
    });
  });

  describe("boundary-lost", () => {
    const message =
      "Gallery 1 and Gallery 2 no longer share a wall here, so this door no longer opens between them.";

    it("offers both ways out, and each calls its own action once", () => {
      const section = sharedSection(conflictStatus("boundary-lost"), { message });
      render(<OpeningInspector {...props(door, section)} />);

      expect(screen.getByRole("status").textContent).toBe(message);
      expect(resolutionButtonNames()).toEqual([
        "Keep both as separate doors",
        "Keep this door only"
      ]);
      expect(screen.queryByRole("combobox")).toBeNull();

      fireEvent.click(screen.getByRole("button", { name: "Keep both as separate doors" }));
      fireEvent.click(screen.getByRole("button", { name: "Keep this door only" }));

      expect(section.onSplit).toHaveBeenCalledTimes(1);
      expect(section.onKeepThisOnly).toHaveBeenCalledTimes(1);
      expect(section.onRealign).not.toHaveBeenCalled();
      expect(section.onComplete).not.toHaveBeenCalled();
    });

    it("names the kind it is talking about, so a window never reads as a door", () => {
      const section = sharedSection(conflictStatus("boundary-lost"), { message });
      render(<OpeningInspector {...props(window_, section)} />);

      expect(resolutionButtonNames()).toEqual([
        "Keep both as separate windows",
        "Keep this window only"
      ]);
    });
  });

  describe("missing-twin", () => {
    const message = "This door appears on the Gallery 1 side of the wall but not on the Gallery 2 side.";

    it("offers the one fixed repair", () => {
      const section = sharedSection(conflictStatus("missing-twin"), { message });
      render(<OpeningInspector {...props(door, section)} />);

      expect(screen.getByRole("status").textContent).toBe(message);
      expect(resolutionButtonNames()).toEqual(["Complete shared opening"]);
      expect(screen.queryByRole("combobox")).toBeNull();

      fireEvent.click(screen.getByRole("button", { name: "Complete shared opening" }));
      expect(section.onComplete).toHaveBeenCalledTimes(1);
    });
  });

  describe("paired-geometry-mismatch", () => {
    it("offers Realign, because only the user's selection can say which half is right", () => {
      const section = sharedSection(conflictStatus("paired-geometry-mismatch"), {
        message: "This door is a different size on each side of the wall."
      });
      render(<OpeningInspector {...props(door, section)} />);

      expect(resolutionButtonNames()).toEqual(["Realign"]);

      fireEvent.click(screen.getByRole("button", { name: "Realign" }));
      expect(section.onRealign).toHaveBeenCalledTimes(1);
    });
  });

  describe("ambiguous", () => {
    const targets: SharedOpeningTarget[] = [
      { kind: "opening", openingId: "door-b" },
      { kind: "wall", wallId: "wall-c" }
    ];
    const candidates = [
      { key: "opening:door-b", label: "Door on West wall in Gallery 2", target: targets[0] },
      { key: "wall:wall-c", label: "Add the other side on West wall in Gallery 3", target: targets[1] }
    ];
    const message =
      "Gallery 2 and Gallery 3 both sit behind East wall here, so it isn't clear which one this door opens into.";

    const reasons: SharedOpeningConflictReason[] = [
      "ambiguous-boundary-wall",
      "ambiguous-counterpart-opening"
    ];

    it.each(reasons)("captions a scoped picker for %s", (reason) => {
      const section = sharedSection(conflictStatus(reason, targets), { message, candidates });
      render(<OpeningInspector {...props(door, section)} />);

      expect(screen.getByRole("status").textContent).toBe(message);
      expect(screen.getByRole("combobox", { name: "Resolve shared opening" })).toBeTruthy();
      expect(screen.getByText("Resolve shared opening", { selector: "label, label *" })).toBeTruthy();
      expect(screen.getByRole("option", { name: "Door on West wall in Gallery 2" })).toBeTruthy();
      expect(
        screen.getByRole("option", { name: "Add the other side on West wall in Gallery 3" })
      ).toBeTruthy();
      // A pick is not a verb: the picker replaces buttons, it does not join them.
      expect(resolutionButtonNames()).toEqual([]);
    });

    // The option value is a key, never an encoded target. Choosing one must hand
    // the store the SharedOpeningTarget object itself.
    it("resolves with the target object, not the option key", () => {
      const section = sharedSection(conflictStatus("ambiguous-boundary-wall", targets), {
        message,
        candidates
      });
      render(<OpeningInspector {...props(door, section)} />);

      fireEvent.click(
        screen.getByRole("option", { name: "Add the other side on West wall in Gallery 3" })
      );

      expect(section.onResolve).toHaveBeenCalledTimes(1);
      const [argument] = (section.onResolve as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(argument).toBe(targets[1]);
      expect(argument).toEqual({ kind: "wall", wallId: "wall-c" });
      expect(typeof argument).not.toBe("string");
    });

    it("picks the target the chosen row carries, not the first one", () => {
      const section = sharedSection(conflictStatus("ambiguous-counterpart-opening", targets), {
        message,
        candidates
      });
      render(<OpeningInspector {...props(door, section)} />);

      fireEvent.click(screen.getByRole("option", { name: "Door on West wall in Gallery 2" }));

      expect(section.onResolve).toHaveBeenCalledTimes(1);
      expect(section.onResolve).toHaveBeenCalledWith({ kind: "opening", openingId: "door-b" });
    });

    // The picker has nothing to offer if the candidate list is empty; an empty
    // dropdown is worse than none.
    it("hides the picker when there is nothing to choose between", () => {
      const section = sharedSection(conflictStatus("ambiguous-boundary-wall"), { message });
      render(<OpeningInspector {...props(door, section)} />);

      expect(screen.queryByRole("combobox")).toBeNull();
      expect(screen.getByRole("status").textContent).toBe(message);
    });
  });

  describe("conflicts with nothing to offer", () => {
    const noActionReasons: SharedOpeningConflictReason[] = [
      "overhangs-common-span",
      "paired-overhang",
      "blocked-mirror-slot",
      "counterpart-occupied"
    ];

    it.each(noActionReasons)("explains %s and offers no control", (reason) => {
      const message = "The wall is shared, but this door does not sit where the two rooms meet.";
      const section = sharedSection(conflictStatus(reason), { message });
      const { container } = render(<OpeningInspector {...props(door, section)} />);

      expect(container.querySelector(".inspector-notice.caution")).not.toBeNull();
      expect(screen.getByRole("status").textContent).toBe(message);
      expect(screen.queryByRole("combobox")).toBeNull();
      expect(resolutionButtonNames()).toEqual([]);
    });
  });

  // `sharedOpeningResolutions` is the single, exhaustiveness-guarded source of
  // which controls a state admits. If this component re-derived them from the
  // conflict reason it would be a second copy of that table, free to drift.
  it("takes the controls from `resolutions`, not from the conflict reason", () => {
    const section = sharedSection(conflictStatus("boundary-lost"), {
      message: "Something changed here.",
      resolutions: ["realign"]
    });
    render(<OpeningInspector {...props(door, section)} />);

    expect(resolutionButtonNames()).toEqual(["Realign"]);
    expect(screen.queryByRole("button", { name: "Keep both as separate doors" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Keep this door only" })).toBeNull();
  });
});

describe("OpeningInspector width fitting", () => {
  const widthField = () => screen.getByRole("textbox", { name: /Width/ });

  // A door on a 4 m wall, asked for 6 m and trimmed to fit. Metric opening
  // sizes display in cm (getScopeUnits), so notes read "400 cm".
  const clampedToWall: OpeningFit = {
    requestedWidthMm: 6000,
    widthMm: 4000,
    xMm: 2000,
    widthClamped: true,
    positionAdjusted: true,
    movedByMm: 1000,
    constraint: "wall"
  };

  const slidToFit: OpeningFit = {
    requestedWidthMm: 3000,
    widthMm: 3000,
    xMm: 1500,
    widthClamped: false,
    positionAdjusted: true,
    movedByMm: 500,
    constraint: "wall"
  };

  async function commitWidth(text: string) {
    const field = widthField();
    fireEvent.change(field, { target: { value: text } });
    fireEvent.blur(field);
  }

  it("explains a width that was trimmed to the wall", async () => {
    const onCommitSize = vi.fn().mockResolvedValue(clampedToWall);
    render(<OpeningInspector {...props()} onCommitSize={onCommitSize} />);

    await commitWidth("6 m");

    expect(onCommitSize).toHaveBeenCalledWith(6000, door.heightMm);
    expect(
      await screen.findByText("Limited to 400 cm, the maximum width for this wall.")
    ).toBeTruthy();
  });

  it("explains a width that was kept but slid along the wall", async () => {
    const onCommitSize = vi.fn().mockResolvedValue(slidToFit);
    render(<OpeningInspector {...props()} onCommitSize={onCommitSize} />);

    await commitWidth("3 m");

    expect(await screen.findByText("Moved 50 cm to fit the wall.")).toBeTruthy();
  });

  it("names the facing wall when a paired opening is the binding constraint", async () => {
    const onCommitSize = vi
      .fn()
      .mockResolvedValue({ ...clampedToWall, constraint: "paired-wall" });
    render(<OpeningInspector {...props()} onCommitSize={onCommitSize} />);

    await commitWidth("6 m");

    expect(await screen.findByText("Limited to 400 cm by the facing wall.")).toBeTruthy();
  });

  it("stays silent when the committed width is exactly what was asked for", async () => {
    const onCommitSize = vi.fn().mockResolvedValue({
      ...slidToFit,
      positionAdjusted: false,
      movedByMm: 0,
      constraint: "none"
    });
    render(<OpeningInspector {...props()} onCommitSize={onCommitSize} />);

    await commitWidth("3 m");
    await screen.findByDisplayValue("300 cm");

    expect(screen.queryByText(/to fit the wall/)).toBeNull();
    expect(screen.queryByText(/^Limited to/)).toBeNull();
  });

  // The note must survive the value resync that fires when the corrected value
  // arrives from the store, and clear only when the next edit begins.
  it("keeps the note through a corrected-value rerender and clears it on the next edit", async () => {
    const onCommitSize = vi.fn().mockResolvedValue(clampedToWall);
    const rendered = render(
      <OpeningInspector {...props()} onCommitSize={onCommitSize} />
    );

    await commitWidth("6 m");
    await screen.findByText("Limited to 400 cm, the maximum width for this wall.");

    // The store now reports the trimmed width back down.
    rendered.rerender(
      <OpeningInspector
        {...props({ ...door, widthMm: 4000, xMm: 2000 })}
        onCommitSize={onCommitSize}
      />
    );
    expect(
      screen.getByText("Limited to 400 cm, the maximum width for this wall.")
    ).toBeTruthy();

    fireEvent.change(widthField(), { target: { value: "2 m" } });
    expect(screen.queryByText(/^Limited to/)).toBeNull();
  });

  it("fills the available span from the Fit wall action and reports the result", async () => {
    const onFitToWall = vi.fn().mockResolvedValue({
      ...clampedToWall,
      constraint: "neighbor"
    });
    render(<OpeningInspector {...props()} onFitToWall={onFitToWall} />);

    fireEvent.click(screen.getByRole("button", { name: "Fit wall" }));

    expect(onFitToWall).toHaveBeenCalled();
    expect(
      await screen.findByText("Limited to 400 cm by the opening beside it.")
    ).toBeTruthy();
  });
});
