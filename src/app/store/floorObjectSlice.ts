import {
  isMonitorArtwork,
  resolveMonitorSupport
} from "../../domain/geometry/monitorGlyphs";
import {
  defaultFloorSupport,
  normalizeFloorSupport,
  resolveFloorSupport,
  resolveStandsOn
} from "../../domain/geometry/supportGlyphs";
import {
  DEFAULT_FLOOR_OBJECT_IMAGE_FACES,
  type ArtworkFloorObject,
  type FloorObject,
  type FloorObjectBase,
  type FloorObjectFace,
  type FloorSupport,
  type MonitorSupport,
  type Project
} from "../../domain/project";
import type { AppState, EditExtras } from "../store";
import { moveObjectNoun } from "./openingEdits";

// Where a work goes when the curator picks "Suspended" and there is no height
// to go back to. The app has never had a suspension default — "Height off
// floor" is a plain number field seeded from `baseHeightMm ?? 0` — so this is a
// NEW number, chosen as a plausible hanging height for a work on wires rather
// than derived from anything: a 0 would read as "nothing happened" and leave
// resolveStandsOn still answering "floor". A stale positive baseHeightMm left
// under a support wins over it, so switching support → suspended restores the
// height the work hung at before the pedestal went in.
export const DEFAULT_SUSPENSION_HEIGHT_MM = 1000;

// What a floor-placed work stands on, as the inspector's one select reads and
// writes it. Mirrors resolveStandsOn's return type — the read and the write
// must name the same four states or the control can show one it cannot set.
export type FloorArtworkStandsOn = "floor" | "pedestal" | "plinth" | "suspended";

// Structural equality for a support box. Every field is a number, a string or a
// boolean, so this is a complete comparison — used to drop no-op writes before
// they reach applyEdit and pile up dead undo entries (the same duty
// setFloorArtworkImageFaces' set comparison does for faces).
function sameSupport(a: FloorSupport | undefined, b: FloorSupport | undefined): boolean {
  if (a === undefined || b === undefined) return a === b;
  return (
    a.kind === b.kind &&
    a.widthMm === b.widthMm &&
    a.depthMm === b.depthMm &&
    a.heightMm === b.heightMm &&
    a.offsetXMm === b.offsetXMm &&
    a.offsetYMm === b.offsetYMm &&
    a.overhangAllowed === b.overhangAllowed &&
    a.bonnetHeightMm === b.bonnetHeightMm &&
    a.bonnetHeightLocked === b.bonnetHeightLocked
  );
}

// Re-runs THE support normaliser (geometry/supportGlyphs.ts) against a floor
// object's CURRENT dimensions, returning the same object when nothing moved.
//
// Called from every path that resizes the work rather than the support — the
// inspector's Width/Depth/Height fields here, and the artwork-dimension rebake
// in store.ts — because the relational invariants are all stated in terms of
// the work: a work that grows past its pedestal's top face must push the
// pedestal out in the SAME undo entry, or an undo would take back only half of
// it.
export function withNormalizedSupport<T extends FloorObject>(object: T): T {
  if (object.kind !== "artwork" || !object.support) return object;
  const { support, changed } = normalizeFloorSupport(object, object.support);
  return changed ? { ...object, support } : object;
}

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
  // What a floor-placed ARTWORK stands on, as one four-state choice: bare
  // floor, a pedestal, a plinth, or wires. One action rather than a support
  // writer plus a suspension writer because the four states are MUTUALLY
  // EXCLUSIVE and each transition has to clear the losing state's keys in the
  // same entry — a pedestal left beside a stale baseHeightMm renders as a
  // pedestal (the support wins) and then springs back into the air the moment
  // the pedestal is removed. One undo entry, "Change support".
  //
  // A monitor never gets "suspended" (the elevation ghost, CrtMonitorMesh and
  // resolveStandsOn all refuse to float a cabinet), so that combination is a
  // no-op rather than a state the UI has to remember not to offer.
  setFloorArtworkStandsOn: (
    objectId: string,
    standsOn: FloorArtworkStandsOn
  ) => Promise<void>;
  // Edits the support BOX itself (size, the work's offset on it, overhang, the
  // plexi bonnet). Every write runs normalizeFloorSupport, so the relational
  // invariants hold after an inspector commit exactly as they do after a load:
  // a width typed smaller than the work clamps back up, an offset that would
  // detach the pedestal clamps in, an unlocked bonnet re-derives its height.
  //
  // `changes` follows the store's usual absent-vs-present discipline with ONE
  // documented addition: an EXPLICIT `undefined` for an optional key deletes
  // it. That is the only way to express "turn the bonnet off"
  // (`{ bonnetHeightMm: undefined }`), which must delete the height AND its
  // lock rather than write a 0 the schema would reject.
  //
  // Typing a number into the bonnet height LOCKS it (bonnetHeightLocked: true)
  // — a number the curator typed is a number they meant, and an unlocked
  // bonnet would re-derive it away on the very next normalise. Enabling the
  // bonnet does not lock: that write sets the height from absent, and the
  // derived-tracking reading is the right default. "Fit to work" is
  // `{ bonnetHeightLocked: false }`, which hands the height back to the work.
  updateFloorArtworkSupport: (
    objectId: string,
    changes: Partial<FloorSupport>
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

      // withNormalizedSupport rides the SAME entry: Width/Depth/Height here
      // size the WORK, and the support's invariants are all stated against the
      // work's footprint, so a work typed wider than its pedestal grows the
      // pedestal (and re-derives an unlocked bonnet) as part of this one edit.
      // Splitting it into a second applyEdit would make one undo restore a work
      // that no longer fits the box it is standing on.
      const nextFloorObjects = project.floorObjects.map((object) =>
        object.id === objectId
          ? withNormalizedSupport({ ...object, ...safeChanges })
          : object
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

    async setFloorArtworkStandsOn(objectId, standsOn) {
      const project = get().project;
      if (!project) return;

      const target = project.floorObjects.find((object) => object.id === objectId);
      // Kind-gated at the write, like every other field that lives on
      // ArtworkFloorObject rather than FloorObjectBase.
      if (!target || target.kind !== "artwork") return;

      const artwork = get().libraryArtworks.find(
        (candidate) => candidate.id === target.artworkId
      );
      const isMonitor = isMonitorArtwork(artwork);

      // A cabinet never hangs on wires. Refused here and not merely hidden in
      // the UI: resolveStandsOn already declines to report a monitor as
      // suspended, so writing the height would produce a document whose stored
      // state no control can see or undo.
      if (standsOn === "suspended" && isMonitor) return;

      // Compare against the RESOLVED state, not the stored keys — an untouched
      // monitor placement is already standing on its 800mm pedestal, so
      // re-choosing "Pedestal" must not push a dead undo entry (the same
      // resolved-value comparison setFloorArtworkMonitorSupport makes).
      if (resolveStandsOn(target, artwork) === standsOn) return;

      const next: ArtworkFloorObject = { ...target };

      if (standsOn === "pedestal" || standsOn === "plinth") {
        // defaultFloorSupport already sizes the box around the work, so the
        // normaliser has nothing to fix here; it runs anyway because it is
        // idempotent and because "every write goes through the normaliser" is
        // the invariant that keeps the stored shape honest.
        next.support = normalizeFloorSupport(
          target,
          defaultFloorSupport({
            kind: standsOn,
            objectWidthMm: target.widthMm,
            objectDepthMm: target.depthMm,
            objectHeightMm: target.heightMm,
            isMonitor,
            centerlineHeightMm: project.defaultCenterlineHeightMm
          })
        ).support;
        // Both losing states are cleared, not left dormant: baseHeightMm under
        // a support is ignored by every renderer, so leaving it would hide a
        // suspension that reappears when the support comes off, and an explicit
        // monitorSupport:"floor" would contradict the pedestal now under it.
        delete next.baseHeightMm;
        delete next.monitorSupport;
      } else if (standsOn === "floor") {
        delete next.support;
        delete next.baseHeightMm;
        // ABSENT WOULD RESOLVE BACK TO PEDESTAL for a monitor (see
        // ArtworkFloorObject.monitorSupport), so bare floor has to be stated.
        // Non-monitor works never read this field, so theirs is left alone
        // rather than gaining a key no renderer consults.
        if (isMonitor) next.monitorSupport = "floor";
      } else {
        delete next.support;
        // A height the work already had wins over the default: taking a work
        // off its pedestal and back onto wires should return it to where it
        // hung, and a stale positive baseHeightMm parked under a support is
        // exactly that memory.
        next.baseHeightMm =
          (target.baseHeightMm ?? 0) > 0
            ? (target.baseHeightMm as number)
            : DEFAULT_SUSPENSION_HEIGHT_MM;
      }

      const nextFloorObjects = project.floorObjects.map((object) =>
        object.id === objectId ? next : object
      );

      await applyEdit("Change support", (current) => ({
        ...current,
        floorObjects: nextFloorObjects
      }));
    },

    async updateFloorArtworkSupport(objectId, changes) {
      const project = get().project;
      if (!project) return;

      const target = project.floorObjects.find((object) => object.id === objectId);
      if (!target || target.kind !== "artwork") return;

      const artwork = get().libraryArtworks.find(
        (candidate) => candidate.id === target.artworkId
      );
      // Read through the resolver so a monitor's implicit 800mm pedestal can be
      // edited at all: the first edit MATERIALISES it as an explicit support
      // (source "monitor-default" has no stored object behind it), which is
      // also the moment the curator stops being covered by the absent-means-
      // pedestal default and starts owning the numbers.
      const resolved = resolveFloorSupport(target, artwork);
      if (!resolved) return;
      const { source: _source, ...current } = resolved;

      // Explicit `undefined` DELETES; a key not present in `changes` keeps the
      // current value. `in` rather than a truthiness or `!== undefined` test is
      // the whole mechanism — `{ bonnetHeightMm: undefined }` (turn the bonnet
      // off) and `{}` (change nothing) are otherwise indistinguishable.
      const pick = <K extends keyof FloorSupport>(
        key: K
      ): FloorSupport[K] | undefined => (key in changes ? changes[key] : current[key]);

      const offsetXMm = pick("offsetXMm");
      const offsetYMm = pick("offsetYMm");
      const overhangAllowed = pick("overhangAllowed");
      const bonnetHeightMm = pick("bonnetHeightMm");
      let bonnetHeightLocked = pick("bonnetHeightLocked");

      // Typing a number into the bonnet height locks it. Gated on the bonnet
      // ALREADY being on, which is what separates "typed a height" from
      // "switched the bonnet on" — the enable write also carries a height (the
      // derived one), and locking there would freeze a number the curator never
      // chose and stop it tracking the work.
      if (
        current.bonnetHeightMm !== undefined &&
        typeof changes.bonnetHeightMm === "number" &&
        changes.bonnetHeightLocked === undefined
      ) {
        bonnetHeightLocked = true;
      }

      const merged: FloorSupport = {
        kind: pick("kind") ?? current.kind,
        widthMm: pick("widthMm") ?? current.widthMm,
        depthMm: pick("depthMm") ?? current.depthMm,
        heightMm: pick("heightMm") ?? current.heightMm,
        ...(offsetXMm !== undefined ? { offsetXMm } : {}),
        ...(offsetYMm !== undefined ? { offsetYMm } : {}),
        ...(overhangAllowed !== undefined ? { overhangAllowed } : {}),
        ...(bonnetHeightMm !== undefined ? { bonnetHeightMm } : {}),
        ...(bonnetHeightLocked !== undefined ? { bonnetHeightLocked } : {})
      };

      // THE normaliser, on every write (see updateFloorObject for the other
      // half of the rule). A clamped write still commits the clamped value, so
      // the inspector's fields — which read back from the store — show what was
      // actually stored rather than what was typed.
      const { support } = normalizeFloorSupport(target, merged);

      // Compared against the RESOLVED support, so a monitor edit that clamps
      // back to its own default does not materialise a support that changes
      // nothing, and a re-commit of an unchanged field pushes no undo entry.
      if (sameSupport(current, support)) return;

      const nextFloorObjects = project.floorObjects.map((object) =>
        object.id === objectId ? { ...object, support } : object
      );

      await applyEdit("Edit support", (current) => ({
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
