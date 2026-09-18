import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance
} from "vitest";

// The App shell smoke test.
//
// Every other unit test in this suite renders a leaf or a panel, so nothing
// exercised App itself — which is how a hook placed below App's `if (!project)`
// early return once shipped a "Rendered more hooks than during the previous
// render" crash that 3,650 green tests never saw. This file mounts the REAL App
// against in-memory repositories, lets its own boot() seed the sample project,
// and walks the dialog open/close paths, so the hook order and the shell's
// wiring are covered by the unit suite rather than by loading a browser.
//
// Mocks are kept to the minimum: each one is a hole in that safety net.

// The one structural substitution. src/app/store.ts exports `useAppStore` as a
// module-level singleton built on IndexedDB repositories and the Dropbox
// provider; App, SettingsDialog and the canvases all import it directly, so the
// only way to give App a working repository in jsdom is to replace the
// singleton itself. Everything else the module exports (selectors, types) stays
// real via importOriginal.
//
// Built inline from inMemoryRepositories rather than through
// src/test/testAppStore.ts, whose own import of "../app/store" would re-enter
// this mock factory.
vi.mock("./store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./store")>();
  const { createInertCrossTabSync } = await import("./crossTabSync");
  const {
    FakeImageProcessor,
    InMemoryArtworkLibraryRepository,
    InMemoryAssetRepository,
    InMemoryProjectRepository,
    InMemoryProjectSnapshotRepository,
    InMemorySyncMetaRepository
  } = await import("../test/inMemoryRepositories");

  const useAppStore = actual.createAppStore({
    projectRepository: new InMemoryProjectRepository(),
    artworkLibraryRepository: new InMemoryArtworkLibraryRepository(),
    assetRepository: new InMemoryAssetRepository(),
    imageProcessor: new FakeImageProcessor(),
    projectSnapshotRepository: new InMemoryProjectSnapshotRepository(),
    syncMetaRepository: new InMemorySyncMetaRepository(),
    // A vitest process is ONE browsing context; a real BroadcastChannel here
    // would let stores hear each other. cloudBackupProvider is left undefined,
    // which leaves the whole cloud feature inert.
    crossTabSync: createInertCrossTabSync()
  });

  return { ...actual, useAppStore };
});

// Radix's Dialog/Toggle stack and App's own compact-workspace media query both
// call matchMedia, which jsdom does not implement. Report "no match" so the
// desktop two-pane layout is what renders.
function stubMatchMedia() {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false
  })) as unknown as typeof window.matchMedia;
}

// jsdom implements no SVG geometry. PlanView's pointer paths reach for these;
// getScreenCTM returning null makes toSvgPoint resolve to null, which the
// canvas already treats as "no usable point" instead of throwing.
function stubSvgGeometry() {
  (SVGSVGElement.prototype as unknown as { createSVGPoint: () => unknown }).createSVGPoint =
    () => ({ x: 0, y: 0, matrixTransform: () => ({ x: 0, y: 0 }) });
  (SVGSVGElement.prototype as unknown as { getScreenCTM: () => unknown }).getScreenCTM =
    () => null;
}

// useStoragePersistence asks the Storage Manager whether the origin is durable.
// jsdom has no navigator.storage at all; answer "not persisted, cannot ask" so
// the hook settles instead of throwing.
function stubStorageManager() {
  if (navigator.storage) return;
  Object.defineProperty(navigator, "storage", {
    configurable: true,
    value: {
      persisted: async () => false,
      persist: async () => false,
      estimate: async () => ({ quota: 0, usage: 0 })
    }
  });
}

let consoleErrorSpy: MockInstance<typeof console.error>;

beforeAll(() => {
  stubMatchMedia();
  stubSvgGeometry();
  stubStorageManager();
});

beforeEach(async () => {
  // The mocked store is one singleton for the file, so after the first test it
  // already holds a document — and App would then never render its
  // `if (!project)` shell. Put the project back to null so EVERY case here
  // renders the loading shell and then the booted document: that null →
  // document transition is precisely what changes the hook count when a hook
  // slips below the early return.
  const { useAppStore } = await import("./store");
  useAppStore.setState({ project: null });

  // Fail on ANY console.error rather than allowlisting patterns: React reports
  // the hook-order crash this file exists to catch through console.error, and a
  // narrow allowlist is exactly how such a report gets filtered away.
  consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  consoleErrorSpy.mockRestore();
});

afterAll(() => {
  vi.unstubAllGlobals();
});

function expectNoReactErrors() {
  const messages = consoleErrorSpy.mock.calls.map((call) => String(call[0]));
  expect(messages).toEqual([]);
}

// Renders App and waits for its own boot() to seed and open the sample project.
// Deliberately NOT seeded by hand: booting for real is what proves the shell
// survives the null-project render and the transition into a document.
async function renderApp() {
  const { App } = await import("./App");
  const utils = render(<App />);
  // "Untitled Exhibition" is createSampleProject()'s title; the top bar's
  // project field is the first thing that can only exist post-boot.
  const title = await screen.findByRole("textbox", { name: "Project title" });
  await waitFor(() => expect(title).toHaveValue("Untitled Exhibition"));
  return utils;
}

describe("App shell", () => {
  it("boots and mounts the rail, top bar and plan surface", async () => {
    const { container } = await renderApp();

    // Top bar: the booted project's title.
    expect(screen.getByRole("textbox", { name: "Project title" })).toHaveValue(
      "Untitled Exhibition"
    );

    // Rail: the workspace nav with its Settings/Help affordances.
    const rail = screen.getByRole("navigation", { name: "Workspace" });
    expect(within(rail).getByRole("button", { name: "Help" })).toBeInTheDocument();
    expect(within(rail).getByRole("button", { name: "Settings" })).toBeInTheDocument();

    // Workspace: plan is the default mode, so the plan canvas is mounted (and
    // three.js is not).
    expect(container.querySelector("svg.plan-svg")).not.toBeNull();

    // The sample project's geometry reached the canvas, not just the store:
    // createSampleProject's one room has four walls, and PlanStructureLayer
    // draws one `.wall-line` per wall.
    expect(container.querySelectorAll("svg.plan-svg .wall-line")).toHaveLength(4);

    expectNoReactErrors();
  });

  it("opens the Help dialog from the rail and closes it on Escape", async () => {
    await renderApp();

    fireEvent.click(screen.getByRole("button", { name: "Help" }));
    const dialog = await screen.findByRole("dialog", { name: "Help" });

    fireEvent.keyDown(dialog, { key: "Escape" });
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Help" })).not.toBeInTheDocument()
    );

    expectNoReactErrors();
  });

  it("mounts the lazily loaded Settings dialog from the rail", async () => {
    await renderApp();

    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    // Lazy chunk: findBy* covers the Suspense boundary resolving.
    expect(await screen.findByRole("dialog", { name: "Settings" })).toBeInTheDocument();

    expectNoReactErrors();
  });

  // The one gesture that changes two registry entries at once: Settings closes
  // itself as it opens Help. A single `activeDialog` would make this a race;
  // the record makes it two independent writes in one handler.
  it("hands off from Settings to Help in one gesture", async () => {
    await renderApp();

    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    const settings = await screen.findByRole("dialog", { name: "Settings" });

    fireEvent.click(within(settings).getByRole("button", { name: /help/i }));

    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Settings" })).not.toBeInTheDocument()
    );
    expect(await screen.findByRole("dialog", { name: "Help" })).toBeInTheDocument();

    expectNoReactErrors();
  });

  it("suspends toolbar letter shortcuts while a dialog owns the keyboard", async () => {
    await renderApp();

    // Held as a node, not re-queried: an open Radix dialog marks the whole app
    // shell aria-hidden, which takes the button out of role queries while
    // leaving it mounted.
    const grid = screen.getByRole("button", { name: "Grid" });
    const pressedBefore = grid.getAttribute("aria-pressed");

    // G toggles the grid on a plain workspace...
    fireEvent.keyDown(window, { key: "g" });
    await waitFor(() => expect(grid.getAttribute("aria-pressed")).not.toBe(pressedBefore));
    const pressedAfterToggle = grid.getAttribute("aria-pressed");

    // ...and stands down once a dialog is open.
    fireEvent.click(screen.getByRole("button", { name: "Help" }));
    await screen.findByRole("dialog", { name: "Help" });
    fireEvent.keyDown(window, { key: "g" });

    expect(grid.getAttribute("aria-pressed")).toBe(pressedAfterToggle);

    expectNoReactErrors();
  });

  // InspectorPane has no test file of its own, so the shelf branch of its
  // selection switch is proved here: a selected shelf must reach ShelfInspector,
  // not fall through to the generic opening inspector.
  it("renders the shelf inspector when a shelf is selected", async () => {
    await renderApp();

    const { useAppStore } = await import("./store");
    const { getProjectWalls } = await import("./projectWalls");
    const wallId = getProjectWalls(useAppStore.getState().project!)[0]!.id;

    // Driven through the store rather than the toolbar: this case is about the
    // inspector branch, and act() keeps the two store writes inside one render
    // pass so the shell settles before the assertions.
    await act(async () => {
      await useAppStore.getState().addOpening(wallId, "shelf");
      const shelf = useAppStore
        .getState()
        .project!.wallObjects.find((object) => object.kind === "shelf")!;
      useAppStore.getState().setObjectSelection([shelf.id]);
    });

    // "Top height" and "Delete shelf" exist only in ShelfInspector; the wall
    // case beside it has "Height" and "Delete case".
    expect(await screen.findByLabelText("Top height")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete shelf" })).toBeInTheDocument();
    expect(screen.getByLabelText("Thickness")).toBeInTheDocument();

    expectNoReactErrors();
  });

  // The wall-work inspector's Support row: what a work rests on, and the way
  // back to it. Also not covered by its own test file — same reason as above.
  it("shows the Support row on a wall work and reaches its shelf from either end", async () => {
    await renderApp();

    const { useAppStore } = await import("./store");
    const { getProjectWalls } = await import("./projectWalls");
    const { CURRENT_SCHEMA_VERSION } = await import("../domain/project");
    const wallId = getProjectWalls(useAppStore.getState().project!)[0]!.id;

    await act(async () => {
      useAppStore.setState({
        libraryArtworks: [
          {
            id: "support-row-artwork",
            schemaVersion: CURRENT_SCHEMA_VERSION,
            title: "Test work",
            dimensions: { widthMm: 600, heightMm: 800, status: "known" },
            metadata: {}
          }
        ],
        project: {
          ...useAppStore.getState().project!,
          wallObjects: [
            {
              id: "support-row-placement",
              wallId,
              kind: "artwork",
              artworkId: "support-row-artwork",
              xMm: 1500,
              yMm: 1500,
              widthMm: 600,
              heightMm: 800
            }
          ]
        }
      });
      useAppStore.getState().setObjectSelection(["support-row-placement"]);
    });

    expect(await screen.findByText("Support")).toBeInTheDocument();
    expect(screen.getByText("Hung on the wall")).toBeInTheDocument();

    await act(async () => {
      await useAppStore.getState().addShelfUnderWallArtwork("support-row-placement");
      // addShelfUnderWallArtwork selects the work AND its new shelf; the
      // Support row only renders for a single-artwork selection.
      useAppStore.getState().setObjectSelection(["support-row-placement"]);
    });

    expect(await screen.findByText("Shelf")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Select shelf" }));

    const shelfId = useAppStore
      .getState()
      .project!.wallObjects.find((object) => object.kind === "shelf")!.id;
    expect(useAppStore.getState().selection).toEqual({ kind: "objects", ids: [shelfId] });

    expectNoReactErrors();
  });
});
