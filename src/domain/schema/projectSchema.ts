import { z } from "zod";
import { CURRENT_SCHEMA_VERSION, type Project } from "../project";
import { parseFaceWallId } from "../geometry/freestandingWalls";
import { normalizeOpeningPairs } from "../placement/openingPairs";
import { normalizeFloorSupport } from "../geometry/supportGlyphs";

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

const floorObjectFaceSchema = z.enum([
  "front",
  "back",
  "left",
  "right",
  "top",
  "bottom"
]);

// Floor-only state parked on a wall object while it is captured (see
// FloorMemory in domain/project.ts, and its TRAP: nothing renders from it).
// Every member is optional, and the whole object is optional on its two
// carriers, so this is PURELY ADDITIVE and needs NO schema-version bump — a v5
// document written before this branch existed parses byte-identically.
//
// Contrast Wall.isOpenSide, which is also structurally optional and DID ride a
// bump: there, an older build stripping the key would redraw the wall solid,
// treat it as hangable, and save that misreading back. Here an older build
// stripping floorMemory changes nothing that is drawn — the object is on a
// wall, and a wall renders identically with or without it. The only casualty is
// dormant memory, and losing it degrades exactly to the pre-fix behaviour
// (inherit the wall's angle) rather than to a wrong picture of the document.
const floorMemorySchema = z.object({
  rotationDeg: z.number().finite().optional(),
  // Non-negative, mirroring the live floorObjectBaseSchema.baseHeightMm it
  // shadows: the memory must not be able to hold a value that would fail
  // validation the moment it is restored onto a floor object.
  baseHeightMm: z.number().nonnegative().finite().optional()
});

// The artwork-only extension. Deliberately NOT mirrored with a
// `imageFaces: z.never().optional()` refusal on the blocked-zone variant the
// way windowWallObjectSchema refuses `leaf`: a window carrying a leaf is a
// malformed claim about physical construction worth rejecting loudly, whereas
// stripping imageFaces from a blocked zone's dormant memory is the correct
// outcome anyway — there is no image, no reader, and nothing drawn changes.
// The attached pedestal/plinth block (ArtworkFloorObject.support). Purely
// STRUCTURAL, like every other schema here: whether this support actually holds
// the work standing on it — footprint containment, offset clamps, bonnet
// clearance and the derived bonnet height — is a RELATIONAL invariant between
// the support and the placement's own dimensions, and lives in exactly one
// place, normalizeFloorSupport (geometry/supportGlyphs.ts), which the load
// boundary below runs over every parsed document. Encoding those rules here as
// refinements would make a repairable document unopenable.
//
// Every member beyond kind/size is optional and absence is meaningful, so this
// is additive in SHAPE — but it still rides the v5 -> v6 bump, for the DOWNGRADE
// direction only: see MIGRATIONS.
const floorSupportSchema = z.object({
  kind: z.enum(["pedestal", "plinth"]),
  widthMm: z.number().positive(),
  depthMm: z.number().positive(),
  heightMm: z.number().positive(),
  // Signed: the work may be displaced either way along either local axis.
  offsetXMm: z.number().finite().optional(),
  offsetYMm: z.number().finite().optional(),
  overhangAllowed: z.boolean().optional(),
  // Positive, not non-negative: a zero-height bonnet is the absence of a
  // bonnet, and absence is already how that is written.
  bonnetHeightMm: z.number().positive().optional(),
  bonnetHeightLocked: z.boolean().optional()
});

const artworkFloorMemorySchema = floorMemorySchema.extend({
  imageFaces: z.array(floorObjectFaceSchema).optional(),
  // Parked floor support + monitor choice, mirroring the live fields they
  // shadow so the memory cannot hold a value that would fail validation the
  // moment it is restored onto a floor object.
  support: floorSupportSchema.optional(),
  monitorSupport: z.enum(["pedestal", "floor"]).optional()
});

const artworkWallObjectSchema = wallObjectBaseSchema.extend({
  kind: z.literal("artwork"),
  artworkId: z.string().min(1),
  floorMemory: artworkFloorMemorySchema.optional(),
  displayDimensionsOverride: dimensionsSchema.optional()
});

// Split to mirror the TS union (spec §5.5): only doors/windows carry
// connectsToObjectId; blocked zones never pair. connectsToObjectId replaces the
// never-written connectsToWallId (dropped in the v2→v3 migration).
const connectableOpeningBaseSchema = wallObjectBaseSchema.extend({
  blocksPlacement: z.literal(true),
  connectsToObjectId: z.string().min(1).optional()
});

const doorLeafSchema = z.object({
  hingeAtStart: z.boolean(),
  swingsToLeft: z.boolean()
});

// Doors and windows are two branches, not one `z.enum(["door","window"])`,
// because `leaf` exists only on a door. Purely additive optional field, so NO
// schema-version bump — same reasoning as wallTextWallObjectSchema below: a v4
// document with no hinged doors is byte-identical to one written before this
// branch existed. (Contrast CaseWallObject.depthMm, which is REQUIRED and so
// did force v3→v4.)
const doorWallObjectSchema = connectableOpeningBaseSchema.extend({
  kind: z.literal("door"),
  leaf: doorLeafSchema.optional()
});

const windowWallObjectSchema = connectableOpeningBaseSchema.extend({
  kind: z.literal("window"),
  // `z.never().optional()` and not simply omitting the key: zod object schemas
  // STRIP unknown keys, so an omitted `leaf` would be silently dropped from a
  // window rather than refused. "A window can never carry a leaf" is meant as a
  // real invariant — a document asserting one is malformed, not one to quietly
  // rewrite — so the key has to be declared and rejected.
  leaf: z.never().optional()
});

const connectableOpeningWallObjectSchemas = [
  doorWallObjectSchema,
  windowWallObjectSchema
] as const;

const blockedZoneWallObjectSchema = wallObjectBaseSchema.extend({
  kind: z.literal("blocked-zone"),
  blocksPlacement: z.literal(true),
  // The BASE memory shape: a blocked zone's plan angle is live floor geometry
  // and is lost on a capture round trip exactly as an artwork's is, but it has
  // no image, so imageFaces is unrepresentable here.
  floorMemory: floorMemorySchema.optional()
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

// A wall shelf: like the case above, a new union member that adds a REQUIRED
// `depthMm` (protrusion from the wall). Not purely additive, so it rides the
// v6→v7 schema-version bump (see MIGRATIONS).
const shelfWallObjectSchema = wallObjectBaseSchema.extend({
  kind: z.literal("shelf"),
  depthMm: z.number().positive()
});

const wallObjectSchema = z.discriminatedUnion("kind", [
  artworkWallObjectSchema,
  ...connectableOpeningWallObjectSchemas,
  blockedZoneWallObjectSchema,
  wallTextWallObjectSchema,
  caseWallObjectSchema,
  shelfWallObjectSchema
]);

const floorObjectBaseSchema = z.object({
  id: z.string().min(1),
  xMm: z.number().finite(),
  yMm: z.number().finite(),
  widthMm: z.number().positive(),
  depthMm: z.number().positive(),
  rotationDeg: z.number().finite(),
  heightMm: z.number().positive(),
  wallYMm: z.number().finite(),
  // Suspension height of the bottom edge above the floor. Optional and
  // additive (absent = resting on the floor), so no schema-version bump —
  // older projects simply carry no value. Non-negative: an object below the
  // floor is not a state worth representing.
  baseHeightMm: z.number().nonnegative().finite().optional()
});

const artworkFloorObjectSchema = floorObjectBaseSchema.extend({
  kind: z.literal("artwork"),
  artworkId: z.string().min(1),
  // Which box faces carry the image. Optional and additive (absent =
  // DEFAULT_FLOOR_OBJECT_IMAGE_FACES, front + back), so no schema-version bump.
  // An empty array is deliberately legal — it means every face was turned off,
  // which is different from "never chosen"; see ArtworkFloorObject.imageFaces.
  imageFaces: z.array(floorObjectFaceSchema).optional(),
  // What a box-monitor placement stands on. Optional and additive (absent =
  // pedestal, resolved at read time — see ArtworkFloorObject.monitorSupport),
  // so no schema-version bump. Only meaningful when the joined artwork's
  // displayAs is "monitor"; a stray value on any other work is inert rather
  // than invalid, since the join isn't available at parse time.
  monitorSupport: z.enum(["pedestal", "floor"]).optional(),
  // The attached pedestal/plinth this work stands on. Structurally optional,
  // but it rides the v5 -> v6 bump — see MIGRATIONS.
  support: floorSupportSchema.optional(),
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
  defaultCenterlineHeightMm: z.number().positive().optional(),
  // An "open side": the wall record stays in the closed loop (so the vertex
  // topology, floor polygon and every cyclic room.walls index are untouched)
  // but its SURFACE is gone — no 3D panel, no plan stroke, nothing can hang
  // on it. Structurally optional, but it rides the v4→v5 bump anyway: zod
  // strips unknown keys, so an older build would redraw the wall solid, treat
  // it as hangable, and save that misreading back over the file.
  isOpenSide: z.boolean().optional()
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

// The checklist panel's explicit sort/grouping choice (2026-08-31). Optional
// and PURELY ADDITIVE — absent means "no explicit choice yet" (the app derives
// a default), so no schema-version bump: an older build simply strips the key
// on open and the curator is back to the derived default, never a broken
// document.
const checklistViewSchema = z.object({
  sort: z.enum(["project", "title", "artist", "status"]),
  groupByArtist: z.boolean()
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
    checklistView: checklistViewSchema.optional(),
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
  return migrateProjectJsonWithReport(text).project;
}

// migrateProjectJson plus the shared-opening repair count, so an imported file
// that had to be changed on the way in can say so.
export function migrateProjectJsonWithReport(text: string): {
  project: Project;
  repairedCount: number;
  supportRepairCount: number;
} {
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

  return migrateProjectWithReport(parsed);
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
  3: (doc) => ({ ...doc, schemaVersion: 4 }),
  // v5 adds open walls (Wall.isOpenSide). A v4 project has none, so this is a
  // pure version stamp like v1→v2 and v3→v4. The bump exists for the DOWNGRADE
  // direction: it makes an older build refuse the document (see the
  // schemaVersion > CURRENT check below) instead of silently stripping the flag
  // and re-saving every open wall as solid.
  4: (doc) => ({ ...doc, schemaVersion: 5 }),
  // v6 adds attached floor supports (ArtworkFloorObject.support — pedestal,
  // plinth, plexi bonnet). A v5 project has none, so this is a pure version
  // stamp like v1->v2, v3->v4 and v4->v5. The bump exists for the DOWNGRADE
  // direction, exactly the isOpenSide rationale above: a v5 build would accept
  // the file, STRIP `support`, draw the sculpture flat on the floor and re-save
  // that loss — a silently wrong picture of the document, not merely a missing
  // convenience.
  5: (doc) => ({ ...doc, schemaVersion: 6 }),
  // v7 adds wall shelves (ShelfWallObject). A v6 project has none, so this is a
  // pure version stamp like v1->v2, v3->v4, v4->v5 and v5->v6. The bump exists
  // for the DOWNGRADE direction, the same rationale as isOpenSide and support
  // above: a v6 build would accept the file, STRIP every shelf, leave the works
  // that stood on them floating in mid-air and re-save that loss.
  6: (doc) => ({ ...doc, schemaVersion: 7 })
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
  return migrateProjectWithReport(input).project;
}

// migrateProject plus a count of shared-opening pairs that had to be
// disconnected to make the document valid. Local documents repair silently;
// the package-import path surfaces the count, since an imported file that
// changed on the way in should say so.
export function migrateProjectWithReport(input: unknown): {
  project: Project;
  repairedCount: number;
  // Floor placements whose attached support had to be normalised on the way in
  // (a detached pedestal, an undersized overhang-off box, a stale bonnet
  // height). DELIBERATELY NOT folded into repairedCount, whose user-facing copy
  // means "invalid shared-opening pairs disconnected" and would become a lie.
  supportRepairCount: number;
  // The parsed, migrated document BEFORE the support repair — what storage
  // actually holds. The SAME reference as `project` when supportRepairCount is
  // 0. An open path snapshots this and, when it differs from `project`, writes
  // the repaired copy back; without it the repair would live only in memory and
  // the stored record would trigger the same repair (and warning) on every open.
  stored: Project;
} {
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

  // Repair structurally broken shared-opening pairings BEFORE validating. A
  // paired opening that was re-anchored onto its partner's wall (or any
  // unrelated wall) fails the pairing refinements below, which would otherwise
  // make the document permanently unopenable rather than merely unsaveable.
  // normalizeOpeningPairs is written to tolerate this not-yet-parsed input.
  const { project: repaired, repairedCount } = normalizeOpeningPairs(migrated as unknown as Project);

  try {
    // Structural validation first, then the RELATIONAL support invariants: the
    // normaliser reads the placement's own dimensions, so it can only run on a
    // document already known to have them. See floorSupportSchema for why the
    // rules are not zod refinements.
    const stored = parseProject(repaired);
    const { project, supportRepairCount } = normalizeProjectFloorSupports(stored);
    return { project, repairedCount, supportRepairCount, stored };
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

// Runs the ONE support normaliser (geometry/supportGlyphs.ts) over every floor
// placement carrying a support, at the load boundary, and reports how many had
// to change. Hand-edited files, a package written by a build with a different
// default, and an undo history replayed out of a stale document all arrive
// here; the alternative is a pedestal that renders detached from its sculpture
// in plan and only snaps back the next time someone happens to edit it.
//
// Returns the SAME project object when nothing changed, so a clean document's
// identity (and its cloud-backup fingerprint) is untouched.
//
// Exported for the in-memory project repository (src/test/inMemoryRepositories),
// whose loadWithReport has to produce the same report as the real read without
// re-parsing a document the tests hand back by reference.
export function normalizeProjectFloorSupports(project: Project): {
  project: Project;
  supportRepairCount: number;
} {
  let supportRepairCount = 0;
  const floorObjects = project.floorObjects.map((object) => {
    if (object.kind !== "artwork" || !object.support) return object;
    const { support, changed } = normalizeFloorSupport(object, object.support);
    if (!changed) return object;
    supportRepairCount += 1;
    return { ...object, support };
  });
  if (supportRepairCount === 0) return { project, supportRepairCount: 0 };
  return { project: { ...project, floorObjects }, supportRepairCount };
}
