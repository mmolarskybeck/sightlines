import { resolveMonitorSupport } from "../../domain/geometry/monitorGlyphs";
import {
  DEFAULT_FLOOR_OBJECT_IMAGE_FACES,
  type FloorObjectBase,
  type FloorObjectFace,
  type MonitorSupport,
  type Project
} from "../../domain/project";
import type { AppState, EditExtras } from "../store";
import { moveObjectNoun } from "./openingEdits";

export type FloorObjectSliceActions = {
  updateFloorObject: (
    objectId: string,
    changes: Partial<
      Pick<
        FloorObjectBase,
        "xMm" | "yMm" | "widthMm" | "depthMm" | "heightMm" | "rotationDeg" | "baseHeightMm"
      >
    >
  ) => Promise<void>;
  // Which box faces a floor-placed ARTWORK shows its image on. Separate from
  // updateFloorObject on purpose: imageFaces lives on ArtworkFloorObject, not
  // FloorObjectBase (a blocked zone and a case have no image to map), and its
  // value is an array, which updateFloorObject's `!==` change guard would
  // mis-handle — two equal face sets are never reference-equal, so every
  // commit would look like a change and pile up undo entries.
  setFloorArtworkImageFaces: (objectId: string, faces: FloorObjectFace[]) => Promise<void>;
  // What a box-monitor placement stands on (pedestal or bare floor). Its own
  // action for the same reason as setFloorArtworkImageFaces: monitorSupport
  // lives on ArtworkFloorObject, not FloorObjectBase, so updateFloorObject's
  // FloorObjectBase-shaped change set cannot express it. Writes the literal
  // value — "pedestal" from the control is a STATED choice, distinct from the
  // absent "never chosen" that also resolves to pedestal.
  setFloorArtworkMonitorSupport: (
    objectId: string,
    monitorSupport: MonitorSupport
  ) => Promise<void>;
  // Snaps two floor-placed artworks together as one two-sided panel: the
  // moving board lands flat against the ANCHOR board's back face, rotated
  // 180°, so each work shows on an opposite side of the combined panel (the
  // hanging-projection-screen rig — two videos on one suspended board). Both
  // works stay ordinary independent placements; this is a one-shot pose edit,
  // not a persistent link.
  pairFloorArtworksBackToBack: (
    anchorObjectId: string,
    movingObjectId: string
  ) => Promise<void>;
};

export type FloorObjectSliceInternals = {
  applyEdit: (
    label: string,
    buildNextProject: (project: Project) => Project,
    extras?: EditExtras
  ) => Promise<void>;
};

// Floor objects carry no wall bounds, so nothing here runs the placement
// collision gate — every action commits straight through applyEdit.
export function createFloorObjectSlice(
  _set: (partial: Partial<AppState>) => void,
  get: () => AppState,
  internals: FloorObjectSliceInternals
): { actions: FloorObjectSliceActions } {
  const { applyEdit } = internals;

  const actions: FloorObjectSliceActions = {
    async updateFloorObject(objectId, changes) {
      const project = get().project;
      if (!project) return;

      const target = project.floorObjects.find((object) => object.id === objectId);
      if (!target) return;

      // heightMm is editable for cases (their overall floor-to-top height);
      // for artwork/blocked-zone the inspector never sends it, so including it
      // here is harmless — the equality guard drops any no-op change.
      //
      // rotationDeg and baseHeightMm join the same list: both are editable for
      // every floor object kind (Angle / Height off floor in the inspector).
      // baseHeightMm's guard compares against a possibly-undefined stored
      // value, which is correct — setting it to a real number is a change,
      // and re-sending the same number is not.
      const keys = [
        "xMm",
        "yMm",
        "widthMm",
        "depthMm",
        "heightMm",
        "rotationDeg",
        "baseHeightMm"
      ] as const;

      // Clamp baseHeightMm at the WRITE boundary, not in the field. The
      // schema declares it nonnegative (projectSchema.ts) and parseProject
      // THROWS, and that parse runs on every save (indexedDbProjectRepository)
      // — so a negative value commits fine in memory and then wedges
      // persistence, package export, and cloud backup behind a generic save
      // error. Worse, it is invisible: 3D strips baseHeightMm <= 0 and the
      // elevation builder gates on > 0, so all three views draw the object as
      // an ordinary floor-resting work while nothing can be saved.
      //
      // Clamping here rather than making the field positiveOnly is deliberate:
      // 0 is the meaningful "resting on the floor" value a curator must be
      // able to type back in to un-suspend a work, and positiveOnly would
      // reject it. A bottom edge below the floor has no physical meaning, so
      // folding it to 0 is the honest reading of the input, not data loss.
      const safeChanges =
        changes.baseHeightMm !== undefined && changes.baseHeightMm < 0
          ? { ...changes, baseHeightMm: 0 }
          : changes;

      const hasChange = keys.some(
        (key) => safeChanges[key] !== undefined && safeChanges[key] !== target[key]
      );
      if (!hasChange) return;

      const nextFloorObjects = project.floorObjects.map((object) =>
        object.id === objectId ? { ...object, ...safeChanges } : object
      );

      // Floor objects carry no wall bounds, so there's nothing to validate
      // here in v1 (see placeArtworkOnFloor).
      await applyEdit(`Edit ${moveObjectNoun(target.kind)}`, (current) => ({
        ...current,
        floorObjects: nextFloorObjects
      }));
    },

    async setFloorArtworkImageFaces(objectId, faces) {
      const project = get().project;
      if (!project) return;

      const target = project.floorObjects.find((object) => object.id === objectId);
      // Kind-gated at the write, not just in the UI: imageFaces is only
      // representable on ArtworkFloorObject, so a stray call for a case or a
      // blocked zone is dropped rather than stored somewhere every reader
      // would then have to remember to ignore.
      if (!target || target.kind !== "artwork") return;

      // Order-insensitive set comparison, NOT array equality: the picker
      // rebuilds the array on every toggle, so `!==` (or even an
      // element-by-element compare against a differently-ordered set) would
      // report a change for an identical selection and push a dead undo
      // entry. Faces are a SET; the stored order carries no meaning.
      const current = target.imageFaces ?? DEFAULT_FLOOR_OBJECT_IMAGE_FACES;
      const sameSet =
        current.length === faces.length && current.every((face) => faces.includes(face));
      if (sameSet) return;

      const nextFloorObjects = project.floorObjects.map((object) =>
        object.id === objectId ? { ...object, imageFaces: [...faces] } : object
      );

      await applyEdit("Edit image faces", (current) => ({
        ...current,
        floorObjects: nextFloorObjects
      }));
    },

    async setFloorArtworkMonitorSupport(objectId, monitorSupport) {
      const project = get().project;
      if (!project) return;

      const target = project.floorObjects.find((object) => object.id === objectId);
      // Kind-gated at the write, exactly like setFloorArtworkImageFaces:
      // monitorSupport is only representable on ArtworkFloorObject, so a
      // stray call for a case or a blocked zone is dropped rather than stored
      // somewhere every reader would then have to remember to ignore.
      if (!target || target.kind !== "artwork") return;

      // Compare against the RESOLVED value, not the stored one: an untouched
      // placement is already showing a pedestal, so re-choosing "pedestal"
      // must not push a dead undo entry. It does still get WRITTEN the first
      // time it differs from absent in nothing but explicitness — that is why
      // this is a resolved-value comparison and not `target.monitorSupport
      // === monitorSupport`. (Absent + "pedestal" therefore stays absent,
      // which is the honest record: the curator never overrode the default.)
      if (resolveMonitorSupport(target.monitorSupport) === monitorSupport) return;

      const nextFloorObjects = project.floorObjects.map((object) =>
        object.id === objectId ? { ...object, monitorSupport } : object
      );

      await applyEdit("Edit monitor support", (current) => ({
        ...current,
        floorObjects: nextFloorObjects
      }));
    },

    async pairFloorArtworksBackToBack(anchorObjectId, movingObjectId) {
      const project = get().project;
      if (!project) return;

      const anchor = project.floorObjects.find((object) => object.id === anchorObjectId);
      const moving = project.floorObjects.find((object) => object.id === movingObjectId);
      // Kind-gated at the write like setFloorArtworkImageFaces: only artwork
      // has an image to face outward, and the UI only offers the action for
      // a two-floor-artwork selection anyway.
      if (!anchor || !moving || anchor.id === moving.id) return;
      if (anchor.kind !== "artwork" || moving.kind !== "artwork") return;

      // The anchor's BACK direction in plan space. Convention chain: a floor
      // object's front (+z in the 3D box's local frame — see FloorObjectFace)
      // points along plan +y at rotationDeg 0, and rotationDeg rotates plan
      // vectors by the standard [[cos,-sin],[sin,cos]] matrix (the SVG
      // rotate() PlanRect renders with, and the same angle FloorObjectBox
      // negates into a three.js yaw). So back = that matrix applied to
      // (0,-1) = (sin, -cos).
      const angleRad = (anchor.rotationDeg * Math.PI) / 180;
      const backNormal = { xMm: Math.sin(angleRad), yMm: -Math.cos(angleRad) };
      // Centers separate by the two half-depths: the boards' faces touch.
      const offsetMm = anchor.depthMm / 2 + moving.depthMm / 2;

      // Vertical: a suspended anchor reads as a shared hanging rig, so the
      // boards' TOP edges align (wires drop to the top corners); an anchor
      // resting on the floor pulls the moving board down to rest beside it.
      const anchorBaseMm = anchor.baseHeightMm ?? 0;
      const movingBaseMm =
        anchorBaseMm > 0
          ? Math.max(0, anchorBaseMm + anchor.heightMm - moving.heightMm)
          : 0;

      // Each board keeps its faces except "back", which now presses against
      // the other board and can't be seen. Resolves the absent-means-default
      // rule at this write (absent -> front+back -> front), producing a
      // stated choice — the same thing the curator would do by hand.
      const withoutBack = (faces: FloorObjectFace[] | undefined): FloorObjectFace[] =>
        (faces ?? DEFAULT_FLOOR_OBJECT_IMAGE_FACES).filter((face) => face !== "back");

      const nextFloorObjects = project.floorObjects.map((object) => {
        if (object.id === anchor.id) {
          return { ...object, imageFaces: withoutBack(anchor.imageFaces) };
        }
        if (object.id === moving.id) {
          return {
            ...object,
            xMm: anchor.xMm + backNormal.xMm * offsetMm,
            yMm: anchor.yMm + backNormal.yMm * offsetMm,
            rotationDeg: anchor.rotationDeg + 180,
            imageFaces: withoutBack(moving.imageFaces),
            // Absence discipline (see FloorMemory): a board that was never
            // suspended and stays on the floor keeps the key absent rather
            // than gaining a spurious 0.
            ...(movingBaseMm > 0 || moving.baseHeightMm !== undefined
              ? { baseHeightMm: movingBaseMm }
              : {})
          };
        }
        return object;
      });

      await applyEdit("Pair works back-to-back", (current) => ({
        ...current,
        floorObjects: nextFloorObjects
      }));
    },
  };

  return { actions };
}
