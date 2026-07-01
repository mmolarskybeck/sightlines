import { z } from "zod";
import { CURRENT_SCHEMA_VERSION, type Project } from "../project";

const displayUnitSchema = z.enum(["in", "ft", "cm", "m"]);

const dimensionsSchema = z.object({
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

    for (const wall of room.walls) {
      if (!vertexIds.has(wall.startVertexId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Wall ${wall.id} references missing start vertex ${wall.startVertexId}`,
          path: ["walls", wall.id, "startVertexId"]
        });
      }

      if (!vertexIds.has(wall.endVertexId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Wall ${wall.id} references missing end vertex ${wall.endVertexId}`,
          path: ["walls", wall.id, "endVertexId"]
        });
      }
    }
  });

const roomPlacementSchema = z.object({
  roomId: z.string().min(1),
  offsetXMm: z.number().finite(),
  offsetYMm: z.number().finite(),
  rotationDeg: z.number().finite(),
  room: roomSchema
});

export const projectSchema = z.object({
  id: z.string().min(1),
  schemaVersion: z.literal(CURRENT_SCHEMA_VERSION),
  title: z.string().min(1),
  unit: displayUnitSchema,
  defaultWallHeightMm: z.number().positive(),
  defaultCenterlineHeightMm: z.number().positive(),
  floor: z.object({
    rooms: z.array(roomPlacementSchema).min(1)
  }),
  checklistArtworkIds: z.array(z.string()),
  wallObjects: z.array(wallObjectSchema).default([]),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
});

export function parseProject(input: unknown): Project {
  return projectSchema.parse(input);
}

export function migrateProject(input: unknown): Project {
  const candidate = input as { schemaVersion?: unknown };

  if (candidate.schemaVersion !== CURRENT_SCHEMA_VERSION) {
    throw new Error(
      `Unsupported project schema version: ${String(candidate.schemaVersion)}`
    );
  }

  return parseProject(input);
}
