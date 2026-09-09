import { OrbitControls } from "@react-three/drei";
import { Canvas, useThree, type ThreeEvent } from "@react-three/fiber";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent as ReactDragEvent
} from "react";
import {
  DoubleSide,
  MOUSE,
  PerspectiveCamera,
  Raycaster,
  Scene,
  TOUCH,
  Vector3
} from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import {
  artworkDropOuterMm,
  effectiveFraming,
  getArtworkOuterDimensionsMm
} from "../../../domain/framing";
import { getPlaceableFloorWalls } from "../../../domain/geometry/planObjects";
import { deriveScene3d } from "../../../domain/geometry/scene3d";
import { effectiveFloorDepthMm } from "../../../domain/placement/artworkForm";
import {
  getEffectivePlacementSizeMm,
  PLACEHOLDER_ARTWORK_HEIGHT_MM,
  PLACEHOLDER_ARTWORK_WIDTH_MM
} from "../../../domain/placement/placeArtwork";
import {
  DEFAULT_FLOOR_OBJECT_DEPTH_MM,
  type Artwork,
  type Project,
  type SavedViewPose
} from "../../../domain/project";
import {
  ARTWORK_DRAG_MIME,
  consumeArtworkDragSession,
  peekArtworkDragSession,
  subscribeArtworkTouchDrag
} from "../library/artworkDragSession";
import { useArtworkAspect } from "../../hooks/useArtworkAspect";
import { useDragGesture } from "../../hooks/useDragGesture";
import {
  dropGhostTransform,
  pickDropSurface,
  resolveThreeDrop,
  type DropDimsMm,
  type DropGhost3d,
  type DropGhostTransform
} from "./dropTarget";
import {
  dragMoveIsMeaningful,
  exceedsDragThreshold,
  grabOffsetMm,
  projectWithDragPreview,
  resolveDragMove,
  type DragSurfaceHit,
  type ThreeDragMove,
  type ThreeDragSource
} from "./objectDrag";
import { ThreeObjectDragContext, type ThreeObjectDragApi } from "./objectDragContext";
import { ThreeDViewportControls } from "./ThreeDViewportControls";
import {
  ORBIT_MAX_DISTANCE,
  ORBIT_MIN_DISTANCE,
  sightlineOccluders,
  type CameraPose
} from "./cameraNav";
import { MM_TO_WORLD } from "./coordinates";
import {
  AMBIENT_LIGHT_INTENSITY,
  CAMERA_FAR,
  CAMERA_FOV_DEG,
  CAMERA_NEAR,
  CLICK_DRAG_TOLERANCE_PX,
  KEY_LIGHT_INTENSITY,
  KEY_LIGHT_POSITION
} from "./sceneConstants";
import { SceneRooms } from "./SceneRooms";
import { SnapshotStage, snapshotPixelSize, type SnapshotFormat, type SnapshotRequest } from "./SnapshotStage";
import { DROP_GHOST_OPACITY, SCENE_BACKGROUND_COLOR, SELECTION_COLOR } from "./tokens";


import { isEditableTarget } from "../../hooks/isEditableTarget";
import {
  BenchmarkFrameProbe,
  benchmarkEnabled,
  benchmarkMetrics,
  resetBenchmarkMetrics
} from "./rendererBenchmark";
import {
  CameraRig,
  CursorZoom,
  KeyboardZoom,
  KeyboardTravel,
  ZoomBoundsTracker,
  type CameraRigApi
} from "./cameraControls";
import {
  cursorNdc,
  pickEyeLevelWall,
  resolveEyeLevelStandoffArtwork,
  resolveFocusSelection,
  sceneSightlineSegments,
  toCameraPose,
  prefersReducedMotion
} from "./sceneCamera";

export { resolveEyeLevelStandoffArtwork } from "./sceneCamera";
export type { RendererBenchmarkMetrics } from "./rendererBenchmark";
// Recover from WebGL context loss (GPU reset, OS sleep/wake, or the browser
// evicting a context when too many live at once — a real risk here since a
// many-view PDF export briefly stands up an offscreen stage alongside this
// live canvas). Without handling, the browser discards the lost context and
// the viewport freezes until a full page reload.
//
// Two non-obvious requirements:
//   1. preventDefault() on `webglcontextlost` is REQUIRED — the spec only
//      fires `webglcontextrestored` if the default (permanent loss) is
//      cancelled. three@0.169 rebuilds its own GL resources on restore, so
//      no manual reinit is needed beyond letting it hear the event.
//   2. This Canvas runs frameloop="demand", so the browser won't repaint on
//      its own after restore — we must call invalidate() or the recovered
//      context stays blank (the project's documented demand-frameloop
//      silent-freeze trap).
function ContextLossRecovery() {
  const gl = useThree((state) => state.gl);
  const invalidate = useThree((state) => state.invalidate);

  useEffect(() => {
    const canvas = gl.domElement;

    const onLost = (event: Event) => {
      // Cancel the default permanent-loss behavior so `restored` can fire.
      event.preventDefault();
    };
    const onRestored = () => {
      // Demand frameloop: nothing repaints without an explicit nudge.
      invalidate();
    };

    canvas.addEventListener("webglcontextlost", onLost, false);
    canvas.addEventListener("webglcontextrestored", onRestored, false);
    return () => {
      canvas.removeEventListener("webglcontextlost", onLost, false);
      canvas.removeEventListener("webglcontextrestored", onRestored, false);
    };
  }, [gl, invalidate]);

  return null;
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

// Publishes the live camera, its controls, and the canvas's CSS pixel size to
// refs owned by ThreeDView — read once, at the moment captureSnapshot is
// called, rather than tracked frame-by-frame. camera.position and
// controls.target are the actual mutable three.js objects OrbitControls/
// CameraRig write into every frame, so reading them directly (not a cloned
// snapshot kept in sync via useFrame) can never lag behind what's on screen.
function LiveCameraTracker({
  cameraRef,
  controlsRef,
  sizeRef
}: {
  cameraRef: React.MutableRefObject<PerspectiveCamera | null>;
  controlsRef: React.MutableRefObject<OrbitControlsImpl | null>;
  sizeRef: React.MutableRefObject<{ width: number; height: number }>;
}) {
  const camera = useThree((state) => state.camera);
  const controls = useThree((state) => state.controls) as OrbitControlsImpl | null;
  const size = useThree((state) => state.size);
  cameraRef.current = camera instanceof PerspectiveCamera ? camera : null;
  controlsRef.current = controls;
  sizeRef.current = size;
  return null;
}

// What a checklist drop needs from inside the Canvas. HTML5 `dragover` never
// becomes an R3F pointer event, so the wrapper div's DOM handlers have to
// raycast by hand — the same escape hatch CursorZoom uses for `wheel`. Same
// publish-to-a-ref pattern (and same rationale) as LiveCameraTracker above:
// these are the live three.js objects, so a handler reading them mid-drag can
// never see a stale camera.
type DropRaycastApi = {
  raycaster: Raycaster;
  camera: PerspectiveCamera;
  scene: Scene;
  canvas: HTMLCanvasElement;
  invalidate: () => void;
};

function DropRaycastTracker({
  apiRef
}: {
  apiRef: React.MutableRefObject<DropRaycastApi | null>;
}) {
  const raycaster = useThree((state) => state.raycaster);
  const camera = useThree((state) => state.camera);
  const scene = useThree((state) => state.scene);
  const gl = useThree((state) => state.gl);
  const invalidate = useThree((state) => state.invalidate);

  apiRef.current =
    camera instanceof PerspectiveCamera
      ? { raycaster, camera, scene, canvas: gl.domElement, invalidate }
      : null;
  return null;
}

// The drop preview: a plain translucent rectangle at the resolved placement,
// untextured by design (see DROP_GHOST_OPACITY). `raycast` is disabled so the
// ghost can never become a hit of its own on the next dragover, and it writes
// no depth so it reads as an overlay rather than a physical panel.
function DropGhostPlane({ transform }: { transform: DropGhostTransform }) {
  return (
    <mesh
      position={transform.position}
      rotation={transform.rotation}
      raycast={() => null}
      renderOrder={1}
    >
      <planeGeometry args={[transform.widthWorld, transform.heightWorld]} />
      <meshBasicMaterial
        color={SELECTION_COLOR}
        transparent
        opacity={DROP_GHOST_OPACITY}
        side={DoubleSide}
        depthWrite={false}
        toneMapped={false}
      />
    </mesh>
  );
}

export type ThreeDViewActions = {
  overview: () => void;
  eyeLevel: () => void;
  focusSelection: () => void;
  // Open a Saved view: move the live camera to its stored pose (saved-views
  // spec §4.3). Animated flight, or an instant cut under reduced motion.
  // Read-only — it never writes the project.
  flyToPose: (pose: SavedViewPose) => void;
  // A clean, offscreen, export-resolution render from the CURRENT camera pose
  // (spec §2.2) — never a readback of the live (dpr-capped, selection-tinted)
  // canvas, never a store write, never a Saved view.
  captureSnapshot: (format: SnapshotFormat) => Promise<Blob>;
  // The live camera pose as plain world-space numbers, for the Save view action
  // (spec §8.2). Null when no camera is active yet. The caller persists it via
  // the store; this reads, it never writes.
  getCurrentPose: () => SavedViewPose | null;
  // One dolly step, for a caller outside the viewport (the view toolbar, a
  // future zoom control in the topbar). Same function the in-viewport +/-
  // buttons and Cmd/Ctrl +/- run.
  zoomStep: (direction: "in" | "out") => void;
};

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
  draggingArtworkId = null,
  onPlaceArtwork,
  onPlaceArtworkOnFloor,
  onCommitObjectMove,
  actionsRef,
  initialPose
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
  // The checklist drag protocol, identical to plan's and elevation's: the
  // app-level id is the iPadOS fallback for a dataTransfer that hides custom
  // MIME types, and the module-level drag session is the fallback for that.
  draggingArtworkId?: string | null;
  onPlaceArtwork?: (artworkId: string, wallId: string, xMm: number, yMm: number) => void;
  onPlaceArtworkOnFloor?: (artworkId: string, xMm: number, yMm: number) => void;
  // Commit of a pointer-drag of an ALREADY-PLACED object, called exactly once
  // on release (the view previews the move locally until then), so one drag is
  // one undo entry. Absent => 3D stays view-only, which is what the offscreen
  // render hosts want.
  onCommitObjectMove?: (objectId: string, move: ThreeDragMove) => void;
  actionsRef?: { current: ThreeDViewActions | null };
  // A Saved-view pose to seat as the initial camera when this view mounts to
  // open a view while 3D wasn't yet the active mode (spec §4.3 handoff).
  initialPose?: SavedViewPose;
}) {
  const benchmarkProjectId = useRef<string | null>(null);
  if (benchmarkEnabled && benchmarkProjectId.current !== project.id) {
    resetBenchmarkMetrics();
    benchmarkProjectId.current = project.id;
  }

  // --- Live three.js handles ------------------------------------------------
  //
  // Declared up here (rather than beside the features that read them) because
  // the object-drag gesture below needs the controls and the raycaster before
  // the scene is even derived — a drag mutates the project the derivation runs
  // on. The refs themselves are filled after commit by LiveCameraTracker and
  // DropRaycastTracker, both mounted inside the Canvas.
  const rigApi = useRef<CameraRigApi | null>(null);
  // The live camera/controls/size, kept current by LiveCameraTracker below —
  // captureSnapshot reads these directly (they're the actual mutable three.js
  // objects, so there is no lag versus what the user is looking at).
  const liveCameraRef = useRef<PerspectiveCamera | null>(null);
  const liveControlsRef = useRef<OrbitControlsImpl | null>(null);
  const liveSizeRef = useRef<{ width: number; height: number }>({ width: 1, height: 1 });
  const containerRef = useRef<HTMLDivElement | null>(null);
  const dropRaycastRef = useRef<DropRaycastApi | null>(null);

  // The authored placeable surfaces (perimeter walls ∪ partition faces, open
  // walls excluded) in floor space. Face ids are `${partitionId}#a|#b`, exactly
  // the wallIds the scene's panels carry, so partitions need no special case.
  // Shared by the checklist drop and the object drag — both resolve a pointer
  // onto exactly the same set of surfaces.
  const placeableWalls = useMemo(
    () => getPlaceableFloorWalls(project.floor),
    [project.floor]
  );

  // The nearest placement surface under a client point, looking THROUGH
  // anything hanging on it (pickDropSurface walks near->far for the first
  // tagged wall/floor). The one raycast both the drop and the drag run.
  function pickSurfaceUnderCursor(clientX: number, clientY: number): DragSurfaceHit | null {
    const api = dropRaycastRef.current;
    if (!api) return null;
    api.raycaster.setFromCamera(cursorNdc(api.canvas, clientX, clientY), api.camera);
    return pickDropSurface(api.raycaster.intersectObjects(api.scene.children, true));
  }

  // --- Pointer-drag of placed objects (full 3D editing) ---------------------
  //
  // 3D is an editing surface, not only a placement one: a placed work can be
  // picked up and moved with the pointer, the same direct manipulation plan and
  // elevation have always had. Scope of this round, deliberately narrow:
  //   * WALL objects (hung works, wall cases) slide in both wall axes and MAY
  //     HOP to another wall — the store's wall→wall handler already re-anchors.
  //   * FLOOR objects (works, monitors, vitrines, blocked zones) slide on the
  //     floor plane. Rotation is untouched.
  //   * NO SNAPPING and NO overlap barriers, matching the 3D drop's contract:
  //     elevation and the inspector remain the precision surfaces.
  //   * Wall<->floor CONVERSION mid-drag, group drag and touch drag are NOT in
  //     this round (see objectDrag.ts and the notes on OrbitControls below).
  //
  // GESTURE ARBITRATION. A pointerdown that lands ON an object wins outright:
  // it disables OrbitControls for the gesture, so neither orbit nor the hand
  // tool's pan can steal it. Empty space keeps its old behaviour (orbit, or pan
  // while the hand tool is on). Middle/right buttons never arm a drag, so the
  // camera stays reachable with the cursor over an object.
  type ObjectDragState = {
    source: ThreeDragSource;
    offsetMm: { xMm: number; yMm: number };
    startClientX: number;
    startClientY: number;
    // Has the pointer travelled past CLICK_DRAG_TOLERANCE_PX yet? Until it has,
    // this is still a click and nothing moves.
    active: boolean;
    move: ThreeDragMove | null;
  };

  // The dragged object's identity and footprint. Only the kinds whose meshes
  // arm a drag can produce one; anything else returns null and the press stays
  // an ordinary click.
  function dragSourceFor(objectId: string): ThreeDragSource | null {
    const wallObject = project.wallObjects.find((object) => object.id === objectId);
    if (wallObject) {
      if (wallObject.kind !== "artwork" && wallObject.kind !== "case") return null;
      // The wall clamp is governed by the OUTER (mat + frame) box, exactly as
      // the drop's is — read through effectiveFraming so a work whose stored
      // size already includes its frame doesn't double-count.
      const record =
        wallObject.kind === "artwork" ? artworksById.get(wallObject.artworkId) : undefined;
      const framing = effectiveFraming(record);
      const outer = getArtworkOuterDimensionsMm(
        wallObject.widthMm,
        wallObject.heightMm,
        framing.matWidthMm,
        framing.frame
      );
      return {
        anchor: "wall",
        objectId,
        wallId: wallObject.wallId,
        xMm: wallObject.xMm,
        yMm: wallObject.yMm,
        dims: {
          wallWidthMm: outer.widthMm,
          wallHeightMm: outer.heightMm,
          floorWidthMm: wallObject.widthMm,
          floorDepthMm: DEFAULT_FLOOR_OBJECT_DEPTH_MM
        }
      };
    }

    const floorObject = project.floorObjects.find((object) => object.id === objectId);
    if (!floorObject) return null;
    return {
      anchor: "floor",
      objectId,
      xMm: floorObject.xMm,
      yMm: floorObject.yMm,
      dims: {
        wallWidthMm: floorObject.widthMm,
        wallHeightMm: floorObject.heightMm,
        floorWidthMm: floorObject.widthMm,
        floorDepthMm: floorObject.depthMm
      }
    };
  }

  const {
    drag: objectDrag,
    dragRef: objectDragRef,
    beginDrag: startObjectDrag
  } = useDragGesture<ObjectDragState>({
    onMove: (current, event) => {
      const active =
        current.active ||
        exceedsDragThreshold(
          event.clientX - current.startClientX,
          event.clientY - current.startClientY,
          CLICK_DRAG_TOLERANCE_PX
        );
      if (!active) return null;

      // Crossing the threshold also SELECTS the object, matching plan: you can
      // pick something up and move it in one gesture. Modifier-aware additive
      // selection stays with the click path — a drag replaces the selection
      // only when the object isn't already in it, so shift-dragging a member of
      // a multi-selection can't silently collapse it.
      if (!current.active && !isObjectSelected(current.source.objectId)) {
        onSelectObject(current.source.objectId, { additive: false });
      }

      const move =
        resolveDragMove({
          surface: pickSurfaceUnderCursor(event.clientX, event.clientY),
          source: current.source,
          offsetMm: current.offsetMm,
          walls: placeableWalls
        }) ?? current.move;

      // frameloop="demand": nothing redraws unless we ask, and the preview is
      // a re-derived scene, not an animation.
      dropRaycastRef.current?.invalidate();
      if (current.active && move === current.move) return null;
      return { ...current, active: true, move };
    },
    onRelease: (final) => {
      // Hand the camera back whatever happened — a cancelled gesture must never
      // leave the controls dead.
      if (liveControlsRef.current) liveControlsRef.current.enabled = true;
      if (!final.active || !final.move) return;
      if (!dragMoveIsMeaningful(final.source, final.move)) return;
      onCommitObjectMove?.(final.source.objectId, final.move);
    }
  });

  function isObjectSelected(objectId: string): boolean {
    return selectedObjectIds.includes(objectId);
  }

  function beginObjectDrag(objectId: string, event: ThreeEvent<PointerEvent>) {
    if (!onCommitObjectMove) return;
    if (objectDragRef.current) return;
    const source = dragSourceFor(objectId);
    if (!source) return;

    const { clientX, clientY } = event.nativeEvent;
    // Suppress orbit (and hand-pan) for this gesture immediately — the
    // declarative `enabled` prop below says the same thing one render later,
    // but a pointermove can beat that render.
    if (liveControlsRef.current) liveControlsRef.current.enabled = false;

    startObjectDrag({
      source,
      // Keep the grip: the object moves BY the pointer, it doesn't teleport its
      // centre TO the pointer.
      offsetMm: grabOffsetMm({
        surface: pickSurfaceUnderCursor(clientX, clientY),
        source,
        walls: placeableWalls
      }),
      startClientX: clientX,
      startClientY: clientY,
      active: false,
      move: null
    });
  }

  // Stable context value over a ref to the latest handler, so arming a drag
  // never re-renders every mesh in the scene.
  const beginObjectDragRef = useRef(beginObjectDrag);
  beginObjectDragRef.current = beginObjectDrag;
  const objectDragApi = useMemo<ThreeObjectDragApi>(
    () => ({ begin: (objectId, event) => beginObjectDragRef.current(objectId, event) }),
    []
  );

  // The project as the live preview would leave it. Deriving the scene from
  // THIS rather than painting a stand-in ghost is what makes the dragged thing
  // move as itself — real framing, real texture, real suspension wires, real
  // eye-level ghosting — and it keeps preview and commit provably identical,
  // since both read the same resolved placement. Outside a drag it is the
  // project by reference, so the memo below is untouched.
  const previewProject = useMemo(
    () =>
      objectDrag?.active
        ? projectWithDragPreview(project, objectDrag.source.objectId, objectDrag.move)
        : project,
    [project, objectDrag]
  );

  const scene = useMemo(
    () => {
      const startedAt = performance.now();
      const nextScene = deriveScene3d(previewProject, artworksById);
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
    [previewProject, artworksById]
  );
  const [snapshotRequest, setSnapshotRequest] = useState<SnapshotRequest | null>(null);
  // Synchronous guard (state is async) so a second captureSnapshot call while
  // one is in flight fails fast instead of silently orphaning the first
  // request's promise.
  const snapshotInFlightRef = useRef(false);
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

  // --- Viewport controls (hand tool + zoom steps) ---------------------------
  //
  // Right-drag pans and the wheel dollies, but nobody finds either. The hand
  // tool re-binds LEFT-drag to pan for as long as it is on, and the +/- chips
  // put the dolly on screen — the same discoverability move the 2D surfaces'
  // zoom cluster makes, in the shape an orbit rig can honour.
  const [handActive, setHandActive] = useState(false);
  // Live at the ends of the dolly envelope, so the chips grey out where the
  // camera can no longer go (ZoomBoundsTracker keeps this current).
  const [zoomBounds, setZoomBounds] = useState({ canZoomIn: true, canZoomOut: true });
  // A hand-pan gesture in flight, purely for the grabbing cursor.
  const [panning, setPanning] = useState(false);

  // Escape leaves the hand tool, the same way every armed tool in the 2D
  // surfaces releases. Ignored while typing in an inspector field.
  useEffect(() => {
    if (!handActive) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (isEditableTarget(event.target)) return;
      setHandActive(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handActive]);

  // The pan gesture's own lifetime: a pointerup anywhere ends it, including
  // outside the viewport (a pan that leaves the window must not leave the
  // grabbing cursor stuck on).
  useEffect(() => {
    if (!panning) return;
    const end = () => setPanning(false);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
    return () => {
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
    };
  }, [panning]);

  // Left-drag pans while the hand tool is on; middle and right keep their
  // bindings either way, so dolly and pan stay reachable without it.
  // screenSpacePanning stays false — pan slides along the ground plane, which
  // is the whole point of the gesture in a room.
  const mouseButtons = useMemo(
    () => ({
      LEFT: handActive ? MOUSE.PAN : MOUSE.ROTATE,
      MIDDLE: MOUSE.DOLLY,
      RIGHT: MOUSE.PAN
    }),
    [handActive]
  );

  // --- Checklist drop-to-place (docs/archive/interaction-improvements-2026-08.md §4) --
  //
  // 3D is a placement surface now, not only a preview: a work released over a
  // wall hangs there at the hit height, a work released over the floor stands
  // there. No snapping — elevation and the inspector stay the precision
  // surfaces, and the whole point of the 3D drop is "roughly there, in the
  // room I'm looking at".
  const [dropGhost, setDropGhost] = useState<DropGhostTransform | null>(null);

  // The dragged work's image aspect, so a partial/unknown-dimension work
  // previews at its true proportions — the same read placeArtwork itself makes
  // when it bakes the placement size.
  const draggingArtworkAspect = useArtworkAspect(
    draggingArtworkId ? artworksById.get(draggingArtworkId)?.assetId : undefined
  );

  function dropDimsFor(artworkId: string | null): DropDimsMm {
    const artwork = artworkId ? artworksById.get(artworkId) : undefined;
    if (!artwork) {
      return {
        wallWidthMm: PLACEHOLDER_ARTWORK_WIDTH_MM,
        wallHeightMm: PLACEHOLDER_ARTWORK_HEIGHT_MM,
        floorWidthMm: PLACEHOLDER_ARTWORK_WIDTH_MM,
        floorDepthMm: DEFAULT_FLOOR_OBJECT_DEPTH_MM
      };
    }
    // The aspect only applies to the artwork it was loaded for.
    const aspect = artworkId === draggingArtworkId ? draggingArtworkAspect : undefined;
    const { widthMm, heightMm } = getEffectivePlacementSizeMm(artwork.dimensions, aspect);
    // Framing is WALL-ONLY geometry (docs/framing-dimension-contract.md §3):
    // the outer box travels in the wall fields; the floor footprint keeps the
    // bare image size.
    const outer = artworkDropOuterMm(artwork, aspect);
    return {
      wallWidthMm: outer.widthMm,
      wallHeightMm: outer.heightMm,
      floorWidthMm: widthMm,
      floorDepthMm: effectiveFloorDepthMm(artwork.dimensions)
    };
  }

  // Resolve the placement under the cursor by hand-raycasting the live scene.
  // pickDropSurface walks the (near→far) intersections for the first tagged
  // wall/floor, so a hit on an artwork plane, a pick band or a door leaf falls
  // through to the surface behind it instead of killing the drop.
  function resolveDropUnderCursor(clientX: number, clientY: number, artworkId: string | null) {
    const surface = pickSurfaceUnderCursor(clientX, clientY);
    if (!surface) return null;
    return resolveThreeDrop({
      point: surface.point,
      tag: surface.tag,
      walls: placeableWalls,
      dims: dropDimsFor(artworkId)
    });
  }

  function paintDropGhost(ghost: DropGhost3d | null) {
    const api = dropRaycastRef.current;
    setDropGhost(ghost && api ? dropGhostTransform(ghost, api.camera.position) : null);
    // frameloop="demand": nothing redraws unless we ask.
    api?.invalidate();
  }

  // Returns whether the cursor is over a placement surface at all, so the
  // dragover handler can show the no-drop cursor over empty space instead of
  // promising a "copy" that would be a silent no-op.
  function updateDropGhost(
    clientX: number,
    clientY: number,
    artworkId: string | null
  ): boolean {
    const resolved = resolveDropUnderCursor(clientX, clientY, artworkId);
    paintDropGhost(resolved?.ghost ?? null);
    return resolved !== null;
  }

  function clearDropGhost() {
    paintDropGhost(null);
  }

  // Intent wins (§3): the surface under the cursor decides the anchor, never
  // the work's library placementForm. Both store actions carry their own
  // guards (open wall, already placed), and placeArtwork also moves the
  // elevation wall context to the drop wall — nothing to duplicate here.
  function completeDrop(clientX: number, clientY: number, artworkId: string) {
    const resolved = resolveDropUnderCursor(clientX, clientY, artworkId);
    if (!resolved) return;
    if (resolved.anchor === "floor") {
      onPlaceArtworkOnFloor?.(artworkId, resolved.xMm, resolved.yMm);
      return;
    }
    onPlaceArtwork?.(artworkId, resolved.wallId, resolved.xMm, resolved.yMm);
  }

  function handleArtworkDragOver(event: ReactDragEvent<HTMLDivElement>) {
    // iPadOS Safari hides custom MIME types during dragover/drop, so fall back
    // to the app-level drag state, and further to the module-level session.
    if (
      !event.dataTransfer.types.includes(ARTWORK_DRAG_MIME) &&
      !draggingArtworkId &&
      !peekArtworkDragSession()
    ) {
      return;
    }
    event.preventDefault();
    const overSurface = updateDropGhost(event.clientX, event.clientY, draggingArtworkId);
    // Empty space between rooms (or the back of a single-sided wall) is not a
    // placement surface: say so with the cursor rather than accepting a drop
    // that would do nothing.
    event.dataTransfer.dropEffect = overSurface ? "copy" : "none";
  }

  function handleArtworkDragLeave(event: ReactDragEvent<HTMLDivElement>) {
    // Only clear when the pointer actually leaves the surface, not when it
    // crosses between child elements (which also fire dragleave).
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
    clearDropGhost();
  }

  function handleArtworkDrop(event: ReactDragEvent<HTMLDivElement>) {
    const artworkId =
      event.dataTransfer.getData(ARTWORK_DRAG_MIME) ||
      draggingArtworkId ||
      peekArtworkDragSession();
    consumeArtworkDragSession();
    clearDropGhost();
    if (!artworkId) return;
    if (!artworksById.get(artworkId)) return;
    event.preventDefault();
    completeDrop(event.clientX, event.clientY, artworkId);
  }

  // The touch/pen drag path (iOS/iPadOS, where HTML5 DnD is unavailable or
  // unreliable), mirroring plan's and elevation's. The handlers close over live
  // props, so route them through a ref refreshed each render and subscribe once
  // — re-subscribing per render would churn the shared listener Set.
  const touchDropRef = useRef({
    update: updateDropGhost,
    complete: completeDrop,
    clear: clearDropGhost,
    isValidArtwork: (id: string) => Boolean(artworksById.get(id))
  });
  touchDropRef.current = {
    update: updateDropGhost,
    complete: completeDrop,
    clear: clearDropGhost,
    isValidArtwork: (id: string) => Boolean(artworksById.get(id))
  };

  useEffect(() => {
    return subscribeArtworkTouchDrag((dragEvent) => {
      const container = containerRef.current;
      const handlers = touchDropRef.current;
      if (!container) return;
      if (dragEvent.type === "cancel") {
        handlers.clear();
        return;
      }
      const rect = container.getBoundingClientRect();
      const inside =
        dragEvent.clientX >= rect.left &&
        dragEvent.clientX <= rect.right &&
        dragEvent.clientY >= rect.top &&
        dragEvent.clientY <= rect.bottom;
      if (dragEvent.type === "move") {
        if (inside) handlers.update(dragEvent.clientX, dragEvent.clientY, dragEvent.artworkId);
        else handlers.clear();
        return;
      }
      handlers.clear();
      if (inside && handlers.isValidArtwork(dragEvent.artworkId)) {
        handlers.complete(dragEvent.clientX, dragEvent.clientY, dragEvent.artworkId);
      }
    });
    // Subscribes once for the component's life; the refs above stay current.
  }, []);

  // Cmd/Ctrl+0: same "reclaim framing" action as the Overview toolbar button
  // (viewControls.tsx) — the 3D counterpart of the 2D SVG viewport's Cmd/Ctrl+0
  // fit (useSvgViewportGestures.ts). Lives outside the Canvas since it only
  // needs the imperative rig API, not any R3F/useThree state.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key !== "0") return;
      if (isEditableTarget(event.target)) return;
      // Block the browser's own zoom reset.
      event.preventDefault();
      endGhostSession();
      rigApi.current?.overview();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      },
      captureSnapshot: (format) =>
        new Promise<Blob>((resolve, reject) => {
          if (snapshotInFlightRef.current) {
            reject(new Error("A 3D snapshot capture is already in progress."));
            return;
          }
          const camera = liveCameraRef.current;
          if (!camera) {
            reject(new Error("The 3D view has no active camera to capture."));
            return;
          }
          const target = liveControlsRef.current
            ? liveControlsRef.current.target.clone()
            : camera.getWorldDirection(new Vector3()).add(camera.position);
          const pose: CameraPose = { position: camera.position.clone(), target };
          const { width, height } = snapshotPixelSize(
            liveSizeRef.current.width,
            liveSizeRef.current.height
          );
          snapshotInFlightRef.current = true;
          setSnapshotRequest({
            format,
            pose,
            widthPx: width,
            heightPx: height,
            resolve: (blob) => {
              snapshotInFlightRef.current = false;
              resolve(blob);
            },
            reject: (error) => {
              snapshotInFlightRef.current = false;
              reject(error);
            }
          });
        }),
      getCurrentPose: () => {
        const camera = liveCameraRef.current;
        if (!camera) return null;
        // Same live refs captureSnapshot reads (the actual mutable three.js
        // objects), so the pose can never lag what's on screen.
        const target = liveControlsRef.current
          ? liveControlsRef.current.target
          : camera.getWorldDirection(new Vector3()).add(camera.position);
        return {
          position: { x: camera.position.x, y: camera.position.y, z: camera.position.z },
          target: { x: target.x, y: target.y, z: target.z }
        };
      },
      zoomStep: (direction) => rigApi.current?.zoomStep(direction),
      flyToPose: (pose) => {
        // Opening a Saved view ends any live eye-level ghost session, then
        // moves to the stored pose — a flight, or a cut under reduced motion.
        endGhostSession();
        rigApi.current?.flyToPose(toCameraPose(pose), {
          immediate: prefersReducedMotion()
        });
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

  const viewport = (
    // The 3D viewport carries its own quiet grey ground (SCENE_BACKGROUND_COLOR,
    // set on the three.js scene below) so near-white walls read as lit volumes.
    // The surrounding workspace chrome stays white — this greys only the WebGL
    // viewport, not the app.
    <div
      className={[
        "three-view",
        // Grab/grabbing follow the 2D surfaces' convention. An object drag
        // outranks the hand tool, so the open hand drops the moment a press
        // lands on something movable.
        handActive && !objectDrag ? "is-pan-ready" : "",
        panning ? "is-panning" : ""
      ]
        .filter(Boolean)
        .join(" ")}
      ref={containerRef}
      onPointerDown={(event) => {
        pointerDownAt.current = { x: event.clientX, y: event.clientY };
        // R3F's own listener sits on the canvas, so by the time this bubbling
        // handler runs an object drag has already armed itself — which is what
        // keeps the pan cursor off a press that is really a move.
        if (handActive && event.button === 0 && !objectDragRef.current) setPanning(true);
      }}
      // HTML5 drag events never become R3F pointer events, so the checklist
      // drop lives on the wrapper div and raycasts by hand (see above).
      onDragOver={handleArtworkDragOver}
      onDragLeave={handleArtworkDragLeave}
      onDrop={handleArtworkDrop}
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
        camera={{ fov: CAMERA_FOV_DEG, near: CAMERA_NEAR, far: CAMERA_FAR, position: [4, 4, 4] }}
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
        <ambientLight intensity={AMBIENT_LIGHT_INTENSITY} />
        <directionalLight intensity={KEY_LIGHT_INTENSITY} position={KEY_LIGHT_POSITION} />
        {/* Provider inside the Canvas: R3F reconciles its own tree, and the
            offscreen render hosts mount SceneRooms with no provider at all, so
            their meshes stay inert by construction. */}
        <ThreeObjectDragContext.Provider value={objectDragApi}>
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
        </ThreeObjectDragContext.Provider>
        <OrbitControls
          makeDefault
          enableDamping
          // An object drag owns the pointer for its whole gesture: orbit AND
          // hand-pan stand down, so the camera can never slide out from under
          // the thing being moved. beginObjectDrag also sets this imperatively,
          // because a pointermove can beat this render.
          enabled={objectDrag === null}
          mouseButtons={mouseButtons}
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
        <ContextLossRecovery />
        <CursorZoom />
        <KeyboardZoom apiRef={rigApi} />
        <KeyboardTravel />
        <ZoomBoundsTracker onChange={setZoomBounds} />
        {benchmarkEnabled ? <BenchmarkFrameProbe /> : null}
        <CameraRig
          scene={scene}
          fitKey={project.id}
          apiRef={rigApi}
          initialPose={initialPose}
        />
        <LiveCameraTracker
          cameraRef={liveCameraRef}
          controlsRef={liveControlsRef}
          sizeRef={liveSizeRef}
        />
        <DropRaycastTracker apiRef={dropRaycastRef} />
        {dropGhost ? <DropGhostPlane transform={dropGhost} /> : null}
      </Canvas>
      {/* Sibling of the Canvas, inside the already-relative .three-view — and
          therefore below the empty-state early return, so an empty project
          shows no controls for a camera that isn't there. */}
      <ThreeDViewportControls
        handActive={handActive}
        onToggleHand={() => setHandActive((active) => !active)}
        canZoomIn={zoomBounds.canZoomIn}
        canZoomOut={zoomBounds.canZoomOut}
        onZoomIn={() => rigApi.current?.zoomStep("in")}
        onZoomOut={() => rigApi.current?.zoomStep("out")}
      />
    </div>
  );

  return (
    <>
      {viewport}
      <SnapshotStage
        derivedScene={scene}
        artworksById={artworksById}
        getBlob={getBlob}
        request={snapshotRequest}
        onSettled={() => setSnapshotRequest(null)}
      />
    </>
  );
}
