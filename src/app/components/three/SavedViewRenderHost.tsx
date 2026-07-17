// Invisible, always-mounted host that renders Saved views to PNG on demand for
// the PDF exporter (spec §8.2, §9.5, §16). It reuses SnapshotStage — the same
// offscreen, pose-driven Canvas the 3D "Export image" path uses — but is mounted
// outside the view-mode conditional so a document can be assembled from Plan,
// Elevation, Library, or 3D. Requests are served one at a time (sequential
// rendering is deliberate for iPad memory, §16); the scene is derived lazily and
// only while work is pending, so idle project edits pay nothing here.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Vector3 } from "three";
import type { Artwork, Project, SavedView } from "../../../domain/project";
import { deriveScene3d } from "../../../domain/geometry/scene3d";
import { isDegeneratePose } from "../../../domain/savedViews";
import type { RenderSavedView } from "../../export/createDocumentPdf";
import type { CameraPose } from "./cameraNav";
import { SnapshotStage, type SnapshotRequest } from "./SnapshotStage";

// The PDF writer asks for ~300dpi sizes; clamp the long edge to the same ceiling
// SnapshotStage uses for live captures so a large page can't demand an oversized
// framebuffer. Aspect is preserved.
const RENDER_MAX_DIMENSION_PX = 4096;

export type SavedViewRenderHandle = {
  renderSavedView: RenderSavedView;
};

type QueueItem = {
  view: SavedView;
  widthPx: number;
  heightPx: number;
  resolve: (blob: Blob) => void;
  reject: (error: unknown) => void;
};

function clampSize(
  widthPx: number,
  heightPx: number
): { widthPx: number; heightPx: number } {
  const width = Math.max(1, Math.round(widthPx));
  const height = Math.max(1, Math.round(heightPx));
  const longEdge = Math.max(width, height);
  if (longEdge <= RENDER_MAX_DIMENSION_PX) return { widthPx: width, heightPx: height };
  const scale = RENDER_MAX_DIMENSION_PX / longEdge;
  return {
    widthPx: Math.max(1, Math.round(width * scale)),
    heightPx: Math.max(1, Math.round(height * scale))
  };
}

export function SavedViewRenderHost({
  project,
  artworksById,
  getBlob,
  actionsRef
}: {
  project: Project;
  artworksById: ReadonlyMap<string, Artwork>;
  getBlob: (key: string) => Promise<Blob>;
  actionsRef: { current: SavedViewRenderHandle | null };
}) {
  const queueRef = useRef<QueueItem[]>([]);
  const activeRef = useRef(false);
  const unmountedRef = useRef(false);
  const [activeRequest, setActiveRequest] = useState<SnapshotRequest | null>(null);
  const [hasWork, setHasWork] = useState(false);

  // Derived only while a request is pending — idle project edits don't pay for
  // a 3D scene the host isn't about to render.
  const scene = useMemo(
    () => (hasWork ? deriveScene3d(project, artworksById) : null),
    [hasWork, project, artworksById]
  );

  const pump = useCallback(() => {
    if (activeRef.current) return;
    const next = queueRef.current.shift();
    if (!next) {
      // Queue drained: unmount the stage (and release its WebGL context) only
      // now — it stays mounted between requests so a batch shares one context.
      setActiveRequest(null);
      setHasWork(false);
      return;
    }
    activeRef.current = true;
    const pose: CameraPose = {
      position: new Vector3(
        next.view.pose.position.x,
        next.view.pose.position.y,
        next.view.pose.position.z
      ),
      target: new Vector3(
        next.view.pose.target.x,
        next.view.pose.target.y,
        next.view.pose.target.z
      )
    };
    setActiveRequest({
      format: "png",
      pose,
      widthPx: next.widthPx,
      heightPx: next.heightPx,
      resolve: next.resolve,
      reject: next.reject
    });
  }, []);

  const renderSavedView = useCallback<RenderSavedView>(
    (view, size) =>
      new Promise<Blob>((resolve, reject) => {
        if (unmountedRef.current) {
          reject(new Error("The 3D render host is not available."));
          return;
        }
        // Never render a numerically invalid pose (§8.4). The writer's manifest
        // already excludes these, so this is a defensive backstop, not the
        // primary gate.
        if (isDegeneratePose(view.pose)) {
          reject(new Error("This Saved view has an invalid camera pose."));
          return;
        }
        const clamped = clampSize(size.widthPx, size.heightPx);
        queueRef.current.push({
          view,
          widthPx: clamped.widthPx,
          heightPx: clamped.heightPx,
          resolve,
          reject
        });
        // Derive the scene (if not already) and start the queue in one batched
        // update so the stage mounts with a ready scene.
        setHasWork(true);
        pump();
      }),
    [pump]
  );

  const handleSettled = useCallback(() => {
    activeRef.current = false;
    // Advance in place: swapping `request` on the still-mounted stage restarts
    // its capture effect, so consecutive renders reuse one WebGL context and
    // the already-decoded textures instead of remounting per view.
    pump();
  }, [pump]);

  // Cover the initial idle state (first enqueue arrives before any settle).
  useEffect(() => {
    if (activeRequest === null) pump();
  }, [activeRequest, pump]);

  useEffect(() => {
    if (!actionsRef) return;
    actionsRef.current = { renderSavedView };
    return () => {
      actionsRef.current = null;
    };
  }, [actionsRef, renderSavedView]);

  useEffect(() => {
    // Reset on the effect body, not just cleanup: StrictMode's dev-only
    // mount → cleanup → remount cycle would otherwise leave the flag stuck
    // true and every render request rejected.
    unmountedRef.current = false;
    return () => {
      unmountedRef.current = true;
      const pending = queueRef.current.splice(0);
      for (const item of pending) {
        item.reject(
          new Error("The 3D render host was unmounted before this Saved view rendered.")
        );
      }
    };
  }, []);

  return scene && activeRequest ? (
    <SnapshotStage
      derivedScene={scene}
      artworksById={artworksById}
      getBlob={getBlob}
      request={activeRequest}
      onSettled={handleSettled}
    />
  ) : null;
}
