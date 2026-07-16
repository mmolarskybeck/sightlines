import { describe, expect, it } from "vitest";
import { createSampleProject } from "./sample/sampleProject";
import type { SavedView, SavedViewPose } from "./project";
import {
  isDegeneratePose,
  resolveSavedViewRoomId,
  resolveSavedViewRoomLabel
} from "./savedViews";

// The sample "Main Gallery" (room-main) spans 0..28ft × 0..18ft in floor mm,
// with a zero offset/rotation placement, so world (x, z) equals floor mm / 1000.
// (4, 2.5) is comfortably inside; (50, 50) is far outside.
const INSIDE = { x: 4, z: 2.5 };
const OUTSIDE = { x: 50, z: 50 };

function poseFrom(
  position: { x: number; z: number },
  target: { x: number; z: number }
): SavedViewPose {
  return {
    position: { x: position.x, y: 1.6, z: position.z },
    target: { x: target.x, y: 1.6, z: target.z }
  };
}

describe("isDegeneratePose", () => {
  it("accepts a finite pose with distinct camera and target", () => {
    expect(isDegeneratePose(poseFrom(INSIDE, OUTSIDE))).toBe(false);
  });

  it("flags a non-finite position component", () => {
    const pose = poseFrom(INSIDE, OUTSIDE);
    pose.position.x = Number.POSITIVE_INFINITY;
    expect(isDegeneratePose(pose)).toBe(true);
  });

  it("flags a NaN target component", () => {
    const pose = poseFrom(INSIDE, OUTSIDE);
    pose.target.z = Number.NaN;
    expect(isDegeneratePose(pose)).toBe(true);
  });

  it("flags a camera and target that effectively coincide", () => {
    expect(isDegeneratePose(poseFrom(INSIDE, INSIDE))).toBe(true);
  });
});

describe("resolveSavedViewRoomId", () => {
  it("returns the room containing the camera", () => {
    const project = createSampleProject();
    expect(resolveSavedViewRoomId(poseFrom(INSIDE, OUTSIDE), project.floor.rooms)).toBe(
      "room-main"
    );
  });

  it("falls back to the room containing the target when the camera is outside", () => {
    const project = createSampleProject();
    expect(resolveSavedViewRoomId(poseFrom(OUTSIDE, INSIDE), project.floor.rooms)).toBe(
      "room-main"
    );
  });

  it("returns undefined when both camera and target are outside every room", () => {
    const project = createSampleProject();
    expect(
      resolveSavedViewRoomId(poseFrom(OUTSIDE, OUTSIDE), project.floor.rooms)
    ).toBeUndefined();
  });
});

describe("resolveSavedViewRoomLabel", () => {
  function viewFor(roomId: string | undefined): SavedView {
    return {
      id: "view-1",
      ordinal: 1,
      title: "Saved view 1",
      roomId,
      pose: poseFrom(INSIDE, OUTSIDE),
      createdAt: "2026-07-16T00:00:00.000Z"
    };
  }

  it("resolves the room's current name", () => {
    const project = createSampleProject();
    expect(resolveSavedViewRoomLabel(project, viewFor("room-main"))).toBe("Main Gallery");
  });

  it("reflects a live rename rather than any cached label", () => {
    const project = createSampleProject();
    project.floor.rooms[0].room.name = "Gallery 2";
    expect(resolveSavedViewRoomLabel(project, viewFor("room-main"))).toBe("Gallery 2");
  });

  it("returns undefined when the stored room id no longer resolves", () => {
    const project = createSampleProject();
    project.floor.rooms = [];
    expect(resolveSavedViewRoomLabel(project, viewFor("room-main"))).toBeUndefined();
  });

  it("returns undefined when the view has no room id", () => {
    const project = createSampleProject();
    expect(resolveSavedViewRoomLabel(project, viewFor(undefined))).toBeUndefined();
  });
});
