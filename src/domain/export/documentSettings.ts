import { getRoomPlaceableWalls } from "../geometry/placeableWalls";
import type { Project, SavedView } from "../project";
import { isDegeneratePose } from "../savedViews";

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

  const hasIncludedElevation = rooms.some((room) =>
    room.walls.some((wall) => wall.included)
  );
  const hasSavedViews = savedViewChoices.length > 0;

  const preferences: DocumentExportPreferences = {
    sections: source.sections,
    roomPlans,
    elevations,
    savedViews,
    ...(source.dimensions !== undefined
      ? { dimensions: source.dimensions }
      : {}),
    ...(source.grid !== undefined ? { grid: source.grid } : {}),
    ...(source.paperSize !== undefined ? { paperSize: source.paperSize } : {})
  };

  return {
    preferences,
    settings: {
      sections: {
        overview: sectionOrDefault(source, "overview", true),
        roomPlans: sectionOrDefault(source, "roomPlans", roomCount > 1),
        elevations: sectionOrDefault(
          source,
          "elevations",
          hasIncludedElevation
        ),
        threeDViews: sectionOrDefault(source, "threeDViews", hasSavedViews)
      },
      rooms,
      savedViews: savedViewChoices,
      dimensions: source.dimensions ?? true,
      grid: source.grid ?? false,
      paperSize: source.paperSize ?? defaultDocumentPaperSize(locale)
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
