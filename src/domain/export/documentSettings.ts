import { getRoomPlaceableWalls } from "../geometry/placeableWalls";
import type { DisplayUnit, Project, SavedView } from "../project";
import { isDegeneratePose } from "../savedViews";
import { unitSystemFromDisplayUnit } from "../units/unitSystem";

// The units a PDF dimension may print in. Millimetres are export-only (not part
// of the app's DisplayUnit), so this widens DisplayUnit with "mm".
export type DocumentExportUnit = DisplayUnit | "mm";

// A per-surface unit choice: an explicit unit, or "auto" (resolve from the
// project + surface). Persisted per project; missing = "auto".
export type DocumentExportUnitPreference = "auto" | DocumentExportUnit;

const EXPORT_UNITS: readonly DocumentExportUnit[] = [
  "ft",
  "in",
  "cm",
  "m",
  "mm"
];

function isExportUnit(value: unknown): value is DocumentExportUnit {
  return (
    typeof value === "string" &&
    EXPORT_UNITS.includes(value as DocumentExportUnit)
  );
}

function isUnitPreference(value: unknown): value is DocumentExportUnitPreference {
  return value === "auto" || isExportUnit(value);
}

// Single source of truth for "Auto" resolution, shared by the export pipeline
// and the dialog so the parenthetical hint ("Auto (in)") always matches what
// actually prints. Plan pages follow the project unit; elevation pages follow
// the app's in-app elevation view convention (imperial → in, metric → cm) so
// the exported elevation reads in the same unit the on-screen elevation does.
export function resolveDocumentExportUnit(
  preference: DocumentExportUnitPreference | undefined,
  projectUnit: DisplayUnit,
  surface: "plan" | "elevation"
): DocumentExportUnit {
  if (preference && preference !== "auto") return preference;
  if (surface === "plan") return projectUnit;
  return unitSystemFromDisplayUnit(projectUnit) === "imperial" ? "in" : "cm";
}

export type DocumentSectionId =
  | "overview"
  | "roomPlans"
  | "elevations"
  | "threeDViews";

export type DocumentPaperSize = "a4" | "letter" | "a3" | "tabloid";

// Workspace persistence stores explicit overrides rather than a materialized
// copy of every default. That distinction lets genuinely new rooms, walls, and
// Saved views receive §7.3 defaults while preserving choices the user made for
// ids that already existed.
export type DocumentExportPreferences = {
  sections: Partial<Record<DocumentSectionId, boolean>>;
  roomPlans: Record<string, boolean>;
  elevations: Record<string, boolean>;
  savedViews: Record<string, boolean>;
  dimensions?: boolean;
  grid?: boolean;
  paperSize?: DocumentPaperSize;
  // Display units for exported dimensions, chosen separately per surface.
  // Missing (legacy prefs) = "auto".
  planUnit?: DocumentExportUnitPreference;
  elevationUnit?: DocumentExportUnitPreference;
};

export type DocumentWallChoice = {
  wallId: string;
  name: string;
  hasWork: boolean;
  included: boolean;
};

export type DocumentRoomChoice = {
  roomId: string;
  name: string;
  planIncluded: boolean;
  walls: DocumentWallChoice[];
};

export type DocumentSavedViewChoice = {
  view: SavedView;
  included: boolean;
  valid: boolean;
};

export type EffectiveDocumentSettings = {
  sections: Record<DocumentSectionId, boolean>;
  rooms: DocumentRoomChoice[];
  savedViews: DocumentSavedViewChoice[];
  dimensions: boolean;
  grid: boolean;
  paperSize: DocumentPaperSize;
  // The user's per-surface preference (may be "auto")…
  planUnit: DocumentExportUnitPreference;
  elevationUnit: DocumentExportUnitPreference;
  // …and the concrete unit that preference resolves to for this project, so the
  // pipeline and dialog share one resolution.
  resolvedPlanUnit: DocumentExportUnit;
  resolvedElevationUnit: DocumentExportUnit;
};

export const EMPTY_DOCUMENT_EXPORT_PREFERENCES: DocumentExportPreferences = {
  sections: {},
  roomPlans: {},
  elevations: {},
  savedViews: {}
};

const PAPER_SIZES = new Set<DocumentPaperSize>([
  "a4",
  "letter",
  "a3",
  "tabloid"
]);

function isBooleanRecord(value: unknown): Record<string, boolean> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, boolean] =>
      typeof entry[1] === "boolean"
    )
  );
}

export function sanitizeDocumentExportPreferences(
  value: unknown
): DocumentExportPreferences {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return EMPTY_DOCUMENT_EXPORT_PREFERENCES;
  }

  const candidate = value as Record<string, unknown>;
  const sectionRecord = isBooleanRecord(candidate.sections);
  const sections: Partial<Record<DocumentSectionId, boolean>> = {};
  for (const sectionId of [
    "overview",
    "roomPlans",
    "elevations",
    "threeDViews"
  ] as const) {
    if (typeof sectionRecord[sectionId] === "boolean") {
      sections[sectionId] = sectionRecord[sectionId];
    }
  }

  return {
    sections,
    roomPlans: isBooleanRecord(candidate.roomPlans),
    elevations: isBooleanRecord(candidate.elevations),
    savedViews: isBooleanRecord(candidate.savedViews),
    ...(typeof candidate.dimensions === "boolean"
      ? { dimensions: candidate.dimensions }
      : {}),
    ...(typeof candidate.grid === "boolean" ? { grid: candidate.grid } : {}),
    ...(typeof candidate.paperSize === "string" &&
    PAPER_SIZES.has(candidate.paperSize as DocumentPaperSize)
      ? { paperSize: candidate.paperSize as DocumentPaperSize }
      : {}),
    ...(isUnitPreference(candidate.planUnit)
      ? { planUnit: candidate.planUnit }
      : {}),
    ...(isUnitPreference(candidate.elevationUnit)
      ? { elevationUnit: candidate.elevationUnit }
      : {})
  };
}

export function defaultDocumentPaperSize(locale?: string): DocumentPaperSize {
  const region = locale?.match(/[-_]([A-Z]{2})\b/i)?.[1]?.toUpperCase();
  return region === "US" || region === "CA" ? "letter" : "a4";
}

function explicitOrDefault(
  record: Record<string, boolean>,
  id: string,
  fallback: boolean
): boolean {
  return Object.prototype.hasOwnProperty.call(record, id) ? record[id]! : fallback;
}

function sectionOrDefault(
  preferences: DocumentExportPreferences,
  id: DocumentSectionId,
  fallback: boolean
): boolean {
  return Object.prototype.hasOwnProperty.call(preferences.sections, id)
    ? preferences.sections[id]!
    : fallback;
}

export function reconcileDocumentExportPreferences(
  project: Project,
  stored: DocumentExportPreferences | undefined,
  locale?: string
): {
  preferences: DocumentExportPreferences;
  settings: EffectiveDocumentSettings;
} {
  const source = sanitizeDocumentExportPreferences(stored);
  const roomCount = project.floor.rooms.length;
  const currentRoomIds = new Set(project.floor.rooms.map((placement) => placement.roomId));
  const currentWallIds = new Set(
    project.floor.rooms.flatMap((placement) =>
      getRoomPlaceableWalls(placement.room).map((wall) => wall.id)
    )
  );
  const currentSavedViewIds = new Set((project.savedViews ?? []).map((view) => view.id));

  const roomPlans = Object.fromEntries(
    Object.entries(source.roomPlans).filter(([id]) => currentRoomIds.has(id))
  );
  const elevations = Object.fromEntries(
    Object.entries(source.elevations).filter(([id]) => currentWallIds.has(id))
  );
  const savedViews = Object.fromEntries(
    Object.entries(source.savedViews).filter(([id]) => currentSavedViewIds.has(id))
  );

  const rooms: DocumentRoomChoice[] = project.floor.rooms.map((placement) => {
    const walls = getRoomPlaceableWalls(placement.room).map((wall) => {
      const hasWork = project.wallObjects.some(
        (object) => object.kind === "artwork" && object.wallId === wall.id
      );
      return {
        wallId: wall.id,
        name: wall.name,
        hasWork,
        included: explicitOrDefault(source.elevations, wall.id, hasWork)
      };
    });

    return {
      roomId: placement.roomId,
      name: placement.room.name,
      planIncluded: explicitOrDefault(
        source.roomPlans,
        placement.roomId,
        roomCount > 1
      ),
      walls
    };
  });

  const savedViewChoices = (project.savedViews ?? [])
    .slice()
    .sort((a, b) => a.ordinal - b.ordinal)
    .map((view) => {
      const valid = !isDegeneratePose(view.pose);
      return {
        view,
        valid,
        included:
          valid && explicitOrDefault(source.savedViews, view.id, true)
      };
    });

  // Room plans, Elevations, and 3D views no longer carry an independent
  // "section enabled" flag: whether the section is on is *derived* from its
  // children (§ any child selected => section on). This avoids the classic
  // parent/child desync trap where a user unchecks the section, then checks
  // a child, and the export silently drops that child because the stale
  // section flag still reads false. Legacy stored `sections` entries for
  // these three ids are preserved verbatim in `preferences` for backward
  // compatibility (harmless, simply unused going forward) but are not read
  // here. "Overview" has no children, so it keeps its own explicit flag.
  const roomPlanValues = rooms.map((room) => room.planIncluded);
  const elevationValues = rooms.flatMap((room) =>
    room.walls.map((wall) => wall.included)
  );
  const validSavedViewValues = savedViewChoices
    .filter((choice) => choice.valid)
    .map((choice) => choice.included);

  const preferences: DocumentExportPreferences = {
    sections: source.sections,
    roomPlans,
    elevations,
    savedViews,
    ...(source.dimensions !== undefined
      ? { dimensions: source.dimensions }
      : {}),
    ...(source.grid !== undefined ? { grid: source.grid } : {}),
    ...(source.paperSize !== undefined ? { paperSize: source.paperSize } : {}),
    ...(source.planUnit !== undefined ? { planUnit: source.planUnit } : {}),
    ...(source.elevationUnit !== undefined
      ? { elevationUnit: source.elevationUnit }
      : {})
  };

  const planUnit = source.planUnit ?? "auto";
  const elevationUnit = source.elevationUnit ?? "auto";

  return {
    preferences,
    settings: {
      sections: {
        overview: sectionOrDefault(source, "overview", true),
        roomPlans: selectionState(roomPlanValues) !== false,
        elevations: selectionState(elevationValues) !== false,
        threeDViews: selectionState(validSavedViewValues) !== false
      },
      rooms,
      savedViews: savedViewChoices,
      dimensions: source.dimensions ?? true,
      grid: source.grid ?? false,
      paperSize: source.paperSize ?? defaultDocumentPaperSize(locale),
      planUnit,
      elevationUnit,
      resolvedPlanUnit: resolveDocumentExportUnit(
        planUnit,
        project.unit,
        "plan"
      ),
      resolvedElevationUnit: resolveDocumentExportUnit(
        elevationUnit,
        project.unit,
        "elevation"
      )
    }
  };
}

export function countDocumentPages(settings: EffectiveDocumentSettings): number {
  let count = settings.sections.overview ? 1 : 0;
  if (settings.sections.roomPlans) {
    count += settings.rooms.filter((room) => room.planIncluded).length;
  }
  if (settings.sections.elevations) {
    count += settings.rooms.reduce(
      (sum, room) => sum + room.walls.filter((wall) => wall.included).length,
      0
    );
  }
  if (settings.sections.threeDViews) {
    count += settings.savedViews.filter(
      (savedView) => savedView.valid && savedView.included
    ).length;
  }
  return count;
}

export function selectionState(
  values: readonly boolean[]
): boolean | "indeterminate" {
  if (values.length === 0) return false;
  const selected = values.filter(Boolean).length;
  if (selected === 0) return false;
  if (selected === values.length) return true;
  return "indeterminate";
}
