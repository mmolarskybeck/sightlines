import { isMonitorArtwork } from "../../domain/geometry/monitorGlyphs";
import {
  BONNET_CLEARANCE_MM,
  BONNET_HEADROOM_MM,
  BONNET_MIN_HEIGHT_MM,
  PEDESTAL_MAX_HEIGHT_MM,
  PEDESTAL_MIN_HEIGHT_MM
} from "../../domain/geometry/supportGlyphs";
import { CASE_GLASS_THICKNESS_MM } from "../../domain/geometry/caseGlyphs";
import {
  createSupport,
  defaultSupportForWork,
  defaultSupportHeightMm,
  monitorPedestalForPlacement,
  supportFootprintCoveringMm,
  supportMarginMm
} from "../../domain/placement/createSupport";
import {
  getSupportRiders,
  resolveFloorStandsOn
} from "../../domain/placement/floorRiders";
import {
  DEFAULT_FLOOR_OBJECT_IMAGE_FACES,
  type Artwork,
  type ArtworkFloorObject,
  type FloorObject,
  type FloorObjectBase,
  type FloorObjectFace,
  type FloorSupportKind,
  type Project,
  type SupportFloorObject
} from "../../domain/project";
import type { AppState, EditExtras } from "../store";
import { moveObjectNoun } from "./openingEdits";

// Where a work goes when the curator picks "Suspend" and there is no height to
// go back to. The app has never had a suspension default — "Height off floor"
// is a plain number field seeded from `baseHeightMm ?? 0` — so this is a chosen
// number rather than a derived one: a plausible hanging height for a work on
// wires. 0 would read as "nothing happened" and leave resolveFloorStandsOn
// still answering "floor".
export const DEFAULT_SUSPENSION_HEIGHT_MM = 1000;

// The per-side inset from a support's edge to the largest rider footprint a
// bonnet can cover: the glass wall plus its clearance. Mirrors
// supportGlyphs.bonnetInsetMm, kept local so this slice states the rule it
// applies at the write boundary.
function bonnetInsetMm(): number {
  return CASE_GLASS_THICKNESS_MM + BONNET_CLEARANCE_MM;
}

// UI noun for a support kind. The inspector labels and the undo history both
// say "pedestal"/"plinth"; "support" and "rider" are internal words that never
// reach a curator (floor-supports spec §7).
function supportNoun(kind: FloorSupportKind): string {
  return kind === "plinth" ? "plinth" : "pedestal";
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
  // ─── Stands-on actions (floor-supports spec §7) ─────────────────────────
  //
  // The old stands-on WRITERS (setFloorArtworkStandsOn /
  // setFloorArtworkMonitorSupport / updateFloorArtworkSupport) are gone with
  // the attached-support model. What a work stands on is derived from geometry
  // (floorRiders.resolveFloorStandsOn); these actions do not write that
  // relationship, they MOVE THE GEOMETRY that produces it — which is why each
  // one is a single applyEdit rather than a field assignment.

  // Creates a pedestal/plinth under a floor-placed work and stands the work on
  // it: sized from the work by defaultSupportForWork, centred on it, at the
  // work's own angle, inserted into the floor list IMMEDIATELY BEFORE the work
  // so it draws beneath it. One undo entry; the selection stays on the work.
  //
  // An already-SUSPENDED work keeps its height: the new pedestal is built to
  // reach the work rather than dropping it to a default, clamped to what a
  // pedestal can physically be. A plinth keeps the plinth default — a
  // 1400mm-tall plinth is not a plinth.
  putFloorArtworkOnSupport: (objectId: string, kind: FloorSupportKind) => Promise<void>;
  // "Set on floor": DELETES baseHeightMm rather than writing 0. Absence is how
  // this codebase records "resting on the floor" (FloorObjectBase), and a
  // spurious 0 key makes a clean project hash dirty for the cloud backup check.
  // The support stays exactly where it is.
  setFloorArtworkOnFloor: (objectId: string) => Promise<void>;
  // "Suspend": hangs the work at DEFAULT_SUSPENSION_HEIGHT_MM. Refused (a
  // no-op) for a box monitor — a monitor is never suspended, an existing rule
  // the elevation ghost, the 3D mesh and resolveFloorStandsOn all already apply.
  suspendFloorArtwork: (objectId: string) => Promise<void>;
  // "Center on pedestal": moves the work to its support's centre in plan.
  centerFloorArtworkOnSupport: (objectId: string) => Promise<void>;

  // ─── Support inspector actions ──────────────────────────────────────────

  // Pedestal ⇄ plinth. A RELABEL: the height is re-defaulted only when the
  // current one is still the other kind's default, so a curator's typed height
  // survives the switch. When the height does change, the riders' baseHeightMm
  // follows in the same edit.
  setSupportKind: (supportId: string, kind: FloorSupportKind) => Promise<void>;
  // The plexi bonnet. `enabled` switches it on/off, `heightMm` types a height
  // (which LOCKS it only when a bonnet already exists — the enable write also
  // carries a height, and locking there would freeze a number nobody chose),
  // `locked` sets the lock explicitly (unlocking re-derives from the riders).
  // Enabling grows the footprint so the riders fit inside the glass and clears
  // overhangAllowed: you cannot hang a work over the edge of a box you have
  // also put glass around.
  setSupportBonnet: (
    supportId: string,
    changes: { enabled?: boolean; heightMm?: number; locked?: boolean }
  ) => Promise<void>;
  // "Allow overhang". Turning it OFF grows the footprint until the riders are
  // contained (no margin — they must simply be ON the top face).
  setSupportOverhangAllowed: (supportId: string, allowed: boolean) => Promise<void>;
  // "Fit to works": grows the footprint to the riders' union plus the kind's
  // curatorial reveal. NEVER shrinks (a curator who sized a big plinth by hand
  // did not ask for it back) and a no-op with no riders.
  fitSupportToWorks: (supportId: string) => Promise<void>;
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

  // id→Artwork for the joins the support rules need: "is this cabinet a box
  // monitor" (which decides the pedestal it gets and whether it may be
  // suspended at all) and resolveFloorStandsOn's monitor-is-never-suspended
  // reading. Rebuilt per call, exactly as placementSlice does it.
  function artworksById(): ReadonlyMap<string, Artwork> {
    return new Map(get().libraryArtworks.map((artwork) => [artwork.id, artwork]));
  }

  function artworkFor(object: ArtworkFloorObject): Artwork | undefined {
    return get().libraryArtworks.find((candidate) => candidate.id === object.artworkId);
  }

  function findSupport(project: Project, supportId: string): SupportFloorObject | undefined {
    return project.floorObjects.find(
      (object): object is SupportFloorObject =>
        object.kind === "support" && object.id === supportId
    );
  }

  // The box a fresh support gets for one work. A BOX MONITOR's pedestal is not
  // a curatorial choice with margins — it is the cabinet's own footprint at
  // MONITOR_PEDESTAL_HEIGHT_MM, the 2026-08-28 USER DECISION's default stand,
  // now expressed as an object instead of an absent field. A plinth under a
  // monitor is a deliberate different request and takes the ordinary rules.
  function supportBoxForWork(
    target: ArtworkFloorObject,
    artwork: Artwork | undefined,
    kind: FloorSupportKind,
    project: Project
  ): { widthMm: number; depthMm: number; heightMm: number } {
    if (kind === "pedestal" && isMonitorArtwork(artwork)) {
      const pedestal = monitorPedestalForPlacement({
        xMm: target.xMm,
        yMm: target.yMm,
        widthMm: target.widthMm,
        depthMm: target.depthMm,
        rotationDeg: target.rotationDeg
      });
      return {
        widthMm: pedestal.widthMm,
        depthMm: pedestal.depthMm,
        heightMm: pedestal.heightMm
      };
    }
    // The FLOOR OBJECT's own box, not the library record's dimensions: it is
    // what is actually standing on the floor (a resized placement, a monitor's
    // cabinet), and it is the box the containment rules then measure.
    return defaultSupportForWork({
      kind,
      work: { widthMm: target.widthMm, depthMm: target.depthMm, heightMm: target.heightMm },
      project
    });
  }

  // One commit path for every support-inspector edit: drop the no-op, carry the
  // riders through the same supportRiderEdits the numeric fields use (a height
  // change re-seats them), and push exactly one undo entry.
  async function commitSupport(
    target: SupportFloorObject,
    next: SupportFloorObject,
    label: string
  ): Promise<void> {
    const project = get().project;
    if (!project) return;
    if (sameSupport(target, next)) return;

    const riderEdits = supportRiderEdits(target, next, project.floorObjects);
    const nextFloorObjects = project.floorObjects.map((object) => {
      if (object.id === target.id) return next;
      const riderEdit = riderEdits.get(object.id);
      return riderEdit ? riderEdit(object) : object;
    });

    await applyEdit(label, (current) => ({
      ...current,
      floorObjects: nextFloorObjects
    }));
  }

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

      const moved = { ...target, ...safeChanges } as FloorObject;

      // A SUPPORT carries its riders (floor-supports spec §4), in this same
      // edit, so one undo puts the whole assembly back. This is the numeric
      // twin of the plan drag's rigid group: the inspector's X/Y and Angle
      // fields, the plan rotate handle and a 3D drag all commit through here,
      // so putting the rule at the write boundary is what makes every one of
      // them behave the same without four copies of the arithmetic.
      //
      //  - xMm/yMm   translate the riders by the same delta.
      //  - rotationDeg rotates each rider's CENTRE about the support's centre
      //    by the delta, and adds the delta to the rider's own rotationDeg —
      //    the assembly turns as one body, not as a box with loose objects on
      //    it.
      //  - heightMm  re-seats the riders: their baseHeightMm IS the top face.
      //  - widthMm/depthMm move nothing. Resizing the box under a work does
      //    not slide the work.
      const riderEdits =
        target.kind === "support"
          ? supportRiderEdits(target, moved as SupportFloorObject, project.floorObjects)
          : null;

      const nextFloorObjects = project.floorObjects.map((object) => {
        if (object.id === objectId) return moved;
        const riderEdit = riderEdits?.get(object.id);
        return riderEdit ? riderEdit(object) : object;
      });

      // Floor objects carry no wall bounds, so there's nothing to validate
      // here in v1 (see placeArtworkOnFloor).
      await applyEdit(`Edit ${moveObjectNoun(target.kind)}`, (current) => ({
        ...current,
        floorObjects: nextFloorObjects
      }));
    },

    async putFloorArtworkOnSupport(objectId, kind) {
      const project = get().project;
      if (!project) return;

      const index = project.floorObjects.findIndex((object) => object.id === objectId);
      if (index < 0) return;
      const target = project.floorObjects[index];
      if (target.kind !== "artwork") return;

      const artwork = artworkFor(target);
      const box = supportBoxForWork(target, artwork, kind, project);

      // Already suspended? The pedestal is built UP TO the work rather than
      // dropping it: the height the curator chose is the statement, and a
      // support that appeared under it at a stock height would move the work.
      // Clamped to what a pedestal can be; a plinth keeps its own default,
      // because a plinth is defined by being low.
      const standsOn = resolveFloorStandsOn(target, project.floorObjects, artworksById());
      const heightMm =
        standsOn.kind === "suspended" && kind === "pedestal"
          ? Math.min(
              Math.max(standsOn.heightMm, PEDESTAL_MIN_HEIGHT_MM),
              PEDESTAL_MAX_HEIGHT_MM
            )
          : box.heightMm;

      const support = createSupport({
        kind,
        xMm: target.xMm,
        yMm: target.yMm,
        rotationDeg: target.rotationDeg,
        widthMm: box.widthMm,
        depthMm: box.depthMm,
        heightMm
      });

      // BEFORE the work in the list: plan and 3D both draw floor objects in
      // stored order, so the box has to precede the thing standing on it or the
      // work is painted under its own pedestal.
      const nextFloorObjects = [
        ...project.floorObjects.slice(0, index),
        support,
        { ...target, baseHeightMm: support.heightMm },
        ...project.floorObjects.slice(index + 1)
      ];

      // No selection write: the curator is looking at the WORK's inspector and
      // pressed a button in it. Stealing the selection would swap the pane out
      // from under them.
      await applyEdit(`Put on ${supportNoun(kind)}`, (current) => ({
        ...current,
        floorObjects: nextFloorObjects
      }));
    },

    async setFloorArtworkOnFloor(objectId) {
      const project = get().project;
      if (!project) return;

      const target = project.floorObjects.find((object) => object.id === objectId);
      if (!target || target.baseHeightMm === undefined) return;

      const nextFloorObjects = project.floorObjects.map((object) =>
        object.id === objectId ? withoutBaseHeight(object) : object
      );

      await applyEdit("Set on floor", (current) => ({
        ...current,
        floorObjects: nextFloorObjects
      }));
    },

    async suspendFloorArtwork(objectId) {
      const project = get().project;
      if (!project) return;

      const target = project.floorObjects.find((object) => object.id === objectId);
      if (!target || target.kind !== "artwork") return;
      // A monitor is never suspended: a CRT on wires is not a thing, and every
      // renderer already treats a cabinet's baseHeightMm as 0 when nothing is
      // under it. Refusing here keeps the document from carrying a height no
      // view will draw.
      if (isMonitorArtwork(artworkFor(target))) return;
      if (target.baseHeightMm === DEFAULT_SUSPENSION_HEIGHT_MM) return;

      const nextFloorObjects = project.floorObjects.map((object) =>
        object.id === objectId
          ? { ...object, baseHeightMm: DEFAULT_SUSPENSION_HEIGHT_MM }
          : object
      );

      await applyEdit("Suspend artwork", (current) => ({
        ...current,
        floorObjects: nextFloorObjects
      }));
    },

    async centerFloorArtworkOnSupport(objectId) {
      const project = get().project;
      if (!project) return;

      const target = project.floorObjects.find((object) => object.id === objectId);
      if (!target) return;

      const standsOn = resolveFloorStandsOn(target, project.floorObjects, artworksById());
      if (standsOn.kind !== "support") return;
      const { support } = standsOn;
      if (target.xMm === support.xMm && target.yMm === support.yMm) return;

      const nextFloorObjects = project.floorObjects.map((object) =>
        object.id === objectId ? { ...object, xMm: support.xMm, yMm: support.yMm } : object
      );

      await applyEdit(`Center on ${supportNoun(support.supportKind)}`, (current) => ({
        ...current,
        floorObjects: nextFloorObjects
      }));
    },

    async setSupportKind(supportId, kind) {
      const project = get().project;
      if (!project) return;

      const target = findSupport(project, supportId);
      if (!target || target.supportKind === kind) return;

      // Re-default the height only while it is STILL the other kind's default.
      // A typed height is a curatorial number and survives a relabel; an
      // untouched one is just the previous kind's opinion and should become
      // this kind's.
      const heightMm =
        target.heightMm === defaultSupportHeightMm(target.supportKind)
          ? defaultSupportHeightMm(kind)
          : target.heightMm;

      const next: SupportFloorObject = { ...target, supportKind: kind, heightMm };
      await commitSupport(target, next, `Change to ${supportNoun(kind)}`);
    },

    async setSupportBonnet(supportId, changes) {
      const project = get().project;
      if (!project) return;

      const target = findSupport(project, supportId);
      if (!target) return;

      const riders = getSupportRiders(target, project.floorObjects, artworksById());
      const hadBonnet = target.bonnetHeightMm !== undefined;

      // Off: delete BOTH keys. Leaving bonnetHeightLocked behind would be a
      // lock on a bonnet that does not exist, and turning the bonnet back on
      // would silently inherit it.
      if (changes.enabled === false) {
        if (!hadBonnet) return;
        const next = { ...target } as SupportFloorObject;
        delete next.bonnetHeightMm;
        delete next.bonnetHeightLocked;
        await commitSupport(target, next, "Remove bonnet");
        return;
      }

      const wantsBonnet = hadBonnet || changes.enabled === true;
      if (!wantsBonnet) return;

      // Typing a height LOCKS it — but only when a bonnet is already on. The
      // enable write also carries a height (the derived one), and locking there
      // would freeze a number the curator never chose and stop it tracking the
      // works.
      const locked =
        changes.locked ??
        (hadBonnet && changes.heightMm !== undefined ? true : target.bonnetHeightLocked);

      const derivedMm = Math.max(
        BONNET_MIN_HEIGHT_MM,
        riders.reduce((tallest, rider) => Math.max(tallest, rider.heightMm), 0) +
          BONNET_HEADROOM_MM
      );
      const typedMm = changes.heightMm ?? target.bonnetHeightMm;
      const bonnetHeightMm =
        locked === true && typedMm !== undefined
          ? Math.max(BONNET_MIN_HEIGHT_MM, typedMm)
          : derivedMm;

      // The glass has to CLEAR the works: grow the footprint until every rider
      // fits inside it with the glass wall and its air. Never shrinks, and
      // symmetric about the centre (supportFootprintCoveringMm).
      const footprint = supportFootprintCoveringMm(target, riders, bonnetInsetMm());

      const next: SupportFloorObject = {
        ...target,
        ...footprint,
        bonnetHeightMm,
        ...(locked !== undefined ? { bonnetHeightLocked: locked } : {})
      };
      if (locked === undefined) delete next.bonnetHeightLocked;
      // A bonnet CLEARS overhang: the key is deleted, not set false, so
      // removing the bonnet later restores "never chosen".
      delete next.overhangAllowed;

      await commitSupport(target, next, hadBonnet ? "Edit bonnet" : "Add bonnet");
    },

    async setSupportOverhangAllowed(supportId, allowed) {
      const project = get().project;
      if (!project) return;

      const target = findSupport(project, supportId);
      if (!target || (target.overhangAllowed ?? false) === allowed) return;

      const riders = getSupportRiders(target, project.floorObjects, artworksById());
      // Turning overhang OFF has to make the promise true: grow the box until
      // the works it carries are actually on the top face. No margin — this is
      // containment, not a reveal.
      const footprint = allowed
        ? { widthMm: target.widthMm, depthMm: target.depthMm }
        : supportFootprintCoveringMm(target, riders, 0);

      const next: SupportFloorObject = { ...target, ...footprint, overhangAllowed: allowed };
      await commitSupport(target, next, allowed ? "Allow overhang" : "Disallow overhang");
    },

    async fitSupportToWorks(supportId) {
      const project = get().project;
      if (!project) return;

      const target = findSupport(project, supportId);
      if (!target) return;

      const riders = getSupportRiders(target, project.floorObjects, artworksById());
      if (riders.length === 0) return;

      const footprint = supportFootprintCoveringMm(
        target,
        riders,
        supportMarginMm(target.supportKind)
      );
      const next: SupportFloorObject = { ...target, ...footprint };
      await commitSupport(target, next, `Fit ${supportNoun(target.supportKind)} to works`);
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

// ─── Support helpers (pure) ────────────────────────────────────────────────

// baseHeightMm DELETED, not zeroed. Absence is this codebase's "resting on the
// floor" (FloorObjectBase's own note), and a spurious 0 key makes a clean
// project hash dirty for the cloud backup's fingerprint check.
function withoutBaseHeight<T extends FloorObject>(object: T): T {
  const next = { ...object };
  delete next.baseHeightMm;
  return next;
}

// Structural equality for a support, so a re-commit of an unchanged field
// pushes no dead undo entry. Every field is a number, a string or a boolean, so
// this is a complete comparison.
function sameSupport(a: SupportFloorObject, b: SupportFloorObject): boolean {
  return (
    a.supportKind === b.supportKind &&
    a.xMm === b.xMm &&
    a.yMm === b.yMm &&
    a.widthMm === b.widthMm &&
    a.depthMm === b.depthMm &&
    a.heightMm === b.heightMm &&
    a.rotationDeg === b.rotationDeg &&
    a.bonnetHeightMm === b.bonnetHeightMm &&
    a.bonnetHeightLocked === b.bonnetHeightLocked &&
    a.overhangAllowed === b.overhangAllowed
  );
}

// What each rider of `before` has to become when the support becomes `after` —
// THE rider-carry rule (floor-supports spec §4), stated once so every write
// path into a support (the inspector's numeric fields, the plan rotate handle,
// a 3D drag, the support-inspector actions) moves the works the same way.
//
// Riders are derived from the BEFORE state, like everywhere else: the works
// standing on the pedestal when the edit began are the ones it carries. A
// work whose seat the edit happens to create is not retro-actively picked up.
//
// Returns id → transform so the caller can fold it into the one map that also
// replaces the support, keeping the whole assembly in a single applyEdit.
export function supportRiderEdits(
  before: SupportFloorObject,
  after: SupportFloorObject,
  floorObjects: readonly FloorObject[],
  artworksById?: ReadonlyMap<string, Artwork>
): Map<string, (object: FloorObject) => FloorObject> {
  const dxMm = after.xMm - before.xMm;
  const dyMm = after.yMm - before.yMm;
  const dRotDeg = after.rotationDeg - before.rotationDeg;
  const heightChanged = after.heightMm !== before.heightMm;
  const edits = new Map<string, (object: FloorObject) => FloorObject>();
  if (dxMm === 0 && dyMm === 0 && dRotDeg === 0 && !heightChanged) return edits;

  const rotRad = (dRotDeg * Math.PI) / 180;
  const cos = Math.cos(rotRad);
  const sin = Math.sin(rotRad);

  for (const rider of getSupportRiders(before, floorObjects, artworksById)) {
    edits.set(rider.id, (object) => {
      // Rotate about the support's OLD centre first, then translate: the two
      // compose to the same rigid motion the support itself underwent, and
      // doing it in this order means a single edit that both turns and slides
      // needs no intermediate frame.
      const offsetXMm = object.xMm - before.xMm;
      const offsetYMm = object.yMm - before.yMm;
      return {
        ...object,
        xMm: before.xMm + offsetXMm * cos - offsetYMm * sin + dxMm,
        yMm: before.yMm + offsetXMm * sin + offsetYMm * cos + dyMm,
        rotationDeg: object.rotationDeg + dRotDeg,
        // The top face IS the rider's bottom edge, so a height edit re-seats
        // rather than leaving the works hanging at the old top.
        ...(heightChanged ? { baseHeightMm: after.heightMm } : {})
      };
    });
  }
  return edits;
}
