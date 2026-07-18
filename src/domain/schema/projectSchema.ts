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

// A wall text is additive (a new union member): older projects simply carry no
// wall-text entries, so no schema-version bump is needed — a v3 document with
// no wall texts is byte-identical to one written before this branch existed.
const wallTextWallObjectSchema = wallObjectBaseSchema.extend({
  kind: z.literal("wall-text"),
  name: z.string().min(1).optional()
});

// A wall display case (vitrine): a new union member that adds a required
// `depthMm` (protrusion from the wall). Because it adds a stored field it is
// NOT purely additive and rides the v3→v4 schema-version bump (see MIGRATIONS).
const caseWallObjectSchema = wallObjectBaseSchema.extend({
  kind: z.literal("case"),
  depthMm: z.number().positive()
});

const wallObjectSchema = z.discriminatedUnion("kind", [
  artworkWallObjectSchema,
  connectableOpeningWallObjectSchema,
  blockedZoneWallObjectSchema,
  wallTextWallObjectSchema,
  caseWallObjectSchema
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

// A freestanding display case (vitrine): carries only the FloorObjectBase
// shape — its overall height is `heightMm`, no extra stored fields. New in v4.
const caseFloorObjectSchema = floorObjectBaseSchema.extend({
  kind: z.literal("case")
});

const floorObjectSchema = z.discriminatedUnion("kind", [
  artworkFloorObjectSchema,
  blockedZoneFloorObjectSchema,
  caseFloorObjectSchema
]);

const measurementPointSchema = z.object({
  xMm: z.number().finite(),
  yMm: z.number().finite()
});

const referenceMeasurementBaseSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).optional(),
  visible: z.boolean(),
  locked: z.boolean(),
  start: measurementPointSchema,
  end: measurementPointSchema
});

const referenceMeasurementSchema = z.discriminatedUnion("kind", [
  referenceMeasurementBaseSchema.extend({ kind: z.literal("plan") }),
  referenceMeasurementBaseSchema.extend({
    kind: z.literal("elevation"),
    wallId: z.string().min(1)
  })
]);

// Plain-number pose (world units). Deliberately NOT `.finite()`: a numerically
// invalid pose is an export-time advisory (spec §8.4), not a load-time
// rejection — and JSON can't carry non-finite values anyway.
const savedViewVec3Schema = z.object({
  x: z.number(),
  y: z.number(),
  z: z.number()
});

const savedViewSchema = z.object({
  id: z.string().min(1),
  ordinal: z.number().int().nonnegative(),
  title: z.string().min(1),
  roomId: z.string().min(1).optional(),
  pose: z.object({
    position: savedViewVec3Schema,
    target: savedViewVec3Schema
  }),
  createdAt: z.string().datetime()
});

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

    // Partition ids are unique, room-owned, and have distinct endpoints.
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
      // Empty floors are valid; users may begin from the checklist.
      rooms: z.array(roomPlacementSchema)
    }),
    checklistArtworkIds: z.array(z.string()),
    wallObjects: z.array(wallObjectSchema).default([]),
    floorObjects: z.array(floorObjectSchema).default([]),
    referenceMeasurements: z.array(referenceMeasurementSchema).default([]),
    savedViews: z.array(savedViewSchema).default([]),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime()
  })
  // Opening-pairing invariants (spec §5.5). Pairing spans the flat wallObjects
  // array, so it can only be validated here. Geometric alignment is NOT a
  // schema invariant — it's a derived advisory (§7.2). wallObjects[].wallId is
  // deliberately still not cross-checked (dangling refs stay a runtime
  // advisory), and face ids inherit that policy.
  .superRefine((project, context) => {
    const measurementIds = new Set<string>();
    const elevationWallIds = new Set<string>();
    for (const placement of project.floor.rooms) {
      for (const wall of placement.room.walls) elevationWallIds.add(wall.id);
      for (const partition of placement.room.freestandingWalls) {
        elevationWallIds.add(`${partition.id}#a`);
        elevationWallIds.add(`${partition.id}#b`);
      }
    }
    for (const measurement of project.referenceMeasurements) {
      const path = ["referenceMeasurements", measurement.id];
      if (measurementIds.has(measurement.id)) {
        context.addIssue({ code: z.ZodIssueCode.custom, message: `Duplicate reference measurement id ${measurement.id}.`, path });
      }
      measurementIds.add(measurement.id);
      if (measurement.start.xMm === measurement.end.xMm && measurement.start.yMm === measurement.end.yMm) {
        context.addIssue({ code: z.ZodIssueCode.custom, message: "Reference measurement endpoints cannot coincide.", path });
      }
      if (measurement.kind === "elevation" && !elevationWallIds.has(measurement.wallId)) {
        context.addIssue({ code: z.ZodIssueCode.custom, message: `Reference measurement points to missing wall ${measurement.wallId}.`, path: [...path, "wallId"] });
      }
    }

    const savedViewIds = new Set<string>();
    const savedViewOrdinals = new Set<number>();
    for (const view of project.savedViews) {
      const path = ["savedViews", view.id];
      if (savedViewIds.has(view.id)) {
        context.addIssue({ code: z.ZodIssueCode.custom, message: `Duplicate saved view id ${view.id}.`, path });
      }
      savedViewIds.add(view.id);
      if (savedViewOrdinals.has(view.ordinal)) {
        context.addIssue({ code: z.ZodIssueCode.custom, message: `Duplicate saved view ordinal ${view.ordinal}.`, path: [...path, "ordinal"] });
      }
      savedViewOrdinals.add(view.ordinal);
    }

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

// Cap raw text before JSON.parse can block the tab; project JSON embeds no images.
export const MAX_IMPORT_JSON_LENGTH = 20 * 1024 * 1024;

function formatApproxMegabytes(lengthInUtf16Units: number): string {
  return `${(lengthInUtf16Units / (1024 * 1024)).toFixed(1)} MB`;
}

// External JSON follows parse → minimal validation → migration → current validation.
export function migrateProjectJson(text: string): Project {
  if (typeof text !== "string") {
    throw new Error("no file content was provided.");
  }

  // UTF-16 length is sufficient for this pre-parse sanity cap.
  if (text.length > MAX_IMPORT_JSON_LENGTH) {
    throw new Error(
      `the file is too large (${formatApproxMegabytes(text.length)}). Imports are limited to ${formatApproxMegabytes(MAX_IMPORT_JSON_LENGTH)}.`
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

// Migrations are keyed by source version and each step advances schemaVersion.
const MIGRATIONS: Record<number, (doc: Doc) => Doc> = {
  // v1 had no floor objects.
  1: (doc) => ({ ...doc, floorObjects: [], schemaVersion: 2 }),
  // v3 adds partitions and replaces the never-written connectsToWallId field.
  2: (doc) => migrateV2ToV3(doc),
  // v4 adds display cases (floor + wall). A v3 project contains no cases, so
  // like the v1→v2 floorObjects passthrough this is a pure version-stamp — the
  // new union members are absent from every existing document and nothing in
  // the stored shape needs rewriting.
  3: (doc) => ({ ...doc, schemaVersion: 4 })
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
