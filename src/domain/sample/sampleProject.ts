import { CURRENT_SCHEMA_VERSION, type Project } from "../project";
import { feetToMm, inchesToMm } from "../units/length";

export function createSampleProject(): Project {
  const now = new Date().toISOString();
  const roomId = "room-main";

  return {
    id: "sample-gallery",
    schemaVersion: CURRENT_SCHEMA_VERSION,
    title: "Untitled Exhibition",
    unit: "ft",
    defaultWallHeightMm: feetToMm(12),
    defaultCenterlineHeightMm: inchesToMm(57),
    checklistArtworkIds: [],
    createdAt: now,
    updatedAt: now,
    floor: {
      rooms: [
        {
          roomId,
          offsetXMm: 0,
          offsetYMm: 0,
          rotationDeg: 0,
          room: {
            id: roomId,
            name: "Main Gallery",
            heightMm: feetToMm(12),
            vertices: [
              { id: "v-nw", xMm: 0, yMm: 0 },
              { id: "v-ne", xMm: feetToMm(28), yMm: 0 },
              { id: "v-se", xMm: feetToMm(28), yMm: feetToMm(18) },
              { id: "v-sw", xMm: 0, yMm: feetToMm(18) }
            ],
            walls: [
              {
                id: "wall-north",
                roomId,
                name: "North wall",
                startVertexId: "v-nw",
                endVertexId: "v-ne",
                heightMm: feetToMm(12)
              },
              {
                id: "wall-east",
                roomId,
                name: "East wall",
                startVertexId: "v-ne",
                endVertexId: "v-se",
                heightMm: feetToMm(12)
              },
              {
                id: "wall-south",
                roomId,
                name: "South wall",
                startVertexId: "v-se",
                endVertexId: "v-sw",
                heightMm: feetToMm(12)
              },
              {
                id: "wall-west",
                roomId,
                name: "West wall",
                startVertexId: "v-sw",
                endVertexId: "v-nw",
                heightMm: feetToMm(12)
              }
            ]
          }
        }
      ]
    }
  };
}
