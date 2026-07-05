import { z } from "zod";
import { CURRENT_SCHEMA_VERSION, type Project } from "../project";

const displayUnitSchema = z.enum(["in", "ft", "cm", "m"]);

export const dimensionsSchema = z.object({
  widthMm: z.number().positive().optional(),
  heightMm: z.number().positive().optional(),
  depthMm: z.number().positive().optional(),
  status: z.enum(["known", "approximate", "unknown"]),
  displayUnit: displayUnitSchema.optional()
});

const wallObjectBaseSchema = z.object({
  id: z.string().min(1),
  wallId: z.string().min(1),
  xMm: z.number().finite(),
  yMm: z.number().finite(),
  widthMm: z.number().positive(),
  heightMm: z.number().positive(),
  rotationDeg: z.number().finite().optional(),
  groupId: z.string().min(1).optional()
});

const artworkWallObjectSchema = wallObjectBaseSchema.extend({
  kind: z.literal("artwork"),
  artworkId: z.string().min(1),
  displayDimensionsOverride: dimensionsSchema.optional()
});

const openingWallObjectSchema = wallObjectBaseSchema.extend({
  kind: z.enum(["door", "window", "blocked-zone"]),
  blocksPlacement: z.literal(true),
  connectsToWallId: z.string().min(1).optional()
});

const wallObjectSchema = z.discriminatedUnion("kind", [
  artworkWallObjectSchema,
  openingWallObjectSchema
]);

const floorObjectBaseSchema = z.object({
  id: z.string().min(1),
  xMm: z.number().finite(),
  yMm: z.number().finite(),
  widthMm: z.number().positive(),
  depthMm: z.number().positive(),
  rotationDeg: z.number().finite(),
  heightMm: z.number().positive(),
  wallYMm: z.number().finite()
});

const artworkFloorObjectSchema = floorObjectBaseSchema.extend({
  kind: z.literal("artwork"),
  artworkId: z.string().min(1),
  displayDimensionsOverride: dimensionsSchema.optional()
});

const blockedZoneFloorObjectSchema = floorObjectBaseSchema.extend({
  kind: z.literal("blocked-zone")
});

const floorObjectSchema = z.discriminatedUnion("kind", [
  artworkFloorObjectSchema,
  blockedZoneFloorObjectSchema
]);

const roomVertexSchema = z.object({
  id: z.string().min(1),
  xMm: z.number().finite(),
  yMm: z.number().finite()
});

const wallSchema = z.object({
  id: z.string().min(1),
  roomId: z.string().min(1),
  name: z.string().min(1),
  startVertexId: z.string().min(1),
  endVertexId: z.string().min(1),
  heightMm: z.number().positive(),
  defaultCenterlineHeightMm: z.number().positive().optional()
});

const roomSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    heightMm: z.number().positive(),
    vertices: z.array(roomVertexSchema).min(3),
    walls: z.array(wallSchema).min(1)
  })
  .superRefine((room, context) => {
    const vertexIds = new Set(room.vertices.map((vertex) => vertex.id));
    let hasMissingVertex = false;

    for (const wall of room.walls) {
      if (wall.roomId !== room.id) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Wall ${wall.id} belongs to room ${room.id} but declares roomId ${wall.roomId}`,
          path: ["walls", wall.id, "roomId"]
        });
      }

      if (!vertexIds.has(wall.startVertexId)) {
        hasMissingVertex = true;
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Wall ${wall.id} references missing start vertex ${wall.startVertexId}`,
          path: ["walls", wall.id, "startVertexId"]
        });
      }

      if (!vertexIds.has(wall.endVertexId)) {
        hasMissingVertex = true;
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Wall ${wall.id} references missing end vertex ${wall.endVertexId}`,
          path: ["walls", wall.id, "endVertexId"]
        });
      }
    }

    if (hasMissingVertex) return;

    for (let index = 0; index < room.walls.length; index += 1) {
      const wall = room.walls[index];
      const nextWall = room.walls[(index + 1) % room.walls.length];

      if (nextWall.startVertexId !== wall.endVertexId) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Walls do not form a closed loop: ${wall.id} ends at ${wall.endVertexId} but ${nextWall.id} starts at ${nextWall.startVertexId}`,
          path: ["walls", wall.id]
        });
      }
    }
  });

const roomPlacementSchema = z
  .object({
    roomId: z.string().min(1),
    offsetXMm: z.number().finite(),
    offsetYMm: z.number().finite(),
    rotationDeg: z
      .number()
      .refine((value) => value === 0, "Room rotation is not supported yet."),
    room: roomSchema
  })
  .superRefine((placement, context) => {
    if (placement.roomId !== placement.room.id) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Room placement declares roomId ${placement.roomId} but contains room ${placement.room.id}`,
        path: ["roomId"]
      });
    }
  });

export const projectSchema = z.object({
  id: z.string().min(1),
  schemaVersion: z.literal(CURRENT_SCHEMA_VERSION),
  title: z.string().min(1),
  unit: displayUnitSchema,
  defaultWallHeightMm: z.number().positive(),
  defaultCenterlineHeightMm: z.number().positive(),
  floor: z.object({
    // No minimum: a brand-new project can start with an empty floor and go
    // straight to the checklist (docs/plan.md §1.5) — room layout is one of
    // two equally valid starting points, not a prerequisite.
    rooms: z.array(roomPlacementSchema)
  }),
  checklistArtworkIds: z.array(z.string()),
  wallObjects: z.array(wallObjectSchema).default([]),
  floorObjects: z.array(floorObjectSchema).default([]),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
});

export function parseProject(input: unknown): Project {
  return projectSchema.parse(input);
}

const versionedDocumentSchema = z.object({
  schemaVersion: z.number().int().positive()
});

// A grossly oversized paste/drop (a multi-hundred-MB string) would block the
// tab just to JSON.parse it, before validation ever gets a chance to reject
// it — so the size check in migrateProjectJson runs first, on the raw text.
// 20 MB comfortably covers a project.json (no embedded image bytes; those
// live in the future .sightlines package's assets/, §6 of docs/plan.md).
export const MAX_IMPORT_JSON_LENGTH = 20 * 1024 * 1024;

function formatApproxMegabytes(lengthInUtf16Units: number): string {
  return `${(lengthInUtf16Units / (1024 * 1024)).toFixed(1)} MB`;
}

// Every load path that can receive an externally-authored document runs
// parse → validate minimal shape → migrate → validate current schema
// (docs/plan.md §2). This function is that pipeline for a raw text payload;
// migrateProject below is the parsed-value half of it, reused by the
// IndexedDB repository for records that never went through JSON.parse here.
export function migrateProjectJson(text: string): Project {
  if (typeof text !== "string") {
    throw new Error("no file content was provided.");
  }

  // `.length` counts UTF-16 code units, not exact UTF-8 bytes — close enough
  // for a sanity cap, and free to read, unlike encoding the whole string
  // just to reject it.
  if (text.length > MAX_IMPORT_JSON_LENGTH) {
    throw new Error(
      `the file is too large (${formatApproxMegabytes(text.length)}) — imports are limited to ${formatApproxMegabytes(MAX_IMPORT_JSON_LENGTH)}.`
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("the file is not valid JSON.");
  }

  return migrateProject(parsed);
}

export function migrateProject(input: unknown): Project {
  const versioned = versionedDocumentSchema.safeParse(input);

  if (!versioned.success) {
    throw new Error("this file is not a Sightlines project.");
  }

  const { schemaVersion } = versioned.data;

  if (schemaVersion > CURRENT_SCHEMA_VERSION) {
    throw new Error(
      `this project was made with a newer version of Sightlines (schema version ${schemaVersion}) than this app supports (version ${CURRENT_SCHEMA_VERSION}). Open it with a newer version of the app.`
    );
  }

  let migrated = input;

  if (schemaVersion < CURRENT_SCHEMA_VERSION) {
    if (schemaVersion !== 1 || typeof migrated !== "object" || migrated === null) {
      throw new Error(
        `this project uses an old schema version (${schemaVersion}) that this app can no longer open.`
      );
    }

    // v1 → v2: floor objects (plan-view artwork/blocked-zone placements not
    // anchored to a wall) are a new concept in v2, so v1 documents simply
    // never had any — an empty array is the only valid migration.
    migrated = {
      ...(migrated as Record<string, unknown>),
      floorObjects: [],
      schemaVersion: 2
    };
  }

  try {
    return parseProject(migrated);
  } catch (error) {
    if (error instanceof z.ZodError) {
      const [issue] = error.issues;
      const path = issue?.path.join(".");
      throw new Error(
        `this project's data doesn't match the Sightlines format${path ? ` (${path}: ${issue.message})` : ""}.`
      );
    }
    throw error;
  }
}
