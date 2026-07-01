import type { Floor, RoomPlacement } from "../project";
import { feetToMm } from "../units/length";
import { getFloorBounds } from "./walls";

type CreateRectangularRoomInput = {
  depthMm: number;
  heightMm: number;
  name: string;
  offsetXMm: number;
  offsetYMm: number;
  roomId: string;
  widthMm: number;
};

export function createRectangularRoomPlacement({
  depthMm,
  heightMm,
  name,
  offsetXMm,
  offsetYMm,
  roomId,
  widthMm
}: CreateRectangularRoomInput): RoomPlacement {
  if (widthMm <= 0 || depthMm <= 0 || heightMm <= 0) {
    throw new Error("Room dimensions must be greater than zero.");
  }

  return {
    roomId,
    offsetXMm,
    offsetYMm,
    rotationDeg: 0,
    room: {
      id: roomId,
      name,
      heightMm,
      vertices: [
        { id: `${roomId}-v-nw`, xMm: 0, yMm: 0 },
        { id: `${roomId}-v-ne`, xMm: widthMm, yMm: 0 },
        { id: `${roomId}-v-se`, xMm: widthMm, yMm: depthMm },
        { id: `${roomId}-v-sw`, xMm: 0, yMm: depthMm }
      ],
      walls: [
        {
          id: `${roomId}-wall-north`,
          roomId,
          name: "North wall",
          startVertexId: `${roomId}-v-nw`,
          endVertexId: `${roomId}-v-ne`,
          heightMm
        },
        {
          id: `${roomId}-wall-east`,
          roomId,
          name: "East wall",
          startVertexId: `${roomId}-v-ne`,
          endVertexId: `${roomId}-v-se`,
          heightMm
        },
        {
          id: `${roomId}-wall-south`,
          roomId,
          name: "South wall",
          startVertexId: `${roomId}-v-se`,
          endVertexId: `${roomId}-v-sw`,
          heightMm
        },
        {
          id: `${roomId}-wall-west`,
          roomId,
          name: "West wall",
          startVertexId: `${roomId}-v-sw`,
          endVertexId: `${roomId}-v-nw`,
          heightMm
        }
      ]
    }
  };
}

export function createNextRectangleRoom(
  floor: Floor,
  heightMm: number
): RoomPlacement {
  const roomNumber = getNextRoomNumber(floor);
  const roomId = `room-${roomNumber}`;
  const floorBounds = getFloorBounds(floor);

  return createRectangularRoomPlacement({
    roomId,
    name: `Gallery ${roomNumber}`,
    widthMm: feetToMm(20),
    depthMm: feetToMm(14),
    heightMm,
    offsetXMm: floorBounds.maxX + feetToMm(8),
    offsetYMm: floorBounds.minY
  });
}

function getNextRoomNumber(floor: Floor): number {
  const roomIds = new Set(floor.rooms.map((placement) => placement.roomId));
  let roomNumber = floor.rooms.length + 1;

  while (roomIds.has(`room-${roomNumber}`)) {
    roomNumber += 1;
  }

  return roomNumber;
}
