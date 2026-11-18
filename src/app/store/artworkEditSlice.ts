import { z } from "zod";
import { isMonitorArtwork, monitorBoxSizeMm } from "../../domain/geometry/monitorGlyphs";
import {
  effectiveFloorDepthMm,
  SIZE_MATCH_TOLERANCE_MM
} from "../../domain/placement/artworkForm";
import { getEffectivePlacementSizeMm } from "../../domain/placement/placeArtwork";
import type { PlacementWarning } from "../../domain/placement/validatePlacement";
import { parseArtwork } from "../../domain/schema/artworkSchema";
import type { Artwork, Project } from "../../domain/project";
import type { PixelAspect } from "../../domain/units/aspectFill";
import type { AppState, EditEntry, EditExtras } from "../store";

export type UpdateArtworkChanges = Partial<
  Pick<
    Artwork,
    | "title"
    | "artist"
    | "date"
    | "accessionNumber"
    | "locationOrLender"
    | "creditLine"
    | "dimensions"
    | "placementForm"
    | "displayAs"
    | "matWidthMm"
    | "frame"
    | "frameIncludedInImage"
  >
> & {
  // VIRTUAL field. Medium is not a column on Artwork: it lives at
  // metadata.medium, the key the spreadsheet import wizard writes
  // (domain/spreadsheetImport/importPlan.ts) and the key every export reads.
  // updateArtwork translates it into that metadata slot so an inspector edit
  // and an import land in exactly the same place. `undefined` (or blank)
  // DELETES the key rather than storing an empty string.
  medium?: string;
};

// The subset a bulk mat/frame apply can write across many works at once. Narrower
// than UpdateArtworkChanges: identity/dimension/placement metadata is per-work,
// so the batch dialog only ever sets or clears the mat band and the frame.
export type BulkMatFrameChanges = Partial<Pick<Artwork, "matWidthMm" | "frame">>;

// The subset a bulk checklist edit can write across many works at once: the
// shared catalogue fields a curator sets for a run of works (one artist, one
// lender, one credit) plus the two display choices. Identity (title,
// accession number) and dimensions stay per-work.
export type BulkArtworkChanges = Pick<
  UpdateArtworkChanges,
  "artist" | "date" | "medium" | "locationOrLender" | "creditLine" | "displayAs" | "placementForm"
>;

// Whether a stored placement axis still equals the value placement seeded it
// with. Shares SIZE_MATCH_TOLERANCE_MM with the inspector's "Match size to
// work" hint on purpose: that hint appears exactly when a floor placement has
// DIVERGED from the work, and the dimension-edit rebake follows a placement
// exactly while it has NOT. One tolerance, so a box can never be both.
function matchesSeededMm(storedMm: number, seededMm: number): boolean {
  return Math.abs(storedMm - seededMm) < SIZE_MATCH_TOLERANCE_MM;
}

function formatZodIssue(error: z.ZodError): string {
  const [issue] = error.issues;
  const path = issue?.path.join(".");
  return `${path ? `${path}: ` : ""}${issue?.message ?? "invalid value."}`;
}

type ArtworkEditPlan =
  | { status: "noop" }
  | { status: "error"; error: string }
  | {
      status: "ok";
      next: Artwork;
      // The passed-in project with this edit's placement rebakes applied —
      // the same object when nothing about a placement moved.
      project: Project | null;
      projectChanged: boolean;
      // Wall placements whose footprint this edit may have moved (resized or
      // re-framed); the caller validates them against its own artwork set.
      affectedPlacementIds: Set<string>;
    };

export type ArtworkEditSliceState = {
  updateArtwork: (artworkId: string, changes: UpdateArtworkChanges) => Promise<void>;
  // Applies one mat/frame change to many library works in a single undo entry.
  // Skips works whose stored size already includes the frame
  // (frameIncludedInImage) — the single inspector locks their mat/frame too —
  // and reports how many were skipped so the caller can say so.
  updateArtworksMatFrame: (
    artworkIds: string[],
    changes: BulkMatFrameChanges
  ) => Promise<{ updated: number; skipped: number }>;
  // Applies one set of catalogue/display changes to many works in a single
  // undo entry, folding the single-work edit (placement rebakes included)
  // over one evolving project. A placementForm change is skipped — per FIELD,
  // the rest still apply — for a work that is already placed in the open
  // project with a different form; converting a placement is the Type
  // toggle's job, not a bulk edit's. Reports how many works changed and how
  // many had their placement type skipped.
  updateArtworks: (
    artworkIds: string[],
    changes: BulkArtworkChanges
  ) => Promise<{ updated: number; placementTypeSkipped: number }>;
  // Points a work at a different image asset (or none, when undefined) as one
  // undoable artwork-half edit. Never deletes the previous asset: undo has to
  // be able to point back at it.
  setArtworkAssetId: (
    artworkId: string,
    assetId: string | undefined,
    label: string
  ) => Promise<void>;
};

export type ArtworkEditSliceDeps = {
  pushEditEntry: (entry: EditEntry, extras?: EditExtras) => void;
  persist: (project: Project) => Promise<boolean>;
  saveArtworkHalf: (artwork: Artwork) => Promise<void>;
  saveArtworkHalves: (artworks: Artwork[]) => Promise<void>;
  loadArtworkAspect: (artwork: Artwork) => Promise<PixelAspect | undefined>;
  validateWallObjectPlacements: (
    project: Project,
    wallObjectIds: string[],
    artworks?: Artwork[]
  ) => PlacementWarning[];
};

export function createArtworkEditSlice(
  set: (partial: Partial<AppState>) => void,
  get: () => AppState,
  deps: ArtworkEditSliceDeps
): ArtworkEditSliceState {
  const {
    pushEditEntry,
    persist,
    saveArtworkHalf,
    saveArtworkHalves,
    loadArtworkAspect,
    validateWallObjectPlacements
  } = deps;

  // The pure-ish planning half of a single-work edit, factored out of
  // updateArtwork so a bulk edit can FOLD it over one evolving project: it
  // peels the virtual medium into metadata, validates, and applies the
  // placement rebakes (wall resize, floor follow, monitor cabinet) to the
  // PASSED-IN project. It never writes state, persistence, or history, and it
  // leaves placement validation to the caller, which knows the full artwork
  // set the validation must see.
  async function planArtworkEdit(
    project: Project | null,
    before: Artwork,
    changes: UpdateArtworkChanges
  ): Promise<ArtworkEditPlan> {
    const artworkId = before.id;
    // `medium` is virtual (see UpdateArtworkChanges): peel it off before the
    // spread so it can never land as a stray Artwork column, then write it
    // into the metadata slot every importer and exporter already reads.
    const { medium, ...direct } = changes;
    const next: Artwork = { ...before, ...direct };
    if ("medium" in changes) {
      const metadata = { ...before.metadata };
      const trimmed = medium?.trim() ?? "";
      if (trimmed.length === 0) delete metadata.medium;
      else metadata.medium = trimmed;
      next.metadata = metadata;
    }

    const touchedKeys = Object.keys(direct) as (keyof Artwork)[];
    const changedKeys = touchedKeys.filter(
      (key) => JSON.stringify(before[key]) !== JSON.stringify(next[key])
    );
    const metadataChanged =
      JSON.stringify(before.metadata) !== JSON.stringify(next.metadata);
    if (changedKeys.length === 0 && !metadataChanged) return { status: "noop" };
    const dimensionsChanged = changedKeys.includes("dimensions");
    // frameIncludedInImage flips the outer footprint (a flagged work drops
    // its mat/frame band via effectiveFraming), so toggling it must trigger
    // the same placement revalidation as a mat/frame edit — otherwise a work
    // that newly fits (or newly overflows) wouldn't re-flag.
    const framingChanged =
      changedKeys.includes("matWidthMm") ||
      changedKeys.includes("frame") ||
      changedKeys.includes("frameIncludedInImage");
    const displayAsChanged = changedKeys.includes("displayAs");

    let parsed: Artwork;
    try {
      parsed = parseArtwork(next);
    } catch (error) {
      // Validate before mutating persistence, project state, or undo history.
      return {
        status: "error",
        error: `Could not save that change (${
          error instanceof z.ZodError ? formatZodIssue(error) : "invalid value."
        }).`
      };
    }

    // Resize wall placements without display overrides, and follow FLOOR
    // placements that have not diverged from the size they were seeded at.
    // Artwork and placement changes share one undo entry.
    let projectEdit: { before: Project; after: Project } | undefined;
    const affectedIds = new Set<string>();

    if (project && dimensionsChanged) {
      // A derived axis needs the image ratio; skip the asset fetch on the
      // common both-known path (no axis to derive) so a plain dimension
      // edit stays synchronous-cheap. BOTH sides are checked because the
      // floor rebake below reconstructs the OLD seeded size as well — a
      // half-known "before" needs the same ratio the seeding used, or the
      // comparison would read every placement as diverged.
      const needsAspect = [parsed.dimensions, before.dimensions].some(
        (dimensions) =>
          dimensions.widthMm === undefined || dimensions.heightMm === undefined
      );
      const aspect = needsAspect ? await loadArtworkAspect(parsed) : undefined;

      const nextWallObjects = project.wallObjects.map((wallObject) => {
        if (
          wallObject.kind !== "artwork" ||
          wallObject.artworkId !== artworkId ||
          wallObject.displayDimensionsOverride
        ) {
          return wallObject;
        }

        const size = getEffectivePlacementSizeMm(parsed.dimensions, aspect);
        if (size.widthMm === wallObject.widthMm && size.heightMm === wallObject.heightMm) {
          return wallObject;
        }

        affectedIds.add(wallObject.id);
        return { ...wallObject, widthMm: size.widthMm, heightMm: size.heightMm };
      });

      // A floor placement's box is a SEPARATE measurement from the work
      // (see FloorArtworkImageSizeNote): the box is the thing standing on
      // the floor — a projection board, a plinth, a cabinet — and a curator
      // may legitimately have resized it. So this follows a dimension edit
      // only while the box still equals what placement seeded it with; once
      // it has diverged, retyping the work's height must not silently shrink
      // the board back. Divergence is judged against the OLD dimensions,
      // reconstructed through exactly the sources that seeded it
      // (monitorBoxSizeMm for a cabinet, getEffectivePlacementSizeMm +
      // effectiveFloorDepthMm for everything else), so the two can't drift.
      const isMonitor = isMonitorArtwork(parsed);
      const seededBefore = isMonitor
        ? monitorBoxSizeMm(before.dimensions)
        : {
            ...getEffectivePlacementSizeMm(before.dimensions, aspect),
            depthMm: effectiveFloorDepthMm(before.dimensions)
          };
      const seededAfter = isMonitor
        ? monitorBoxSizeMm(parsed.dimensions)
        : {
            ...getEffectivePlacementSizeMm(parsed.dimensions, aspect),
            depthMm: effectiveFloorDepthMm(parsed.dimensions)
          };

      let floorChanged = false;
      const nextFloorObjects = project.floorObjects.map((object) => {
        if (
          object.kind !== "artwork" ||
          object.artworkId !== artworkId ||
          // Same exemption the wall path makes: an explicit display size is
          // the curator's own answer about how big this placement reads.
          object.displayDimensionsOverride
        ) {
          return object;
        }

        // A monitor's cabinet is one indivisible object — its face is 4:3
        // by construction — so all three axes move together or none do.
        // Everything else is judged per CONCERN: the face (width × height,
        // which the work's own dimensions size) and the depth (how thick
        // the board or plinth is, which effectiveFloorDepthMm sizes) are
        // two different questions a curator answers separately in
        // FloorPlacementFields, so each follows on its own.
        const faceMatches =
          matchesSeededMm(object.widthMm, seededBefore.widthMm) &&
          matchesSeededMm(object.heightMm, seededBefore.heightMm);
        const depthMatches = matchesSeededMm(object.depthMm, seededBefore.depthMm);
        const followFace = faceMatches && (!isMonitor || depthMatches);
        const followDepth = isMonitor ? followFace : depthMatches;

        const next = {
          ...object,
          ...(followFace
            ? { widthMm: seededAfter.widthMm, heightMm: seededAfter.heightMm }
            : {}),
          ...(followDepth ? { depthMm: seededAfter.depthMm } : {})
        };
        if (
          next.widthMm === object.widthMm &&
          next.heightMm === object.heightMm &&
          next.depthMm === object.depthMm
        ) {
          return object;
        }
        floorChanged = true;
        return next;
      });

      if (affectedIds.size > 0 || floorChanged) {
        const after = {
          ...project,
          ...(affectedIds.size > 0 ? { wallObjects: nextWallObjects } : {}),
          // Floor objects carry no wall bounds to validate (see
          // placeArtworkOnFloor), so this extends the edit without ever
          // joining affectedIds.
          ...(floorChanged ? { floorObjects: nextFloorObjects } : {}),
          updatedAt: new Date().toISOString()
        };
        projectEdit = { before: project, after };
      }
    }

    // Turning a work INTO a box monitor changes the placement's geometry,
    // not just its look: a monitor's floor object is the CABINET (a 4:3
    // face, MONITOR_DEPTH_MM deep), while a framed image's is the work
    // itself. Without this re-seed a flat 20mm-deep board would keep its
    // paper-thin footprint and render as a CRT with no tube.
    //
    // One-directional on purpose. Switching AWAY from monitor leaves the box
    // alone: the only sizes available then are the work's own dimensions,
    // which may be entirely unrecorded, and replacing a real box with a
    // placeholder is a worse answer than leaving a box the curator can drag
    // or retype. (Placing fresh always seeds correctly — placeArtworkOnFloor.)
    if (project && displayAsChanged && parsed.displayAs === "monitor") {
      const base = projectEdit?.after ?? project;
      let floorChanged = false;
      const nextFloorObjects = base.floorObjects.map((object) => {
        if (object.kind !== "artwork" || object.artworkId !== artworkId) return object;
        const size = monitorBoxSizeMm(parsed.dimensions);
        if (
          object.widthMm === size.widthMm &&
          object.heightMm === size.heightMm &&
          object.depthMm === size.depthMm
        ) {
          return object;
        }
        floorChanged = true;
        return {
          ...object,
          widthMm: size.widthMm,
          heightMm: size.heightMm,
          depthMm: size.depthMm
        };
      });
      if (floorChanged) {
        // Floor objects carry no wall bounds to validate (see
        // placeArtworkOnFloor), so this only extends the edit — it never
        // joins affectedIds.
        projectEdit = {
          before: projectEdit?.before ?? project,
          after: {
            ...base,
            floorObjects: nextFloorObjects,
            updatedAt: new Date().toISOString()
          }
        };
      }
    }

    if (project && framingChanged) {
      for (const wallObject of project.wallObjects) {
        if (wallObject.kind === "artwork" && wallObject.artworkId === artworkId) {
          affectedIds.add(wallObject.id);
        }
      }
    }

    return {
      status: "ok",
      next: parsed,
      project: projectEdit?.after ?? project,
      projectChanged: projectEdit !== undefined,
      affectedPlacementIds: affectedIds
    };
  }

  return {
    async updateArtwork(artworkId, changes) {
      const before = get().libraryArtworks.find((artwork) => artwork.id === artworkId);
      if (!before) return;

      // Resize wall placements without display overrides, and follow FLOOR
      // placements that have not diverged from the size they were seeded at.
      // Artwork and placement changes share one undo entry.
      const project = get().project;
      const plan = await planArtworkEdit(project, before, changes);
      if (plan.status === "error") {
        set({ error: plan.error });
        return;
      }
      if (plan.status === "noop") return;
      const parsed = plan.next;
      const projectEdit =
        project && plan.projectChanged && plan.project
          ? { before: project, after: plan.project }
          : undefined;

      let placementWarnings: PlacementWarning[] = [];
      if (project && plan.affectedPlacementIds.size > 0) {
        const validationArtworks = get().libraryArtworks.map((artwork) =>
          artwork.id === artworkId ? parsed : artwork
        );
        placementWarnings = validateWallObjectPlacements(
          projectEdit?.after ?? project,
          [...plan.affectedPlacementIds],
          validationArtworks
        );
      }

      pushEditEntry(
        {
          label: "Edit artwork",
          artwork: { before, after: parsed },
          ...(projectEdit ? { project: projectEdit } : {})
        },
        { placementWarnings }
      );

      await saveArtworkHalf(parsed);
      if (projectEdit) await persist(projectEdit.after);
    },

    async updateArtworks(artworkIds, changes) {
      const originalProject = get().project;
      let workingProject = originalProject;
      const distinctIds = [...new Set(artworkIds)];

      let placementTypeSkipped = 0;
      const halves: { before: Artwork; after: Artwork }[] = [];
      const affectedIds = new Set<string>();

      for (const artworkId of distinctIds) {
        const before = get().libraryArtworks.find((artwork) => artwork.id === artworkId);
        if (!before) continue;

        let perWorkChanges: UpdateArtworkChanges = changes;
        if ("placementForm" in changes && workingProject) {
          const placed =
            workingProject.wallObjects.some(
              (object) => object.kind === "artwork" && object.artworkId === artworkId
            ) ||
            workingProject.floorObjects.some(
              (object) => object.kind === "artwork" && object.artworkId === artworkId
            );
          if (placed && before.placementForm !== changes.placementForm) {
            const { placementForm: _skipped, ...rest } = changes;
            perWorkChanges = rest;
            placementTypeSkipped += 1;
          }
        }

        const plan = await planArtworkEdit(workingProject, before, perWorkChanges);
        if (plan.status === "error") {
          // One bad value aborts the whole batch before anything is written,
          // mirroring updateArtworksMatFrame.
          set({ error: plan.error });
          return { updated: 0, placementTypeSkipped };
        }
        if (plan.status === "noop") continue;

        halves.push({ before, after: plan.next });
        workingProject = plan.project;
        for (const id of plan.affectedPlacementIds) affectedIds.add(id);
      }

      if (halves.length === 0) {
        return { updated: 0, placementTypeSkipped };
      }

      const projectEdit =
        originalProject && workingProject && workingProject !== originalProject
          ? { before: originalProject, after: workingProject }
          : undefined;

      let placementWarnings: PlacementWarning[] = [];
      if (workingProject && affectedIds.size > 0) {
        const parsedById = new Map(halves.map((half) => [half.after.id, half.after]));
        const validationArtworks = get().libraryArtworks.map(
          (artwork) => parsedById.get(artwork.id) ?? artwork
        );
        placementWarnings = validateWallObjectPlacements(
          workingProject,
          [...affectedIds],
          validationArtworks
        );
      }

      const updated = halves.length;
      pushEditEntry(
        {
          label: updated === 1 ? "Edit artwork" : `Edit ${updated} works`,
          artworks: halves,
          ...(projectEdit ? { project: projectEdit } : {})
        },
        { placementWarnings }
      );

      await saveArtworkHalves(halves.map((half) => half.after));
      if (projectEdit) await persist(projectEdit.after);

      return { updated, placementTypeSkipped };
    },

    async setArtworkAssetId(artworkId, assetId, label) {
      // Re-read at write time: the caller may have awaited image processing,
      // and any edit made meanwhile must survive this one.
      const before = get().libraryArtworks.find((artwork) => artwork.id === artworkId);
      if (!before || before.assetId === assetId) return;

      const after: Artwork = { ...before };
      if (assetId === undefined) delete after.assetId;
      else after.assetId = assetId;

      pushEditEntry({ label, artwork: { before, after } });
      await saveArtworkHalf(after);
    },

    async updateArtworksMatFrame(artworkIds, changes) {
      const library = get().libraryArtworks;
      const project = get().project;

      // Distinct ids only: a placement-derived id list can name one artwork
      // twice (a work placed on two walls resolves to the same record).
      const distinctIds = [...new Set(artworkIds)];

      let skipped = 0;
      const halves: { before: Artwork; after: Artwork }[] = [];
      const affectedIds = new Set<string>();

      for (const artworkId of distinctIds) {
        const before = library.find((artwork) => artwork.id === artworkId);
        if (!before) continue;

        // A frame-inclusive work's stored size already contains the frame, so
        // there is no mat/frame band to set — the single inspector locks it,
        // and a bulk apply skips it the same way (counted for the UI note).
        if (before.frameIncludedInImage === true) {
          skipped += 1;
          continue;
        }

        const next: Artwork = { ...before, ...changes };
        // Only mat/frame can move here; a no-op work drops out so a batch
        // that changes nothing for it doesn't churn persistence or undo.
        const changed =
          JSON.stringify(before.matWidthMm) !== JSON.stringify(next.matWidthMm) ||
          JSON.stringify(before.frame) !== JSON.stringify(next.frame);
        if (!changed) continue;

        let parsed: Artwork;
        try {
          parsed = parseArtwork(next);
        } catch (error) {
          // Validate before mutating persistence, state, or undo history —
          // one bad value aborts the whole batch, mirroring updateArtwork.
          set({
            error: `Could not save that change (${
              error instanceof z.ZodError ? formatZodIssue(error) : "invalid value."
            }).`
          });
          return { updated: 0, skipped };
        }

        halves.push({ before, after: parsed });

        // Framing is a read-time expansion (no placement is resized), but the
        // footprint change still needs the same placement revalidation as a
        // single-work mat/frame edit.
        if (project) {
          for (const wallObject of project.wallObjects) {
            if (wallObject.kind === "artwork" && wallObject.artworkId === artworkId) {
              affectedIds.add(wallObject.id);
            }
          }
        }
      }

      if (halves.length === 0) {
        return { updated: 0, skipped };
      }

      let placementWarnings: PlacementWarning[] = [];
      if (project && affectedIds.size > 0) {
        const parsedById = new Map(halves.map((half) => [half.after.id, half.after]));
        const validationArtworks = get().libraryArtworks.map(
          (artwork) => parsedById.get(artwork.id) ?? artwork
        );
        placementWarnings = validateWallObjectPlacements(
          project,
          [...affectedIds],
          validationArtworks
        );
      }

      pushEditEntry(
        {
          // Singular batch still reads as a plain artwork edit in the history.
          label: halves.length === 1 ? "Edit artwork" : "Set mat & frame",
          artworks: halves
        },
        { placementWarnings }
      );

      await saveArtworkHalves(halves.map((half) => half.after));

      return { updated: halves.length, skipped };
    }
  };
}
