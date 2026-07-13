import type { Artwork, Project, WallObject } from "../../src/domain/project";

/**
 * Deterministic renderer fixture: 10 rooms, 40 walls, and 200 placements.
 * Reuses six public-domain assets to keep the fixture small.
 */
const sourceWorks = [
  ["mona-lisa", "Mona Lisa", "Leonardo da Vinci", 530, 770],
  ["starry-night", "The Starry Night", "Vincent van Gogh", 921, 737],
  ["girl-with-a-pearl-earring", "Girl with a Pearl Earring", "Johannes Vermeer", 390, 445],
  ["great-wave-off-kanagawa", "The Great Wave off Kanagawa", "Katsushika Hokusai", 365, 246],
  ["birth-of-venus", "The Birth of Venus", "Sandro Botticelli", 2789, 1725],
  ["the-swing", "The Swing", "Jean-Honore Fragonard", 642, 810]
] as const;

const roomWidthMm = 10000;
const roomDepthMm = 7000;
const wallHeightMm = 3600;
const spacingMm = 16000;

function roomFor(index: number) {
  const column = index % 5;
  const row = Math.floor(index / 5);
  const x = column * spacingMm;
  const y = row * spacingMm;
  const roomId = `benchmark-room-${index + 1}`;
  const vertices = [
    { id: `${roomId}-v1`, xMm: 0, yMm: 0 },
    { id: `${roomId}-v2`, xMm: roomWidthMm, yMm: 0 },
    { id: `${roomId}-v3`, xMm: roomWidthMm, yMm: roomDepthMm },
    { id: `${roomId}-v4`, xMm: 0, yMm: roomDepthMm }
  ];
  const walls = [
    ["north", "v1", "v2"],
    ["east", "v2", "v3"],
    ["south", "v3", "v4"],
    ["west", "v4", "v1"]
  ].map(([name, start, end]) => ({
    id: `${roomId}-${name}`,
    roomId,
    name,
    startVertexId: `${roomId}-${start}`,
    endVertexId: `${roomId}-${end}`,
    heightMm: wallHeightMm
  }));
  return { roomId, x, y, vertices, walls };
}

const rooms = Array.from({ length: 10 }, (_, index) => roomFor(index));

export const rendererBenchmarkArtworks: Artwork[] = Array.from(
  { length: 200 },
  (_, index) => {
    const [assetId, title, artist, widthMm, heightMm] = sourceWorks[index % sourceWorks.length];
    return {
      id: `benchmark-work-${String(index + 1).padStart(3, "0")}`,
      schemaVersion: 1,
      title: `${title} — benchmark ${String(index + 1).padStart(3, "0")}`,
      artist,
      date: "public domain source corpus",
      dimensions: { widthMm, heightMm, status: "known" },
      assetId,
      metadata: {
        benchmarkSource: "Wikimedia Commons public-domain artwork corpus",
        sourceAssetId: assetId
      }
    };
  }
);

export const rendererBenchmarkWallObjects: WallObject[] = Array.from(
  { length: 200 },
  (_, index) => {
    const room = rooms[Math.floor(index / 20)];
    const wall = room.walls[Math.floor((index % 20) / 5)];
    const slot = index % 5;
    return {
      id: `benchmark-placement-${String(index + 1).padStart(3, "0")}`,
      kind: "artwork",
      wallId: wall.id,
      artworkId: rendererBenchmarkArtworks[index].id,
      xMm: 1200 + slot * 1850,
      yMm: 1900,
      widthMm: 900,
      heightMm: 1100,
      rotationDeg: 0
    };
  }
);

export const rendererBenchmarkProject: Project = {
  id: "renderer-benchmark-10-room-200-work",
  schemaVersion: 3,
  title: "Renderer benchmark — 10 rooms / 200 works",
  unit: "m",
  defaultWallHeightMm: wallHeightMm,
  defaultCenterlineHeightMm: 1450,
  checklistArtworkIds: rendererBenchmarkArtworks.map((artwork) => artwork.id),
  wallObjects: rendererBenchmarkWallObjects,
  floorObjects: [],
  createdAt: "2026-07-11T00:00:00.000Z",
  updatedAt: "2026-07-11T00:00:00.000Z",
  floor: {
    rooms: rooms.map(({ roomId, x, y, vertices, walls }) => ({
      roomId,
      offsetXMm: x,
      offsetYMm: y,
      rotationDeg: 0,
      room: {
        id: roomId,
        name: `Benchmark room ${roomId.split("-").pop()}`,
        heightMm: wallHeightMm,
        vertices,
        walls,
        freestandingWalls: []
      }
    }))
  }
};
