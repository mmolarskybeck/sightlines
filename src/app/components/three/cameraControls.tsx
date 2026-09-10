import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import { PerspectiveCamera, Vector3 } from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { type SavedViewPose } from "../../../domain/project";
import { isEditableTarget } from "../../hooks/isEditableTarget";
import {
  canZoomStep,
  clampFocusDistance,
  clampZoomFactorToEnvelope,
  keyboardZoomFactor,
  normalizeWheelDeltaY,
  travelStepDistance,
  updateCameraClipping,
  zoomFactorFromDelta,
  type CameraPose
} from "./cameraNav";
import {
  cursorNdc,
  easeInOutCubic,
  eyeLevelView,
  FLIGHT_MS,
  FLOOR_PLANE,
  overviewPose,
  roomBounds,
  toCameraPose
} from "./sceneCamera";
import { fitDistance } from "./cameraFit";
import { CAMERA_FOV_DEG } from "./sceneConstants";
import type { Room3d, Scene3d, WallArtwork3d, WallPanel3d } from "../../../domain/geometry/scene3d";

export type CameraRigApi = {
  overview: () => void;
  eyeLevel: (
    wall: WallPanel3d,
    artwork: WallArtwork3d | null,
    eyeHeightMm: number
  ) => ReadonlySet<string>;
  focus: (target: Vector3) => void;
  frameRoom: (room: Room3d) => void;
  focusFloorUnderCursor: (clientX: number, clientY: number) => void;
  // One dolly step in/out, anchored on the orbit target (there is no cursor to
  // anchor on when the step comes from a button or a keystroke). The single
  // implementation behind BOTH the Cmd/Ctrl +/- shortcut and the viewport's
  // +/- buttons, so the two can never drift on step size or on where the
  // envelope clamp bites.
  zoomStep: (direction: "in" | "out") => void;
  // Move to an explicit stored pose (Saved views open-in-3D, spec §4.3):
  // animated by default, an instant cut when `immediate` (reduced motion).
  flyToPose: (pose: CameraPose, options?: { immediate?: boolean }) => void;
};

// Owns the camera: jumps to the fitted overview on entry/project switch
// (deliberately NOT on scene edits — spec §4.2; Overview reclaims framing),
// and animates the two presets. Both presets end in free orbit.
export function CameraRig({
  scene,
  fitKey,
  apiRef,
  initialPose
}: {
  scene: Scene3d;
  fitKey: string;
  apiRef: React.MutableRefObject<CameraRigApi | null>;
  // A Saved-view pose to seat as the INITIAL camera instead of the fitted
  // overview, when 3D mounts to open a view (saved-views spec §4.3 handoff).
  // Captured once at mount so later prop churn can't re-fire it; consumed on
  // the controls-ready fit run so a subsequent project switch reclaims the
  // overview framing as usual.
  initialPose?: SavedViewPose;
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

  // Captured once at mount: the fit effect seats this instead of the overview,
  // then nulls it once controls register so a later refit falls through to the
  // overview.
  const initialPoseRef = useRef<CameraPose | null>(
    initialPose ? toCameraPose(initialPose) : null
  );

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
      zoomStep: (direction) => {
        if (!controls) return;
        // Same >1-dollies-out/<1-dollies-in convention as CursorZoom, and the
        // same envelope clamp — the step shrinks to land exactly on the bound
        // rather than skipping it, and collapses to a no-op once there.
        const currentDistance = camera.position.distanceTo(controls.target);
        const factor = clampZoomFactorToEnvelope(
          currentDistance,
          keyboardZoomFactor(direction)
        );
        if (Math.abs(factor - 1) < 1e-6) return;
        // point === target, so the target lerp is a no-op and the camera simply
        // slides along the view ray — the "zoom at centre" read for an orbit rig.
        camera.position.lerp(controls.target, 1 - factor);
        updateCameraClipping(camera, camera.position.distanceTo(controls.target));
        controls.update();
        invalidate();
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
      },
      flyToPose: (pose, options) => {
        if (options?.immediate) applyPose(pose);
        else flyTo(pose);
      }
    };
  });

  useEffect(() => {
    // A pending Saved-view open seats its pose as the initial camera instead
    // of the overview (spec §4.3 handoff). Consume it only once controls are
    // live, so the controls-registration re-run of this effect doesn't fall
    // through to the overview and clobber the handoff.
    const initial = initialPoseRef.current;
    if (initial) {
      applyPose(initial);
      if (controls) initialPoseRef.current = null;
    } else {
      const pose = overviewPose(sceneRef.current, aspect());
      if (pose) applyPose(pose);
    }
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
export function CursorZoom() {
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
      // Clamp the resulting orbit radius to the dolly envelope; the step scales
      // to land exactly on the bound rather than skipping it (cameraNav.ts).
      const factor = clampZoomFactorToEnvelope(
        currentDistance,
        zoomFactorFromDelta(normalizeWheelDeltaY(event))
      );
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

// Cmd/Ctrl +/- dolly the camera in/out around the orbit target — the 3D
// analogue of the 2D SVG viewport's Cmd/Ctrl +/- zoom (useSvgViewportGestures.ts).
// There's no cursor to anchor a keyboard shortcut on, so it anchors on
// controls.target instead of CursorZoom's raycast hit: with point ===
// target the target lerp below is a no-op and the camera simply slides
// along the view ray, which is the "zoom at center" read for an orbit rig.
export function KeyboardZoom({
  apiRef
}: {
  apiRef: React.MutableRefObject<CameraRigApi | null>;
}) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
      if (event.key !== "=" && event.key !== "+" && event.key !== "-") return;
      if (isEditableTarget(event.target)) return;
      // Block the browser's own page zoom in/out.
      event.preventDefault();
      // The rig owns the step (CameraRigApi.zoomStep) so the shortcut and the
      // viewport's +/- buttons are literally the same motion.
      apiRef.current?.zoomStep(event.key === "-" ? "out" : "in");
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [apiRef]);

  return null;
}

// Publishes whether a further dolly step in each direction would still move the
// camera, so the viewport's +/- buttons can disable themselves at the ends of
// the envelope exactly as the 2D cluster's do. Runs in useFrame — under
// frameloop="demand" that is precisely "whenever the camera moved" — and only
// calls back when the answer actually flips, so it never re-renders per frame.
export function ZoomBoundsTracker({
  onChange
}: {
  onChange: (bounds: { canZoomIn: boolean; canZoomOut: boolean }) => void;
}) {
  const camera = useThree((state) => state.camera);
  const controls = useThree((state) => state.controls) as OrbitControlsImpl | null;
  const last = useRef<string | null>(null);

  useFrame(() => {
    if (!controls) return;
    const distance = camera.position.distanceTo(controls.target);
    const next = {
      canZoomIn: canZoomStep(distance, "in"),
      canZoomOut: canZoomStep(distance, "out")
    };
    const key = `${next.canZoomIn}|${next.canZoomOut}`;
    if (key === last.current) return;
    last.current = key;
    onChange(next);
  });

  return null;
}

// Continuous WASD / arrow travel (spec §4.2): pure translation of camera and
// target together, so orbit radius is unchanged. Speed scales with zoom — a
// walk when close, a glide when zoomed out (envelope in cameraNav.ts).
//
// ARBITRATION WITH ARROW-KEY NUDGE: useArrangeNudgeShortcuts listens in window
// CAPTURE phase and, when a single wall artwork is selected in 3D, claims the
// arrow with stopImmediatePropagation — so the keydown below never fires and
// the code never enters `pressed`. WASD is never claimed, so travel keeps
// working while a work is selected. The keyup handler is deliberately NOT
// symmetric: it deletes unconditionally, so a keyup for a code this component
// never saw pressed is a harmless no-op and the set can't wedge if a press is
// swallowed mid-hold.
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

export function KeyboardTravel() {
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
