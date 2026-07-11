import { OrbitControls } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import { Box3, MathUtils, PerspectiveCamera, Vector3 } from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { parseFaceWallId } from "../../../domain/geometry/freestandingWalls";
import {
  deriveScene3d,
  wallInwardNormal,
  type Room3d,
  type Scene3d,
  type WallPanel3d
} from "../../../domain/geometry/scene3d";
import type { Artwork, Project } from "../../../domain/project";
import { fitDistance } from "./cameraFit";
import { MM_TO_WORLD } from "./coordinates";
import { SceneRooms } from "./SceneRooms";

// Entry framing: above and outside the room, looking down at ~40° elevation
// from a corner (spec §4.2).
const FIT_ELEVATION_DEG = 40;
const FIT_AZIMUTH_DEG = 45;
const CAMERA_FOV_DEG = 50;

// Preset flights are quick enough to stay an instrument, slow enough to keep
// spatial continuity.
const FLIGHT_MS = 600;

// Eye-level standoff bounds (spec §4.2): far enough back to read the hang,
// never through the opposite wall.
const EYE_MIN_STANDOFF_MM = 1200;
const EYE_DEPTH_FRACTION = 0.8;

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
  eyeLevel: (wall: WallPanel3d, eyeHeightMm: number) => void;
  focus: (target: Vector3) => void;
};

export type ThreeDViewActions = {
  overview: () => void;
  eyeLevel: () => void;
  focusSelection: () => void;
};

// World-space bounding box of the union of every room's floor + wall heights.
// null when there is nothing to frame.
function sceneBounds(scene: Scene3d): Box3 | null {
  const box = new Box3();
  let hasPoint = false;

  for (const room of scene.rooms) {
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
      hasPoint = true;
    }

    // A partition can be taller than the room's walls, and its endpoints can
    // sit outside the room polygon (advisory, spec §6.4) — so frame by its cap
    // outline and heightMm explicitly, or the fit derived from floors alone
    // could clip it.
    for (const partition of room.freestandingWalls) {
      const { start, end, heightMm } = partition.capOutline;
      for (const point of [start, end]) {
        box.expandByPoint(new Vector3(point.xMm * MM_TO_WORLD, 0, point.yMm * MM_TO_WORLD));
        box.expandByPoint(
          new Vector3(point.xMm * MM_TO_WORLD, heightMm * MM_TO_WORLD, point.yMm * MM_TO_WORLD)
        );
        hasPoint = true;
      }
    }
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

// A standing viewpoint facing `wall` (spec §4.2): eye at the project's
// centerline height, backed off along the wall's inward normal — 80% of the
// room's depth behind that wall, never closer than EYE_MIN_STANDOFF_MM. The
// orbit target moves to the wall's center at eye height so subsequent
// orbiting pivots around what you're looking at.
function eyeLevelPose(
  scene: Scene3d,
  wall: WallPanel3d,
  eyeHeightMm: number
): CameraPose {
  const centerXMm = (wall.start.xMm + wall.end.xMm) / 2;
  const centerYMm = (wall.start.yMm + wall.end.yMm) / 2;
  const { xMm: normalX, yMm: normalY } = wallInwardNormal(wall);

  // Room depth behind this wall: the farthest floor vertex measured along the
  // inward normal, across the room that owns the wall. For a partition face,
  // find the owning room via its centerline id — the face's outward normal
  // still points into the room on that side, so the depth probe holds; the
  // Math.max clamp below covers the advisory outside-the-polygon case.
  const faceRef = parseFaceWallId(wall.wallId);
  const room = faceRef
    ? scene.rooms.find((candidate) =>
        candidate.freestandingWalls.some(
          (partition) => partition.freestandingWallId === faceRef.freestandingWallId
        )
      )
    : scene.rooms.find((candidate) => candidate.walls.some((w) => w.wallId === wall.wallId));
  let depthMm = EYE_MIN_STANDOFF_MM;
  for (const point of room?.floorPolygon ?? []) {
    const along =
      (point.xMm - centerXMm) * normalX + (point.yMm - centerYMm) * normalY;
    depthMm = Math.max(depthMm, along);
  }
  const standoffMm = Math.max(EYE_MIN_STANDOFF_MM, depthMm * EYE_DEPTH_FRACTION);

  const eyeY = eyeHeightMm * MM_TO_WORLD;
  const target = new Vector3(centerXMm * MM_TO_WORLD, eyeY, centerYMm * MM_TO_WORLD);
  const position = new Vector3(
    (centerXMm + normalX * standoffMm) * MM_TO_WORLD,
    eyeY,
    (centerYMm + normalY * standoffMm) * MM_TO_WORLD
  );
  return { position, target };
}

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
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
    const distance = pose.position.distanceTo(pose.target);
    camera.near = Math.max(distance / 1000, 0.01);
    camera.far = Math.max(distance * 100, 100);
    camera.updateProjectionMatrix();
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
    apiRef.current = {
      overview: () => {
        const pose = overviewPose(sceneRef.current, aspect());
        if (pose) flyTo(pose);
      },
      focus: (target) => {
        const currentTarget = controls?.target.clone() ?? camera.position.clone();
        const offset = camera.position.clone().sub(currentTarget);
        if (offset.lengthSq() < 0.0001) offset.set(0, 2, 2);
        flyTo({ target, position: target.clone().add(offset) });
      },
      eyeLevel: (wall, eyeHeightMm) => {
        flyTo(eyeLevelPose(sceneRef.current, wall, eyeHeightMm));
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

// Eye-level target wall priority (spec §4.2): selected wall, then the wall
// holding the selected artwork placement, then the longest wall, then the
// first.
function pickEyeLevelWall(
  scene: Scene3d,
  selectedWallId: string | null,
  selectedObjectIds: string[],
  selectedArtworkId: string | null
): WallPanel3d | null {
  const walls = scene.rooms.flatMap(roomWallPanels);
  if (walls.length === 0) return null;

  if (selectedWallId) {
    const wall = walls.find((w) => w.wallId === selectedWallId);
    if (wall) return wall;
  }
  const holdingSelected = walls.find((wall) =>
    wall.artworks.some(
      (artwork) =>
        selectedObjectIds.includes(artwork.objectId) ||
        artwork.artworkId === selectedArtworkId
    )
  );
  if (holdingSelected) return holdingSelected;

  return walls.reduce((longest, wall) => {
    const length = Math.hypot(
      wall.end.xMm - wall.start.xMm,
      wall.end.yMm - wall.start.yMm
    );
    const longestLength = Math.hypot(
      longest.end.xMm - longest.start.xMm,
      longest.end.yMm - longest.start.yMm
    );
    return length > longestLength ? wall : longest;
  }, walls[0]);
}

function wallFocusTarget(wall: WallPanel3d): Vector3 {
  return new Vector3(
    ((wall.start.xMm + wall.end.xMm) / 2) * MM_TO_WORLD,
    (wall.heightMm / 2) * MM_TO_WORLD,
    ((wall.start.yMm + wall.end.yMm) / 2) * MM_TO_WORLD
  );
}

function roomFocusTarget(room: Room3d): Vector3 {
  const center = room.floorPolygon.reduce(
    (sum, point) => ({ xMm: sum.xMm + point.xMm, yMm: sum.yMm + point.yMm }),
    { xMm: 0, yMm: 0 }
  );
  const count = Math.max(room.floorPolygon.length, 1);
  const wallHeightMm = room.walls.reduce(
    (max, wall) => Math.max(max, wall.heightMm),
    0
  );
  return new Vector3(
    (center.xMm / count) * MM_TO_WORLD,
    (wallHeightMm / 2) * MM_TO_WORLD,
    (center.yMm / count) * MM_TO_WORLD
  );
}

function focusTargetForSelection(
  scene: Scene3d,
  selectedRoomId: string | null,
  selectedWallId: string | null,
  selectedObjectIds: string[],
  selectedArtworkId: string | null
): Vector3 | null {
  const walls = scene.rooms.flatMap(roomWallPanels);
  const selectedWall = selectedWallId
    ? walls.find((wall) => wall.wallId === selectedWallId)
    : undefined;
  if (selectedWall) return wallFocusTarget(selectedWall);

  const artworkWall = walls.find((wall) =>
    wall.artworks.some(
      (artwork) =>
        selectedObjectIds.includes(artwork.objectId) ||
        artwork.artworkId === selectedArtworkId
    )
  );
  if (artworkWall) return wallFocusTarget(artworkWall);

  const floorObject = scene.floorObjects.find(
    (object) =>
      selectedObjectIds.includes(object.objectId) ||
      object.artworkId === selectedArtworkId
  );
  if (floorObject) {
    return new Vector3(
      floorObject.xMm * MM_TO_WORLD,
      floorObject.heightMm * 0.5 * MM_TO_WORLD,
      floorObject.yMm * MM_TO_WORLD
    );
  }

  const selectedRoom = selectedRoomId
    ? scene.rooms.find((room) => room.roomId === selectedRoomId)
    : undefined;
  return selectedRoom ? roomFocusTarget(selectedRoom) : null;
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
      overview: () => rigApi.current?.overview(),
      eyeLevel: () => {
        const wall = pickEyeLevelWall(
          scene,
          selectedWallId,
          selectedObjectIds,
          selectedArtworkId
        );
        if (wall) {
          rigApi.current?.eyeLevel(wall, project.defaultCenterlineHeightMm);
        }
      },
      focusSelection: () => {
        const target = focusTargetForSelection(
          scene,
          selectedRoomId,
          selectedWallId,
          selectedObjectIds,
          selectedArtworkId
        );
        if (target) rigApi.current?.focus(target);
      }
    };

    return () => {
      actionsRef.current = null;
    };
  }, [
    actionsRef,
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
    // The app canvas background token carries the backdrop (spec §6.1); a
    // transparent WebGL canvas lets it show through so 3D honours the theme.
    <div
      className="three-view"
      onPointerDown={(event) => {
        pointerDownAt.current = { x: event.clientX, y: event.clientY };
      }}
      onDoubleClick={() => {
        const target = focusTargetForSelection(
          scene,
          selectedRoomId,
          selectedWallId,
          selectedObjectIds,
          selectedArtworkId
        );
        if (target) rigApi.current?.focus(target);
      }}
    >
      <Canvas
        frameloop="demand"
        dpr={[1, 2]}
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
          // Empty space clears the object selection (spec §4.3) — but only
          // for true clicks, not the release of an orbit drag.
          const down = pointerDownAt.current;
          const moved = down
            ? Math.hypot(event.clientX - down.x, event.clientY - down.y)
            : 0;
          if (moved <= CLICK_DRAG_TOLERANCE_PX) onClearSelection();
        }}
      >
        {/* Soft, shadowless lighting (spec §6.1): flat ambient plus one gentle
            high front-left key so walls shade apart and read as volume. */}
        <ambientLight intensity={0.9} />
        <directionalLight intensity={0.4} position={[-6, 8, 6]} />
        <SceneRooms
          scene={scene}
          getBlob={getBlob}
          selectedObjectIds={selectedObjectIds}
          selectedArtworkId={selectedArtworkId}
          selectedWallId={selectedWallId}
          onSelectWall={onSelectWall}
          onSelectObject={onSelectObject}
          onClearSelection={onClearSelection}
        />
        <OrbitControls
          makeDefault
          enableDamping
          dampingFactor={0.1}
          zoomToCursor
          keyEvents
          keyPanSpeed={120}
          minDistance={0.35}
          maxDistance={200}
          maxPolarAngle={Math.PI / 2}
        />
        {benchmarkEnabled ? <BenchmarkFrameProbe /> : null}
        <CameraRig scene={scene} fitKey={project.id} apiRef={rigApi} />
      </Canvas>
    </div>
  );
}
