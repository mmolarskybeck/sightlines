import { OrbitControls } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import { Box3, MathUtils, PerspectiveCamera, Plane, TOUCH, Vector2, Vector3 } from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { getArtworkOuterDimensionsMm } from "../../../domain/framing";
import { parseFaceWallId } from "../../../domain/geometry/freestandingWalls";
import {
  deriveScene3d,
  wallInwardNormal,
  type Room3d,
  type Scene3d,
  type WallArtwork3d,
  type WallPanel3d
} from "../../../domain/geometry/scene3d";
import type { Artwork, Project } from "../../../domain/project";
import { fitDistance } from "./cameraFit";
import {
  ORBIT_MAX_DISTANCE,
  ORBIT_MIN_DISTANCE,
  clampFocusDistance,
  eyeLevelArtworkDistanceMm,
  eyeLevelWallDistanceMm,
  sightlineOccluders,
  type SightlineSegment,
  normalizeWheelDeltaY,
  travelStepDistance,
  updateCameraClipping,
  zoomFactorFromDelta
} from "./cameraNav";
import { MM_TO_WORLD } from "./coordinates";
import { SceneRooms } from "./SceneRooms";
import { SCENE_BACKGROUND_COLOR } from "./tokens";

// Entry framing: above and outside the room, looking down at ~40° elevation
// from a corner (spec §4.2).
const FIT_ELEVATION_DEG = 40;
const FIT_AZIMUTH_DEG = 45;
const CAMERA_FOV_DEG = 50;

// Preset flights are quick enough to stay an instrument, slow enough to keep
// spatial continuity.
const FLIGHT_MS = 600;

// A click that traveled further than this (px) was an orbit drag, not a
// selection (browsers still fire click after a drag on the same element).
const CLICK_DRAG_TOLERANCE_PX = 6;
const ACTIVE_FRAME_GAP_MAX_MS = 100;
const FRAME_SAMPLE_LIMIT = 256;

type CameraPose = { position: Vector3; target: Vector3 };

export type RendererBenchmarkMetrics = {
  sceneDerivationMs: number;
  roomCount: number;
  wallCount: number;
  artworkCount: number;
  canvasCreatedAt: number;
  firstFrameAt: number | null;
  idleGapCount: number;
  entryMs: number | null;
  frameCount: number;
  frameTimeP50Ms: number | null;
  frameTimeP95Ms: number | null;
  maxActiveFrameTimeMs: number | null;
};

declare global {
  interface Window {
    __sightlinesRendererBenchmark?: {
      getMetrics: () => RendererBenchmarkMetrics | null;
      reset: () => void;
    };
  }
}

const benchmarkMetrics: RendererBenchmarkMetrics = {
  sceneDerivationMs: 0,
  roomCount: 0,
  wallCount: 0,
  artworkCount: 0,
  canvasCreatedAt: 0,
  firstFrameAt: null,
  idleGapCount: 0,
  entryMs: null,
  frameCount: 0,
  frameTimeP50Ms: null,
  frameTimeP95Ms: null,
  maxActiveFrameTimeMs: null
};
const activeFrameSamplesMs: number[] = [];

const benchmarkEnabled =
  typeof window !== "undefined" &&
  new URLSearchParams(window.location.search).get("benchmark") === "renderer";

function resetBenchmarkMetrics() {
  Object.assign(benchmarkMetrics, {
    sceneDerivationMs: 0,
    roomCount: 0,
    wallCount: 0,
    artworkCount: 0,
    canvasCreatedAt: 0,
    firstFrameAt: null,
    idleGapCount: 0,
    entryMs: null,
    frameCount: 0,
    frameTimeP50Ms: null,
    frameTimeP95Ms: null,
    maxActiveFrameTimeMs: null
  });
  activeFrameSamplesMs.length = 0;
}

function recordFrameSample(frameTimeMs: number) {
  if (frameTimeMs > ACTIVE_FRAME_GAP_MAX_MS) {
    benchmarkMetrics.idleGapCount += 1;
    return;
  }
  activeFrameSamplesMs.push(frameTimeMs);
  if (activeFrameSamplesMs.length > FRAME_SAMPLE_LIMIT) activeFrameSamplesMs.shift();
  const sorted = activeFrameSamplesMs.slice().sort((a, b) => a - b);
  const percentile = (fraction: number) =>
    sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * fraction))] ?? null;
  benchmarkMetrics.frameCount = sorted.length;
  benchmarkMetrics.frameTimeP50Ms = percentile(0.5);
  benchmarkMetrics.frameTimeP95Ms = percentile(0.95);
  benchmarkMetrics.maxActiveFrameTimeMs = sorted.at(-1) ?? null;
}

function BenchmarkFrameProbe() {
  const lastFrameAt = useRef<number | null>(null);
  useFrame(() => {
    const now = performance.now();
    if (benchmarkMetrics.firstFrameAt === null) {
      benchmarkMetrics.firstFrameAt = now;
      benchmarkMetrics.entryMs = now - benchmarkMetrics.canvasCreatedAt;
    }
    if (lastFrameAt.current !== null) {
      recordFrameSample(now - lastFrameAt.current);
    }
    lastFrameAt.current = now;
  });
  return null;
}

// Every selectable wall surface in a room: perimeter walls plus partition
// faces (spec §7.1). Eye-level lookup and camera framing both scan this.
function roomWallPanels(room: Room3d): WallPanel3d[] {
  return [...room.walls, ...room.freestandingWalls.flatMap((partition) => partition.faces)];
}

type CameraRigApi = {
  overview: () => void;
  eyeLevel: (
    wall: WallPanel3d,
    artwork: WallArtwork3d | null,
    eyeHeightMm: number
  ) => ReadonlySet<string>;
  focus: (target: Vector3) => void;
  frameRoom: (room: Room3d) => void;
  focusFloorUnderCursor: (clientX: number, clientY: number) => void;
};

export type ThreeDViewActions = {
  overview: () => void;
  eyeLevel: () => void;
  focusSelection: () => void;
};

// World-space bounding box of one room's floor + wall heights, including its
// freestanding partitions. Empty (isEmpty()) when the room has no geometry.
function roomBounds(room: Room3d): Box3 {
  const box = new Box3();
  const maxWallHeightMm = room.walls.reduce(
    (max, wall) => Math.max(max, wall.heightMm),
    0
  );
  for (const point of room.floorPolygon) {
    box.expandByPoint(
      new Vector3(point.xMm * MM_TO_WORLD, 0, point.yMm * MM_TO_WORLD)
    );
    box.expandByPoint(
      new Vector3(
        point.xMm * MM_TO_WORLD,
        maxWallHeightMm * MM_TO_WORLD,
        point.yMm * MM_TO_WORLD
      )
    );
  }

  // A partition can be taller than the room's walls, and its endpoints can sit
  // outside the room polygon (advisory, spec §6.4) — so frame by its cap
  // outline and heightMm explicitly, or the fit derived from floors alone could
  // clip it.
  for (const partition of room.freestandingWalls) {
    const { start, end, heightMm } = partition.capOutline;
    for (const point of [start, end]) {
      box.expandByPoint(new Vector3(point.xMm * MM_TO_WORLD, 0, point.yMm * MM_TO_WORLD));
      box.expandByPoint(
        new Vector3(point.xMm * MM_TO_WORLD, heightMm * MM_TO_WORLD, point.yMm * MM_TO_WORLD)
      );
    }
  }

  return box;
}

// World-space bounding box of the union of every room. null when there is
// nothing to frame.
function sceneBounds(scene: Scene3d): Box3 | null {
  const box = new Box3();
  let hasPoint = false;

  for (const room of scene.rooms) {
    const bounds = roomBounds(room);
    if (bounds.isEmpty()) continue;
    box.union(bounds);
    hasPoint = true;
  }

  return hasPoint ? box : null;
}

// The fitted overview pose: the union of all room floor polygons framed from
// a corner at ~40° elevation, solved against the real frustum (cameraFit.ts).
function overviewPose(scene: Scene3d, aspect: number): CameraPose | null {
  const bounds = sceneBounds(scene);
  if (!bounds) return null;

  const target = bounds.getCenter(new Vector3());
  const elevation = MathUtils.degToRad(FIT_ELEVATION_DEG);
  const azimuth = MathUtils.degToRad(FIT_AZIMUTH_DEG);
  const direction = new Vector3(
    Math.cos(elevation) * Math.sin(azimuth),
    Math.sin(elevation),
    Math.cos(elevation) * Math.cos(azimuth)
  );
  const distance = fitDistance(bounds, direction, CAMERA_FOV_DEG, aspect);
  const position = target.clone().addScaledVector(direction, distance);
  return { position, target };
}

// Every candidate occluder in the scene, floor-space: perimeter walls carry
// their inward normal (single-sided — seen from outside they're already
// back-face culled, WallPanel's dollhouse note), partition slabs are opaque
// from both sides so they carry none.
function sceneSightlineSegments(scene: Scene3d): SightlineSegment[] {
  return scene.rooms.flatMap((room) => [
    ...room.walls.map((wall) => ({
      id: wall.wallId,
      start: wall.start,
      end: wall.end,
      facing: wallInwardNormal(wall)
    })),
    ...room.freestandingWalls.map((partition) => ({
      id: partition.freestandingWallId,
      start: partition.capOutline.start,
      end: partition.capOutline.end
    }))
  ]);
}

// A standing viewpoint facing the SELECTED thing (spec §4.2): the whole wall
// framed in the frustum when the wall drove the preset, the work plus
// breathing room when a specific artwork did — camera level at the project's
// eye height either way. The standoff comes from the framing fit alone;
// anything crossing the sightline (partition slabs, interior-facing walls in
// an L-shaped room) is returned for the render layer to GHOST rather than the
// camera creeping closer — position is framing's job, visibility is
// ghosting's. The fit may stand outside the room; the dollhouse back-face
// culling already opens that view.
function eyeLevelView(
  scene: Scene3d,
  wall: WallPanel3d,
  artwork: WallArtwork3d | null,
  eyeHeightMm: number,
  aspect: number
): { pose: CameraPose; ghostedIds: ReadonlySet<string> } {
  const { xMm: normalX, yMm: normalY } = wallInwardNormal(wall);
  const wallLengthMm = Math.hypot(
    wall.end.xMm - wall.start.xMm,
    wall.end.yMm - wall.start.yMm
  );

  let targetFloor: { xMm: number; yMm: number };
  let targetHeightMm: number;
  let distanceMm: number;
  if (artwork) {
    const ux = (wall.end.xMm - wall.start.xMm) / wallLengthMm;
    const uy = (wall.end.yMm - wall.start.yMm) / wallLengthMm;
    targetFloor = {
      xMm: wall.start.xMm + ux * artwork.xMm,
      yMm: wall.start.yMm + uy * artwork.xMm
    };
    // Aim at the work's actual hang point — a slight upward gaze at a
    // high-hung work is the natural standing read.
    targetHeightMm = artwork.yMm;
    distanceMm = eyeLevelArtworkDistanceMm(artwork.widthMm, artwork.heightMm);
  } else {
    targetFloor = {
      xMm: (wall.start.xMm + wall.end.xMm) / 2,
      yMm: (wall.start.yMm + wall.end.yMm) / 2
    };
    targetHeightMm = eyeHeightMm;
    distanceMm = eyeLevelWallDistanceMm(
      wallLengthMm,
      wall.heightMm,
      eyeHeightMm,
      MathUtils.degToRad(CAMERA_FOV_DEG),
      aspect
    );
  }

  const cameraFloor = {
    xMm: targetFloor.xMm + normalX * distanceMm,
    yMm: targetFloor.yMm + normalY * distanceMm
  };
  const pose: CameraPose = {
    target: new Vector3(
      targetFloor.xMm * MM_TO_WORLD,
      targetHeightMm * MM_TO_WORLD,
      targetFloor.yMm * MM_TO_WORLD
    ),
    position: new Vector3(
      cameraFloor.xMm * MM_TO_WORLD,
      eyeHeightMm * MM_TO_WORLD,
      cameraFloor.yMm * MM_TO_WORLD
    )
  };

  // Belt-and-braces exclusion: the viewed wall sits AT the target (t≈1, which
  // the occluder test already rejects), and a viewed partition face's own
  // slab sits behind the ray start.
  const faceRef = parseFaceWallId(wall.wallId);
  const exclude = new Set(
    faceRef ? [wall.wallId, faceRef.freestandingWallId] : [wall.wallId]
  );
  const ghostedIds = new Set(
    sightlineOccluders(cameraFloor, targetFloor, sceneSightlineSegments(scene), exclude)
  );
  return { pose, ghostedIds };
}

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

const FLOOR_PLANE = new Plane(new Vector3(0, 1, 0), 0);

// Cursor position -> NDC on the canvas, for raycasts driven by native events.
function cursorNdc(canvas: HTMLCanvasElement, clientX: number, clientY: number): Vector2 {
  const rect = canvas.getBoundingClientRect();
  return new Vector2(
    ((clientX - rect.left) / rect.width) * 2 - 1,
    -((clientY - rect.top) / rect.height) * 2 + 1
  );
}

// Owns the camera: jumps to the fitted overview on entry/project switch
// (deliberately NOT on scene edits — spec §4.2; Overview reclaims framing),
// and animates the two presets. Both presets end in free orbit.
function CameraRig({
  scene,
  fitKey,
  apiRef
}: {
  scene: Scene3d;
  fitKey: string;
  apiRef: React.MutableRefObject<CameraRigApi | null>;
}) {
  const camera = useThree((state) => state.camera);
  const controls = useThree((state) => state.controls) as OrbitControlsImpl | null;
  const raycaster = useThree((state) => state.raycaster);
  const gl = useThree((state) => state.gl);
  const invalidate = useThree((state) => state.invalidate);

  // Latest scene without making it an effect dependency — reads current
  // geometry when a fit/preset runs, but never re-runs the entry fit on edits.
  const sceneRef = useRef(scene);
  sceneRef.current = scene;

  const flightRef = useRef<{
    startedAt: number;
    from: CameraPose;
    to: CameraPose;
  } | null>(null);

  const aspect = () => (camera instanceof PerspectiveCamera ? camera.aspect : 1);

  const applyPose = (pose: CameraPose) => {
    camera.position.copy(pose.position);
    updateCameraClipping(camera, pose.position.distanceTo(pose.target));
    camera.lookAt(pose.target);
    if (controls) {
      controls.target.copy(pose.target);
      controls.update();
    }
    invalidate();
  };

  const flyTo = (pose: CameraPose) => {
    flightRef.current = {
      startedAt: performance.now(),
      from: {
        position: camera.position.clone(),
        target: controls
          ? controls.target.clone()
          : camera.getWorldDirection(new Vector3()).add(camera.position)
      },
      to: pose
    };
    invalidate();
  };

  useFrame(() => {
    const flight = flightRef.current;
    if (!flight) return;
    const t = Math.min(1, (performance.now() - flight.startedAt) / FLIGHT_MS);
    const eased = easeInOutCubic(t);
    camera.position.lerpVectors(flight.from.position, flight.to.position, eased);
    if (controls) {
      controls.target.lerpVectors(flight.from.target, flight.to.target, eased);
      controls.update();
    } else {
      camera.lookAt(flight.to.target);
    }
    if (t >= 1) {
      flightRef.current = null;
      applyPose(flight.to);
    } else {
      // demand frameloop: keep the animation chain alive.
      invalidate();
    }
  });

  // Refs must not be written during render; publish the preset API after
  // commit (no deps — closures read refs/three objects, never stale props).
  useEffect(() => {
    const focusPoint = (target: Vector3) => {
      // Keep the current view direction, but pull the standoff into the
      // focus envelope so a far overview actually flies in (spec §4.2).
      const currentTarget = controls?.target.clone() ?? camera.position.clone();
      const offset = camera.position.clone().sub(currentTarget);
      if (offset.lengthSq() < 0.0001) offset.set(0, 2, 2);
      offset.setLength(clampFocusDistance(offset.length()));
      flyTo({ target, position: target.clone().add(offset) });
    };

    apiRef.current = {
      overview: () => {
        const pose = overviewPose(sceneRef.current, aspect());
        if (pose) flyTo(pose);
      },
      focus: focusPoint,
      focusFloorUnderCursor: (clientX, clientY) => {
        // Empty-space double-click: nothing under the cursor to hit, so fly
        // to the y=0 floor point on the cursor ray instead of silently
        // no-oping (a ray missing the floor entirely stays a no-op).
        raycaster.setFromCamera(cursorNdc(gl.domElement, clientX, clientY), camera);
        const point = new Vector3();
        if (raycaster.ray.intersectPlane(FLOOR_PLANE, point)) focusPoint(point);
      },
      frameRoom: (room) => {
        const bounds = roomBounds(room);
        if (bounds.isEmpty()) return;
        const currentTarget = controls?.target.clone() ?? camera.position.clone();
        const direction = camera.position.clone().sub(currentTarget);
        if (direction.lengthSq() < 0.0001) direction.set(1, 1, 1);
        direction.normalize();
        const distance = fitDistance(bounds, direction, CAMERA_FOV_DEG, aspect());
        const target = bounds.getCenter(new Vector3());
        flyTo({ target, position: target.clone().addScaledVector(direction, distance) });
      },
      eyeLevel: (wall, artwork, eyeHeightMm) => {
        const view = eyeLevelView(sceneRef.current, wall, artwork, eyeHeightMm, aspect());
        flyTo(view.pose);
        return view.ghostedIds;
      }
    };
  });

  useEffect(() => {
    const pose = overviewPose(sceneRef.current, aspect());
    if (pose) applyPose(pose);
    // fitKey / controls only: refit on entry + project switch, and once when
    // OrbitControls first registers. Not on scene edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey, controls]);

  return null;
}

// Takes over wheel zoom from OrbitControls (three-stdlib's wheel dolly is
// sign-only, so trackpads feel dead): a delta-proportional dolly toward the
// world point under the cursor. Listens in the CAPTURE phase on the canvas's
// parent so it fires before OrbitControls' own canvas listener, and swallows
// the event so the two never fight.
function CursorZoom() {
  const camera = useThree((state) => state.camera);
  const controls = useThree((state) => state.controls) as OrbitControlsImpl | null;
  const raycaster = useThree((state) => state.raycaster);
  const scene = useThree((state) => state.scene);
  const gl = useThree((state) => state.gl);
  const invalidate = useThree((state) => state.invalidate);

  useEffect(() => {
    const parent = gl.domElement.parentElement;
    if (!parent || !controls) return;

    const point = new Vector3();

    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      event.stopPropagation();

      const currentDistance = camera.position.distanceTo(controls.target);
      let factor = zoomFactorFromDelta(normalizeWheelDeltaY(event));
      // Clamp the resulting orbit radius to the dolly envelope; scale the step
      // to land exactly on the bound rather than skipping it.
      const desired = currentDistance * factor;
      const clamped = MathUtils.clamp(desired, ORBIT_MIN_DISTANCE, ORBIT_MAX_DISTANCE);
      if (clamped !== desired && currentDistance > 0) factor = clamped / currentDistance;
      if (Math.abs(factor - 1) < 1e-6) return;

      // World point under the cursor: nearest mesh hit, else the y=0 floor,
      // else the current orbit target.
      raycaster.setFromCamera(cursorNdc(gl.domElement, event.clientX, event.clientY), camera);
      const hit = raycaster.intersectObjects(scene.children, true)[0];
      if (hit) {
        point.copy(hit.point);
      } else if (!raycaster.ray.intersectPlane(FLOOR_PLANE, point)) {
        point.copy(controls.target);
      }

      // Lerp BOTH camera and target toward the point by the same alpha: the
      // point stays visually fixed while the orbit radius shrinks by `factor`
      // (negative alpha extrapolates for zoom-out).
      const alpha = 1 - factor;
      camera.position.lerp(point, alpha);
      controls.target.lerp(point, alpha);
      updateCameraClipping(camera, camera.position.distanceTo(controls.target));
      controls.update();
      invalidate();
    };

    parent.addEventListener("wheel", onWheel, { passive: false, capture: true });
    return () => parent.removeEventListener("wheel", onWheel, { capture: true });
  }, [camera, controls, gl, invalidate, raycaster, scene]);

  return null;
}

// Continuous WASD / arrow travel (spec §4.2): pure translation of camera and
// target together, so orbit radius is unchanged. Speed scales with zoom — a
// walk when close, a glide when zoomed out (envelope in cameraNav.ts).
const TRAVEL_CODES = new Set([
  "KeyW",
  "KeyS",
  "KeyA",
  "KeyD",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight"
]);
const WORLD_UP = new Vector3(0, 1, 0);

// Typing in an inspector field must not drive the camera.
function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    target.isContentEditable
  );
}

function KeyboardTravel() {
  const camera = useThree((state) => state.camera);
  const controls = useThree((state) => state.controls) as OrbitControlsImpl | null;
  const invalidate = useThree((state) => state.invalidate);

  const pressed = useRef<Set<string>>(new Set());
  const shift = useRef(false);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      shift.current = event.shiftKey;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (isEditableTarget(event.target)) return;
      if (!TRAVEL_CODES.has(event.code)) return;
      event.preventDefault();
      pressed.current.add(event.code);
      invalidate();
    };
    const onKeyUp = (event: KeyboardEvent) => {
      shift.current = event.shiftKey;
      pressed.current.delete(event.code);
    };
    const onBlur = () => {
      pressed.current.clear();
      shift.current = false;
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    };
  }, [invalidate]);

  const forward = useRef(new Vector3());
  const right = useRef(new Vector3());
  const move = useRef(new Vector3());

  useFrame((_, delta) => {
    if (!controls) return;
    const codes = pressed.current;
    if (codes.size === 0) return;

    let forwardInput = 0;
    let rightInput = 0;
    if (codes.has("KeyW") || codes.has("ArrowUp")) forwardInput += 1;
    if (codes.has("KeyS") || codes.has("ArrowDown")) forwardInput -= 1;
    if (codes.has("KeyD") || codes.has("ArrowRight")) rightInput += 1;
    if (codes.has("KeyA") || codes.has("ArrowLeft")) rightInput -= 1;
    if (forwardInput === 0 && rightInput === 0) {
      invalidate();
      return;
    }

    // Forward = view direction flattened onto the floor. Looking (near)
    // straight down leaves no projection, so fall back to screen-up flattened
    // onto the floor.
    camera.getWorldDirection(forward.current).setY(0);
    if (forward.current.lengthSq() < 1e-6) {
      forward.current.copy(WORLD_UP).applyQuaternion(camera.quaternion).setY(0);
    }
    if (forward.current.lengthSq() < 1e-6) {
      invalidate();
      return;
    }
    forward.current.normalize();
    right.current.crossVectors(forward.current, WORLD_UP).normalize();

    const distance = camera.position.distanceTo(controls.target);

    move.current
      .copy(forward.current)
      .multiplyScalar(forwardInput)
      .addScaledVector(right.current, rightInput)
      .normalize()
      .multiplyScalar(travelStepDistance(distance, shift.current, delta));

    camera.position.add(move.current);
    controls.target.add(move.current);
    controls.update();
    invalidate();
  });

  return null;
}

// Eye-level target wall priority (spec §4.2): selected wall, then the wall
// holding the selected artwork placement, then the longest wall, then the
// first.
// A selected ARTWORK takes precedence over the wall context: the wall context
// lingers from placement, but a picked work is what the user is judging — eye
// level frames it, not its wall's midpoint. Wall selection frames the whole
// wall; with nothing selected, the longest wall stands in.
function pickEyeLevelWall(
  scene: Scene3d,
  selectedWallId: string | null,
  selectedObjectIds: string[],
  selectedArtworkId: string | null
): { wall: WallPanel3d; artwork: WallArtwork3d | null } | null {
  const walls = scene.rooms.flatMap(roomWallPanels);
  if (walls.length === 0) return null;

  for (const wall of walls) {
    const artwork = wall.artworks.find(
      (candidate) =>
        selectedObjectIds.includes(candidate.objectId) ||
        candidate.artworkId === selectedArtworkId
    );
    if (artwork) return { wall, artwork };
  }

  if (selectedWallId) {
    const wall = walls.find((w) => w.wallId === selectedWallId);
    if (wall) return { wall, artwork: null };
  }

  const longest = walls.reduce((best, wall) => {
    const length = Math.hypot(
      wall.end.xMm - wall.start.xMm,
      wall.end.yMm - wall.start.yMm
    );
    const bestLength = Math.hypot(
      best.end.xMm - best.start.xMm,
      best.end.yMm - best.start.yMm
    );
    return length > bestLength ? wall : best;
  }, walls[0]);
  return { wall: longest, artwork: null };
}

// The eye-level standoff (eyeLevelArtworkDistanceMm, cameraNav.ts) must clear
// the RENDERED mesh, which ArtworkPlane widens by mat+frame at its own render
// boundary (framingLayout) from the artwork record — scene3d's WallArtwork3d
// stays image-sized per the framing contract (deriveScene3d does not import
// framing.ts). So the standoff widens here, at the one place the focused
// artwork's record is resolved for this purpose, rather than in scene3d or in
// eyeLevelView itself: nothing else consumes scene3d's artwork dims besides
// ArtworkPlane's own self-widening, so widening scene3d's persisted-shaped
// data would move the seam for no other consumer. Pulled out as a pure
// function (identity when unframed) so the widening is unit-testable without
// a three.js/DOM harness.
export function resolveEyeLevelStandoffArtwork(
  artwork: WallArtwork3d | null,
  artworksById: ReadonlyMap<string, Artwork>
): WallArtwork3d | null {
  if (!artwork) return null;

  const record = artworksById.get(artwork.artworkId);
  const outer = getArtworkOuterDimensionsMm(
    artwork.widthMm,
    artwork.heightMm,
    record?.matWidthMm,
    record?.frame
  );

  if (outer.widthMm === artwork.widthMm && outer.heightMm === artwork.heightMm) {
    return artwork;
  }

  return { ...artwork, ...outer };
}

function wallFocusTarget(wall: WallPanel3d): Vector3 {
  return new Vector3(
    ((wall.start.xMm + wall.end.xMm) / 2) * MM_TO_WORLD,
    (wall.heightMm / 2) * MM_TO_WORLD,
    ((wall.start.yMm + wall.end.yMm) / 2) * MM_TO_WORLD
  );
}

// A selected wall / artwork / floor object focuses on a point (clamped-distance
// flight); a selected ROOM frames its whole bounding box instead (spec §4.2).
type FocusSelection =
  | { kind: "point"; point: Vector3 }
  | { kind: "room"; room: Room3d };

function resolveFocusSelection(
  scene: Scene3d,
  selectedRoomId: string | null,
  selectedWallId: string | null,
  selectedObjectIds: string[],
  selectedArtworkId: string | null
): FocusSelection | null {
  const walls = scene.rooms.flatMap(roomWallPanels);
  const selectedWall = selectedWallId
    ? walls.find((wall) => wall.wallId === selectedWallId)
    : undefined;
  if (selectedWall) return { kind: "point", point: wallFocusTarget(selectedWall) };

  const artworkWall = walls.find((wall) =>
    wall.artworks.some(
      (artwork) =>
        selectedObjectIds.includes(artwork.objectId) ||
        artwork.artworkId === selectedArtworkId
    )
  );
  if (artworkWall) return { kind: "point", point: wallFocusTarget(artworkWall) };

  const floorObject = scene.floorObjects.find(
    (object) =>
      selectedObjectIds.includes(object.objectId) ||
      object.artworkId === selectedArtworkId
  );
  if (floorObject) {
    return {
      kind: "point",
      point: new Vector3(
        floorObject.xMm * MM_TO_WORLD,
        floorObject.heightMm * 0.5 * MM_TO_WORLD,
        floorObject.yMm * MM_TO_WORLD
      )
    };
  }

  const selectedRoom = selectedRoomId
    ? scene.rooms.find((room) => room.roomId === selectedRoomId)
    : undefined;
  return selectedRoom ? { kind: "room", room: selectedRoom } : null;
}

// Same idiom as the Plan/Elevation empty states: an aria-hidden glyph (a cube,
// shorthand for the 3D room) over the readable copy.
function ThreeDEmptyState() {
  return (
    <div className="drawing-surface-empty">
      <div className="canvas-empty">
        <svg
          aria-hidden="true"
          className="canvas-empty-glyph"
          focusable="false"
          viewBox="0 0 120 84"
        >
          <path d="M60 14 104 34 104 60 60 80 16 60 16 34Z" />
          <path d="M60 14 60 80" />
          <path d="M16 34 60 54 104 34" />
        </svg>
        <p className="empty-copy">Add a room to see the 3D preview.</p>
      </div>
    </div>
  );
}

export function ThreeDView({
  project,
  artworksById,
  getBlob,
  selectedObjectIds,
  selectedArtworkId,
  selectedRoomId,
  selectedWallId,
  onSelectWall,
  onSelectObject,
  onClearSelection,
  actionsRef
}: {
  project: Project;
  artworksById: ReadonlyMap<string, Artwork>;
  getBlob: (key: string) => Promise<Blob>;
  selectedObjectIds: string[];
  selectedArtworkId: string | null;
  selectedRoomId: string | null;
  selectedWallId: string | null;
  onSelectWall: (wallId: string) => void;
  onSelectObject: (objectId: string, opts: { additive: boolean }) => void;
  onClearSelection: () => void;
  actionsRef?: { current: ThreeDViewActions | null };
}) {
  const benchmarkProjectId = useRef<string | null>(null);
  if (benchmarkEnabled && benchmarkProjectId.current !== project.id) {
    resetBenchmarkMetrics();
    benchmarkProjectId.current = project.id;
  }
  const scene = useMemo(
    () => {
      const startedAt = performance.now();
      const nextScene = deriveScene3d(project, artworksById);
      benchmarkMetrics.sceneDerivationMs = performance.now() - startedAt;
      benchmarkMetrics.roomCount = nextScene.rooms.length;
      benchmarkMetrics.wallCount = nextScene.rooms.reduce(
        (count, room) => count + room.walls.length + room.freestandingWalls.length * 2,
        0
      );
      benchmarkMetrics.artworkCount =
        nextScene.rooms.reduce(
          (count, room) =>
            count +
            room.walls.reduce((wallCount, wall) => wallCount + wall.artworks.length, 0) +
            room.freestandingWalls.reduce(
              (partitionCount, partition) =>
                partitionCount + partition.faces.reduce((faceCount, face) => faceCount + face.artworks.length, 0),
              0
            ),
          0
        ) + nextScene.floorObjects.filter((object) => object.kind === "artwork").length;
      return nextScene;
    },
    [project, artworksById]
  );
  const rigApi = useRef<CameraRigApi | null>(null);
  // Where the pointer went down, to tell a click from an orbit-drag release
  // in onPointerMissed (mesh handlers get the same guard via event.delta).
  const pointerDownAt = useRef<{ x: number; y: number } | null>(null);
  // Walls/partitions ghosted because they cross the eye-level sightline. The
  // session ref keeps ghosting live across orbits (each orbit-end recomputes
  // the set from the new sightline) until another preset ends the session.
  const [ghostedWallIds, setGhostedWallIds] = useState<ReadonlySet<string>>(
    () => new Set()
  );
  const ghostSessionRef = useRef(false);
  const endGhostSession = () => {
    ghostSessionRef.current = false;
    setGhostedWallIds((current) => (current.size === 0 ? current : new Set()));
  };

  useEffect(() => {
    if (!benchmarkEnabled) return;
    window.__sightlinesRendererBenchmark = {
      getMetrics: () => ({ ...benchmarkMetrics }),
      reset: resetBenchmarkMetrics
    };
    return () => {
      delete window.__sightlinesRendererBenchmark;
    };
  }, []);

  useEffect(() => {
    if (!actionsRef) return;
    if (scene.rooms.length === 0) {
      actionsRef.current = null;
      return;
    }

    actionsRef.current = {
      overview: () => {
        endGhostSession();
        rigApi.current?.overview();
      },
      eyeLevel: () => {
        const picked = pickEyeLevelWall(
          scene,
          selectedWallId,
          selectedObjectIds,
          selectedArtworkId
        );
        if (picked) {
          const ghosted = rigApi.current?.eyeLevel(
            picked.wall,
            resolveEyeLevelStandoffArtwork(picked.artwork, artworksById),
            project.defaultCenterlineHeightMm
          );
          ghostSessionRef.current = true;
          setGhostedWallIds(ghosted ?? new Set());
        }
      },
      focusSelection: () => {
        const selection = resolveFocusSelection(
          scene,
          selectedRoomId,
          selectedWallId,
          selectedObjectIds,
          selectedArtworkId
        );
        if (!selection) return;
        endGhostSession();
        if (selection.kind === "room") rigApi.current?.frameRoom(selection.room);
        else rigApi.current?.focus(selection.point);
      }
    };

    return () => {
      actionsRef.current = null;
    };
  }, [
    actionsRef,
    artworksById,
    project.defaultCenterlineHeightMm,
    scene,
    selectedArtworkId,
    selectedObjectIds,
    selectedRoomId,
    selectedWallId
  ]);

  if (scene.rooms.length === 0) {
    return <ThreeDEmptyState />;
  }

  return (
    // The 3D viewport carries its own quiet grey ground (SCENE_BACKGROUND_COLOR,
    // set on the three.js scene below) so near-white walls read as lit volumes.
    // The surrounding workspace chrome stays white — this greys only the WebGL
    // viewport, not the app.
    <div
      className="three-view"
      onPointerDown={(event) => {
        pointerDownAt.current = { x: event.clientX, y: event.clientY };
      }}
    >
      <Canvas
        frameloop="demand"
        dpr={[1, 2]}
        // `flat` = NoToneMapping. R3F's default ACESFilmic compresses a lit
        // near-white Lambert wall to ~0.9 sRGB while a plain-Color scene
        // background is cleared WITHOUT tone mapping — so the walls rendered
        // darker than the grey backdrop and the value scheme read inverted.
        // This flat-lit architectural scene needs no filmic curve; artwork
        // textures already opt out (meshBasicMaterial toneMapped={false}), so
        // their colors are unchanged. Light intensities below are tuned for
        // the linear->sRGB-only pipeline (no face may exceed 1.0 or it clips).
        flat
        gl={{ alpha: true, antialias: true }}
        camera={{ fov: CAMERA_FOV_DEG, near: 0.01, far: 1000, position: [4, 4, 4] }}
        onCreated={(state) => {
          if (benchmarkEnabled) benchmarkMetrics.canvasCreatedAt = performance.now();
          if (import.meta.env.DEV) {
            // Dev-only escape hatch so browser-driven verification (and
            // debugging) can reach the LIVE R3F state (the state object is
            // replaced on internal updates, so expose the getter, not a
            // snapshot); stripped from prod builds.
            (window as unknown as { __sightlines3d?: unknown }).__sightlines3d =
              state.get;
          }
        }}
        onPointerMissed={(event) => {
          // r3f fires this for dblclick misses too: a double-click on the
          // empty space between rooms focuses the floor point under the
          // cursor, same fallback the wheel dolly uses (spec §4.2).
          if (event.type === "dblclick") {
            rigApi.current?.focusFloorUnderCursor(event.clientX, event.clientY);
            return;
          }
          // Empty space clears the object selection (spec §4.3) — but only
          // for true clicks, not the release of an orbit drag.
          const down = pointerDownAt.current;
          const moved = down
            ? Math.hypot(event.clientX - down.x, event.clientY - down.y)
            : 0;
          if (moved <= CLICK_DRAG_TOLERANCE_PX) onClearSelection();
        }}
      >
        {/* Quiet cool-grey ground for the viewport (white walls on grey). */}
        <color attach="background" args={[SCENE_BACKGROUND_COLOR]} />
        {/* Soft, shadowless lighting (spec §6.1): flat ambient plus one gentle
            high front-left key so walls shade apart and read as volume.
            Tuned for NoToneMapping (see `flat` above) AND three's physical
            lights mode (r155+), where Lambert divides irradiance by π — an
            intensity of 1 delivers only ~0.32 of the albedo, so intensities
            here carry the π factor. Measured targets: an ambient-only interior
            wall face lands ~0.93 sRGB (white but readable as a shaded plane)
            and a key-facing wall ~0.97 — one clear value step so depth reads
            without shadows. */}
        <ambientLight intensity={2.9} />
        <directionalLight intensity={0.4} position={[-6, 8, 6]} />
        <SceneRooms
          scene={scene}
          getBlob={getBlob}
          artworksById={artworksById}
          selectedObjectIds={selectedObjectIds}
          selectedArtworkId={selectedArtworkId}
          selectedWallId={selectedWallId}
          onSelectWall={onSelectWall}
          onSelectObject={onSelectObject}
          onClearSelection={onClearSelection}
          onFocusPoint={(point) => {
            endGhostSession();
            rigApi.current?.focus(point);
          }}
          ghostedWallIds={ghostedWallIds}
        />
        <OrbitControls
          makeDefault
          enableDamping
          dampingFactor={0.1}
          minDistance={ORBIT_MIN_DISTANCE}
          maxDistance={ORBIT_MAX_DISTANCE}
          maxPolarAngle={Math.PI / 2}
          // While an eye-level ghost session is live, each orbit re-derives
          // which walls/partitions cross the new sightline — obstructions
          // un-ghost as you swing past them and new ones fade in.
          onEnd={(event) => {
            if (!ghostSessionRef.current) return;
            const controls = event?.target as OrbitControlsImpl | undefined;
            if (!controls) return;
            const cameraFloor = {
              xMm: controls.object.position.x / MM_TO_WORLD,
              yMm: controls.object.position.z / MM_TO_WORLD
            };
            const targetFloor = {
              xMm: controls.target.x / MM_TO_WORLD,
              yMm: controls.target.z / MM_TO_WORLD
            };
            setGhostedWallIds(
              new Set(
                sightlineOccluders(cameraFloor, targetFloor, sceneSightlineSegments(scene))
              )
            );
          }}
          // One finger pans like a map; two fingers pinch-zoom and twist to
          // orbit. Touch-only — mouse bindings unchanged.
          touches={{ ONE: TOUCH.PAN, TWO: TOUCH.DOLLY_ROTATE }}
          // Pan slides along the ground plane, not the screen plane —
          // deliberate for ALL inputs (mouse right-drag included), matching
          // the floorplan-under-your-finger feel and height-preserving travel.
          screenSpacePanning={false}
        />
        <CursorZoom />
        <KeyboardTravel />
        {benchmarkEnabled ? <BenchmarkFrameProbe /> : null}
        <CameraRig scene={scene} fitKey={project.id} apiRef={rigApi} />
      </Canvas>
    </div>
  );
}
