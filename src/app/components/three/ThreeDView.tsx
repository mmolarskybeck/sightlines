import { OrbitControls } from "@react-three/drei";
import { Canvas, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import { Box3, MathUtils, PerspectiveCamera, Vector3 } from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { deriveScene3d, type Scene3d } from "../../../domain/geometry/scene3d";
import type { Artwork, Project } from "../../../domain/project";
import { fitDistance } from "./cameraFit";
import { MM_TO_WORLD } from "./coordinates";
import { SceneRooms } from "./SceneRooms";

// Entry framing: above and outside the room, looking down at ~40° elevation
// from a corner (spec §4.2).
const FIT_ELEVATION_DEG = 40;
const FIT_AZIMUTH_DEG = 45;
const CAMERA_FOV_DEG = 50;

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
  }

  return hasPoint ? box : null;
}

// Frames the scene once per `fitKey` (mount = first entry to 3D, and project
// switch). Deliberately does NOT depend on the scene contents, so inspector
// edits / selection changes never yank the camera (spec §4.2). The user
// reclaims framing via the Overview preset (M4).
function CameraRig({ scene, fitKey }: { scene: Scene3d; fitKey: string }) {
  const camera = useThree((state) => state.camera);
  const controls = useThree((state) => state.controls) as OrbitControlsImpl | null;
  const invalidate = useThree((state) => state.invalidate);

  // Latest scene without making it an effect dependency — the fit reads current
  // geometry when it does run, but only runs on fitKey change.
  const sceneRef = useRef(scene);
  sceneRef.current = scene;

  useEffect(() => {
    const bounds = sceneBounds(sceneRef.current);
    if (!bounds) return;

    const center = bounds.getCenter(new Vector3());
    const elevation = MathUtils.degToRad(FIT_ELEVATION_DEG);
    const azimuth = MathUtils.degToRad(FIT_AZIMUTH_DEG);
    const direction = new Vector3(
      Math.cos(elevation) * Math.sin(azimuth),
      Math.sin(elevation),
      Math.cos(elevation) * Math.cos(azimuth)
    );
    const aspect =
      camera instanceof PerspectiveCamera ? camera.aspect : 1;
    const distance = fitDistance(bounds, direction, CAMERA_FOV_DEG, aspect);

    camera.position.copy(center).addScaledVector(direction, distance);
    camera.near = Math.max(distance / 1000, 0.01);
    camera.far = distance * 100;
    camera.updateProjectionMatrix();
    camera.lookAt(center);

    if (controls) {
      controls.target.copy(center);
      controls.update();
    }
    invalidate();
    // fitKey / controls only: refit on entry + project switch, and once when
    // OrbitControls first registers. Not on scene edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey, controls]);

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

export function ThreeDView({
  project,
  artworksById,
  getBlob
}: {
  project: Project;
  artworksById: ReadonlyMap<string, Artwork>;
  getBlob: (key: string) => Promise<Blob>;
}) {
  const scene = useMemo(
    () => deriveScene3d(project, artworksById),
    [project, artworksById]
  );

  if (scene.rooms.length === 0) {
    return <ThreeDEmptyState />;
  }

  return (
    // The app canvas background token carries the backdrop (spec §6.1); a
    // transparent WebGL canvas lets it show through so 3D honours the theme.
    <div className="three-view" style={{ height: "100%", background: "var(--bg)" }}>
      <Canvas
        frameloop="demand"
        dpr={[1, 2]}
        gl={{ alpha: true, antialias: true }}
        camera={{ fov: CAMERA_FOV_DEG, near: 0.01, far: 1000, position: [4, 4, 4] }}
        onCreated={(state) => {
          if (import.meta.env.DEV) {
            // Dev-only escape hatch so browser-driven verification (and
            // debugging) can reach the LIVE R3F state (the state object is
            // replaced on internal updates, so expose the getter, not a
            // snapshot); stripped from prod builds.
            (window as unknown as { __sightlines3d?: unknown }).__sightlines3d =
              state.get;
          }
        }}
      >
        {/* Soft, shadowless lighting (spec §6.1): flat ambient plus one gentle
            high front-left key so walls shade apart and read as volume. */}
        <ambientLight intensity={0.9} />
        <directionalLight intensity={0.4} position={[-6, 8, 6]} />
        <SceneRooms scene={scene} getBlob={getBlob} />
        <OrbitControls makeDefault enableDamping dampingFactor={0.1} />
        <CameraRig scene={scene} fitKey={project.id} />
      </Canvas>
    </div>
  );
}
