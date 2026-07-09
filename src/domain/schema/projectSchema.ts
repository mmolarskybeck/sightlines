import { z } from "zod";
import { CURRENT_SCHEMA_VERSION, type Project } from "../project";
import { parseFaceWallId } from "../geometry/freestandingWalls";

const displayUnitSchema = z.enum(["in", "ft", "cm", "m"]);

// `#` is reserved for derived partition-face ids (`${partitionId}#a|#b`,
// spec §5.3), so it is banned in every real wall/vertex/partition id so a face
// id can never collide with a stored one.
const hashFreeIdSchema = z
  .string()
  .min(1)
  .refine((value) => !value.includes("#"), "IDs cannot contain '#'.");

export const dimensionsSchema = z.object({
  widthMm: z.number().positive().optional(),
  heightMm: z.number().positive().optional(),
  depthMm: z.number().positive().optional(),
  status: z.enum(["known", "approximate", "unknown"]),
  displayUnit: displayUnitSchema.optional(),
  aspectLocked: z.boolean().optional()
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

// Split to mirror the TS union (spec §5.5): only doors/windows carry
// connectsToObjectId; blocked zones never pair. connectsToObjectId replaces the
// never-written connectsToWallId (dropped in the v2→v3 migration).
const connectableOpeningWallObjectSchema = wallObjectBaseSchema.extend({
  kind: z.enum(["door", "window"]),
  blocksPlacement: z.literal(true),
  connectsToObjectId: z.string().min(1).optional()
});

const blockedZoneWallObjectSchema = wallObjectBaseSchema.extend({
  kind: z.literal("blocked-zone"),
  blocksPlacement: z.literal(true)
});

const wallObjectSchema = z.discriminatedUnion("kind", [
  artworkWallObjectSchema,
  connectableOpeningWallObjectSchema,
  blockedZoneWallObjectSchema
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
  id: hashFreeIdSchema,
  xMm: z.number().finite(),
  yMm: z.number().finite()
});

const wallSchema = z.object({
  id: hashFreeIdSchema,
  roomId: z.string().min(1),
  name: z.string().min(1),
  startVertexId: z.string().min(1),
  endVertexId: z.string().min(1),
  heightMm: z.number().positive(),
  defaultCenterlineHeightMm: z.number().positive().optional()
});

const freestandingWallSchema = z.object({
  id: hashFreeIdSchema,
  roomId: z.string().min(1),
  name: z.string().min(1),
  startXMm: z.number().finite(),
  startYMm: z.number().finite(),
  endXMm: z.number().finite(),
  endYMm: z.number().finite(),
  heightMm: z.number().positive(),
  thicknessMm: z.number().positive(),
  defaultCenterlineHeightMm: z.number().positive().optional()
});

const roomSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    heightMm: z.number().positive(),
    vertices: z.array(roomVertexSchema).min(3),
    walls: z.array(wallSchema).min(1),
    freestandingWalls: z.array(freestandingWallSchema).default([])
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

    // Partition invariants (spec §5.6): unique ids, roomId match, endpoints not
    // coincident. (`#` ban and positive thickness are enforced by the field
    // schemas above.)
    const partitionIds = new Set<string>();
    for (const partition of room.freestandingWalls) {
      if (partitionIds.has(partition.id)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplicate partition id ${partition.id}`,
          path: ["freestandingWalls", partition.id, "id"]
        });
      }
      partitionIds.add(partition.id);

      if (partition.roomId !== room.id) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Partition ${partition.id} belongs to room ${room.id} but declares roomId ${partition.roomId}`,
          path: ["freestandingWalls", partition.id, "roomId"]
        });
      }

      if (
        partition.startXMm === partition.endXMm &&
        partition.startYMm === partition.endYMm
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Partition ${partition.id} has coincident endpoints`,
          path: ["freestandingWalls", partition.id]
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

export const projectSchema = z
  .object({
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
  })
  // Opening-pairing invariants (spec §5.5). Pairing spans the flat wallObjects
  // array, so it can only be validated here. Geometric alignment is NOT a
  // schema invariant — it's a derived advisory (§7.2). wallObjects[].wallId is
  // deliberately still not cross-checked (dangling refs stay a runtime
  // advisory), and face ids inherit that policy.
  .superRefine((project, context) => {
    const byId = new Map(project.wallObjects.map((object) => [object.id, object]));
    for (const object of project.wallObjects) {
      const partnerId =
        object.kind === "door" || object.kind === "window"
          ? object.connectsToObjectId
          : undefined;
      if (partnerId === undefined) continue;

      const flag = (message: string) =>
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message,
          path: ["wallObjects", object.id, "connectsToObjectId"]
        });

      if (partnerId === object.id) {
        flag(`Opening ${object.id} cannot connect to itself.`);
        continue;
      }
      const partner = byId.get(partnerId);
      if (!partner) {
        flag(`Opening ${object.id} connects to missing opening ${partnerId}.`);
        continue;
      }
      // Symmetric double-pointer — enforced, not derived.
      const partnerBack =
        partner.kind === "door" || partner.kind === "window"
          ? partner.connectsToObjectId
          : undefined;
      if (partnerBack !== object.id) {
        flag(`Opening pairing is not symmetric between ${object.id} and ${partnerId}.`);
      }
      // Same kind, door|window only.
      if (partner.kind !== object.kind) {
        flag(`Paired openings must be the same kind (${object.id} vs ${partnerId}).`);
      }
      // Both on perimeter walls (never partition faces) of DIFFERENT walls.
      if (parseFaceWallId(object.wallId) !== null || parseFaceWallId(partner.wallId) !== null) {
        flag(`Openings on partition faces cannot be paired (${object.id}).`);
      }
      if (object.wallId === partner.wallId) {
        flag(`Paired openings must be on different walls (${object.id}).`);
      }
    }
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

type Doc = Record<string, unknown>;

// Stepwise migrations keyed by the *from* version, applied in a loop while the
// document's version is behind CURRENT_SCHEMA_VERSION (spec §5.6). This lets a
// v1 document walk 1→2→3 instead of jumping straight to the newest schema — the
// old single-block form would stamp a v1 doc as v2 and then fail v3 validation,
// and reject v2 docs outright. Each step bumps schemaVersion itself.
const MIGRATIONS: Record<number, (doc: Doc) => Doc> = {
  // v1 → v2: floor objects (plan-view artwork/blocked-zone placements not
  // anchored to a wall) are a new concept in v2, so v1 documents simply never
  // had any — an empty array is the only valid migration.
  1: (doc) => ({ ...doc, floorObjects: [], schemaVersion: 2 }),
  // v2 → v3: partitions (a new per-room array) and the openings' pairing field
  // change. Add an empty freestandingWalls to every room, and strip any
  // connectsToWallId keys (never written by the app; connectsToObjectId
  // replaces it — discarding is safe).
  2: (doc) => migrateV2ToV3(doc)
};

function migrateV2ToV3(doc: Doc): Doc {
  const floor = (doc.floor as Doc | undefined) ?? undefined;
  const rooms = Array.isArray(floor?.rooms) ? (floor.rooms as unknown[]) : [];
  const nextRooms = rooms.map((placement) => {
    if (typeof placement !== "object" || placement === null) return placement;
    const roomPlacement = placement as Doc;
    const room = roomPlacement.room;
    if (typeof room !== "object" || room === null) return placement;
    return {
      ...roomPlacement,
      room: { ...(room as Doc), freestandingWalls: [] }
    };
  });

  const wallObjects = Array.isArray(doc.wallObjects) ? (doc.wallObjects as unknown[]) : undefined;
  const nextWallObjects = wallObjects?.map((object) => {
    if (typeof object !== "object" || object === null) return object;
    const { connectsToWallId: _dropped, ...rest } = object as Doc;
    return rest;
  });

  return {
    ...doc,
    ...(floor ? { floor: { ...floor, rooms: nextRooms } } : {}),
    ...(nextWallObjects ? { wallObjects: nextWallObjects } : {}),
    schemaVersion: 3
  };
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

  if (schemaVersion < CURRENT_SCHEMA_VERSION && (typeof input !== "object" || input === null)) {
    throw new Error(
      `this project uses an old schema version (${schemaVersion}) that this app can no longer open.`
    );
  }

  let migrated: Doc = input as Doc;
  let version = schemaVersion;
  while (version < CURRENT_SCHEMA_VERSION) {
    const step = MIGRATIONS[version];
    if (!step) {
      throw new Error(
        `this project uses an old schema version (${version}) that this app can no longer open.`
      );
    }
    migrated = step(migrated);
    version += 1;
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
