import { Canvas, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import type { Artwork } from "../../../domain/project";
import type { Scene3d } from "../../../domain/geometry/scene3d";
import { type CameraPose, updateCameraClipping } from "./cameraNav";
import { SceneRooms, sceneArtworkAssetIds } from "./SceneRooms";
import {
  AMBIENT_LIGHT_INTENSITY,
  CAMERA_FAR,
  CAMERA_FOV_DEG,
  CAMERA_NEAR,
  KEY_LIGHT_INTENSITY,
  KEY_LIGHT_POSITION
} from "./sceneConstants";
import { SCENE_BACKGROUND_COLOR } from "./tokens";
import { useArtworkTextures } from "./useArtworkTextures";

export type SnapshotFormat = "png" | "jpeg";

export type SnapshotRequest = {
  format: SnapshotFormat;
  pose: CameraPose;
  // Target raster size, already scale-applied (snapshotPixelSize below) —
  // computed from the live viewport so framing matches it exactly (spec §2.2).
  widthPx: number;
  heightPx: number;
  resolve: (blob: Blob) => void;
  reject: (error: unknown) => void;
};

// Export renders well above the live canvas's capped dpr ([1, 2] on the
// interactive Canvas): a fixed multiplier on the current viewport's CSS pixel
// size keeps the export's framing identical to what's on screen while lifting
// resolution — an editorial constant, not a user option (spec §10.4). Capped
// so a very large monitor doesn't demand an oversized framebuffer.
const SNAPSHOT_EXPORT_SCALE = 3;
const SNAPSHOT_MAX_DIMENSION_PX = 4096;

// A texture load that never resolves (a missing/corrupt blob's promise is
// swallowed — see useArtworkTextures) must not hang the export forever;
// render with whatever is ready once this elapses.
const SNAPSHOT_TEXTURE_TIMEOUT_MS = 2000;
const SNAPSHOT_JPEG_QUALITY = 0.92;

export function snapshotPixelSize(
  liveWidthPx: number,
  liveHeightPx: number
): { width: number; height: number } {
  const longEdge = Math.max(liveWidthPx, liveHeightPx, 1);
  const scale = Math.min(SNAPSHOT_EXPORT_SCALE, SNAPSHOT_MAX_DIMENSION_PX / longEdge);
  return {
    width: Math.max(1, Math.round(liveWidthPx * scale)),
    height: Math.max(1, Math.round(liveHeightPx * scale))
  };
}

function noopSelectWall() {}
function noopSelectObject() {}
function noop() {}
const EMPTY_SELECTED_OBJECT_IDS: string[] = [];
const EMPTY_GHOSTED_WALL_IDS: ReadonlySet<string> = new Set();

// Applies the requested pose, waits for artwork textures (or the timeout),
// rasterizes exactly one manual frame, and settles the request's promise.
// The parent Canvas runs frameloop="never": nothing here auto-renders, so the
// one explicit gl.render call below is the only pixel this stage ever
// produces per request — no live-canvas readback, no repeated redraws.
function SnapshotRenderer({
  derivedScene,
  artworksById,
  getBlob,
  request,
  onSettled
}: {
  derivedScene: Scene3d;
  artworksById: ReadonlyMap<string, Artwork>;
  getBlob: (key: string) => Promise<Blob>;
  request: SnapshotRequest;
  onSettled: () => void;
}) {
  const camera = useThree((state) => state.camera);
  const threeScene = useThree((state) => state.scene);
  const gl = useThree((state) => state.gl);

  const assetIds = useMemo(() => sceneArtworkAssetIds(derivedScene), [derivedScene]);
  const texturesByAssetId = useArtworkTextures(assetIds, getBlob);
  const uniqueAssetIdCount = useMemo(
    () => new Set(assetIds.filter((id): id is string => Boolean(id))).size,
    [assetIds]
  );

  // Read the latest readiness from a poll loop that runs outside the
  // (disabled) r3f render loop, without making the poll a render dependency.
  const readyRef = useRef(false);
  readyRef.current = texturesByAssetId.size >= uniqueAssetIdCount;

  // Callers may pass an inline onSettled (ThreeDView does); read it through a
  // ref so a parent re-render mid-capture can't restart the effect below and
  // abort the capture.
  const onSettledRef = useRef(onSettled);
  onSettledRef.current = onSettled;

  useEffect(() => {
    camera.position.copy(request.pose.position);
    camera.lookAt(request.pose.target);
    updateCameraClipping(camera, request.pose.position.distanceTo(request.pose.target));

    const settledRef = { current: false };
    let rafId = 0;
    let frames = 0;
    const startedAt = performance.now();

    // With dpr={1}, the drawing buffer should land exactly on the requested
    // CSS-pixel size once r3f's ResizeObserver has applied it; a small
    // tolerance absorbs sub-pixel rounding under page zoom. The texture
    // timeout below backstops a mismatch so a capture can never hang on this.
    const sizeSettled = () =>
      Math.abs(gl.domElement.width - request.widthPx) <= 2 &&
      Math.abs(gl.domElement.height - request.heightPx) <= 2;

    const finish = () => {
      if (settledRef.current) return;
      settledRef.current = true;
      gl.render(threeScene, camera);
      const mimeType = request.format === "png" ? "image/png" : "image/jpeg";
      gl.domElement.toBlob(
        (blob) => {
          if (blob) request.resolve(blob);
          else request.reject(new Error("3D snapshot render produced no image data."));
          onSettledRef.current();
        },
        mimeType,
        request.format === "jpeg" ? SNAPSHOT_JPEG_QUALITY : undefined
      );
    };

    const poll = () => {
      frames += 1;
      const timedOut = performance.now() - startedAt >= SNAPSHOT_TEXTURE_TIMEOUT_MS;
      // At least two ticks even when nothing is loading, and the drawing
      // buffer must have picked up this request's size — consecutive requests
      // in one mount (the render host's queue) can differ in size, and the
      // ResizeObserver applies the new size asynchronously.
      if (frames > 1 && ((readyRef.current && sizeSettled()) || timedOut)) {
        finish();
        return;
      }
      rafId = requestAnimationFrame(poll);
    };
    rafId = requestAnimationFrame(poll);

    // A lost context (GPU reset, or the browser evicting a context under the
    // ~8–16 live-context cap) would leave the poll above spinning on a canvas
    // that can never produce a frame. There's nothing to recover mid-capture
    // here — an offscreen one-shot has no user watching it — so reject this
    // request cleanly and let the queue move on. preventDefault keeps the
    // canvas element reusable for the next request if the context returns.
    const onContextLost = (event: Event) => {
      event.preventDefault();
      if (settledRef.current) return;
      settledRef.current = true;
      cancelAnimationFrame(rafId);
      request.reject(new Error("3D snapshot lost its WebGL context before rendering."));
      onSettledRef.current();
    };
    gl.domElement.addEventListener("webglcontextlost", onContextLost, false);

    return () => {
      gl.domElement.removeEventListener("webglcontextlost", onContextLost, false);
      cancelAnimationFrame(rafId);
      if (!settledRef.current) {
        settledRef.current = true;
        request.reject(new Error("3D snapshot capture was interrupted."));
        onSettledRef.current();
      }
    };
    // Each request runs exactly one capture: a new request object (the render
    // host advancing its queue within one mount, or ThreeDView mounting a
    // fresh stage) restarts this effect; the cleanup rejects the old request
    // if it hadn't settled. camera/scene/gl are stable per Canvas mount, and
    // onSettled is read through a ref, so nothing else can restart a capture.
  }, [request, camera, threeScene, gl]);

  return (
    <SceneRooms
      scene={derivedScene}
      getBlob={getBlob}
      artworksById={artworksById}
      texturesByAssetId={texturesByAssetId}
      selectedObjectIds={EMPTY_SELECTED_OBJECT_IDS}
      selectedArtworkId={null}
      selectedWallId={null}
      onSelectWall={noopSelectWall}
      onSelectObject={noopSelectObject}
      onClearSelection={noop}
      onFocusPoint={noop}
      ghostedWallIds={EMPTY_GHOSTED_WALL_IDS}
    />
  );
}

// A second, hidden Canvas used only for one-off "Export image" captures in
// the 3D view (spec §2.2, §10.4). Deliberately NOT display:none — some
// browsers skip layout/rendering for a display:none subtree, which would
// starve the WebGL canvas of both a measurable size and paint time. Instead
// the outer wrapper clips a zero-size box (position:absolute, overflow:
// hidden) around an inner div sized to the real export resolution in CSS
// pixels, so react-three-fiber's ResizeObserver-based sizing measures the
// target resolution exactly while nothing is ever visible or takes layout
// space in the surrounding page.
//
// Mounted only while work is in flight, so no GPU memory for this stage
// persists while idle. ThreeDView mounts it per capture; SavedViewRenderHost
// keeps it mounted for the lifetime of its queue and swaps `request` in
// place, so a batch of Saved-view renders shares one WebGL context and one
// set of decoded textures instead of paying context + decode per view.
export function SnapshotStage({
  derivedScene,
  artworksById,
  getBlob,
  request,
  onSettled
}: {
  derivedScene: Scene3d;
  artworksById: ReadonlyMap<string, Artwork>;
  getBlob: (key: string) => Promise<Blob>;
  request: SnapshotRequest | null;
  onSettled: () => void;
}) {
  if (!request) return null;

  return (
    <div
      aria-hidden="true"
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        width: 0,
        height: 0,
        overflow: "hidden",
        pointerEvents: "none"
      }}
    >
      <div style={{ width: `${request.widthPx}px`, height: `${request.heightPx}px` }}>
        <Canvas
          frameloop="never"
          dpr={1}
          flat
          gl={{ antialias: true, preserveDrawingBuffer: true, alpha: false }}
          camera={{ fov: CAMERA_FOV_DEG, near: CAMERA_NEAR, far: CAMERA_FAR }}
        >
          <color attach="background" args={[SCENE_BACKGROUND_COLOR]} />
          <ambientLight intensity={AMBIENT_LIGHT_INTENSITY} />
          <directionalLight intensity={KEY_LIGHT_INTENSITY} position={KEY_LIGHT_POSITION} />
          <SnapshotRenderer
            derivedScene={derivedScene}
            artworksById={artworksById}
            getBlob={getBlob}
            request={request}
            onSettled={onSettled}
          />
        </Canvas>
      </div>
    </div>
  );
}
