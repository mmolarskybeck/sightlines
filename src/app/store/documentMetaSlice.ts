import type { Point } from "../../domain/geometry/polygon";
import { newId } from "../../domain/id";
import type {
  Project,
  ReferenceMeasurement,
  SavedView,
  SavedViewPose
} from "../../domain/project";
import { resolveSavedViewRoomId } from "../../domain/savedViews";
import type { AppState, EditExtras } from "../store";
import { NO_SELECTION, selectionWrite } from "./selectionSlice";

export type DocumentMetaSliceActions = {
  addReferenceMeasurement: (
    measurement:
      | { kind: "plan"; name?: string; start: Point; end: Point }
      | { kind: "elevation"; wallId: string; name?: string; start: Point; end: Point }
  ) => Promise<string | null>;
  updateReferenceMeasurement: (
    measurementId: string,
    changes: Partial<Pick<ReferenceMeasurement, "name" | "visible" | "locked" | "start" | "end">>
  ) => Promise<void>;
  deleteReferenceMeasurement: (measurementId: string) => Promise<void>;
  // Captures the current 3D camera pose as a Saved view (spec §8.2). Returns the
  // created view (for inline feedback) or null when there's no open project.
  saveView: (pose: SavedViewPose) => Promise<SavedView | null>;
  renameSavedView: (viewId: string, title: string) => Promise<void>;
  deleteSavedView: (viewId: string) => Promise<void>;
};

export type DocumentMetaSliceInternals = {
  applyEdit: (
    label: string,
    buildNextProject: (project: Project) => Project,
    extras?: EditExtras
  ) => Promise<void>;
};

export function createDocumentMetaSlice(
  _set: (partial: Partial<AppState>) => void,
  get: () => AppState,
  internals: DocumentMetaSliceInternals
): { actions: DocumentMetaSliceActions } {
  const { applyEdit } = internals;

  const actions: DocumentMetaSliceActions = {
    async addReferenceMeasurement(measurement) {
      const project = get().project;
      if (!project) return null;
      const id = newId();
      const reference = { ...measurement, id, visible: true, locked: false } as ReferenceMeasurement;
      await applyEdit(
        "Save reference measurement",
        (current) => ({
          ...current,
          referenceMeasurements: [...(current.referenceMeasurements ?? []), reference]
        }),
        selectionWrite(project, { kind: "measurement", measurementId: id }, get().wallContextId)
      );
      return id;
    },

    async updateReferenceMeasurement(measurementId, changes) {
      const project = get().project;
      const current = project?.referenceMeasurements?.find((item) => item.id === measurementId);
      if (!project || !current || current.locked && (changes.start || changes.end)) return;
      const normalized = {
        ...changes,
        ...(changes.name !== undefined ? { name: changes.name.trim() || undefined } : {})
      };
      const next = { ...current, ...normalized };
      if (JSON.stringify(next) === JSON.stringify(current)) return;
      await applyEdit("Edit reference measurement", (document) => ({
        ...document,
        referenceMeasurements: (document.referenceMeasurements ?? []).map((item) =>
          item.id === measurementId ? { ...item, ...normalized } : item
        )
      }));
    },

    async deleteReferenceMeasurement(measurementId) {
      const project = get().project;
      if (!project?.referenceMeasurements?.some((item) => item.id === measurementId)) return;
      await applyEdit(
        "Delete reference measurement",
        (document) => ({
          ...document,
          referenceMeasurements: (document.referenceMeasurements ?? []).filter(
            (item) => item.id !== measurementId
          )
        }),
        selectionWrite(project, NO_SELECTION, get().wallContextId)
      );
    },

    async saveView(pose) {
      const project = get().project;
      if (!project) return null;
      // Immutable, monotonic ordinal: (max existing, or 0) + 1, so deleting a
      // view never renumbers survivors nor reuses its number (spec §8.2).
      const ordinal =
        (project.savedViews ?? []).reduce((max, view) => Math.max(max, view.ordinal), 0) + 1;
      const savedView: SavedView = {
        id: newId(),
        ordinal,
        title: `Saved view ${ordinal}`,
        roomId: resolveSavedViewRoomId(pose, project.floor.rooms),
        pose,
        createdAt: new Date().toISOString()
      };
      await applyEdit("Save view", (current) => ({
        ...current,
        savedViews: [...(current.savedViews ?? []), savedView]
      }));
      return savedView;
    },

    async renameSavedView(viewId, title) {
      const project = get().project;
      const current = project?.savedViews?.find((view) => view.id === viewId);
      if (!project || !current) return;
      const trimmed = title.trim();
      if (!trimmed || trimmed === current.title) return;
      await applyEdit("Rename saved view", (document) => ({
        ...document,
        savedViews: (document.savedViews ?? []).map((view) =>
          view.id === viewId ? { ...view, title: trimmed } : view
        )
      }));
    },

    async deleteSavedView(viewId) {
      const project = get().project;
      if (!project?.savedViews?.some((view) => view.id === viewId)) return;
      await applyEdit("Delete saved view", (document) => ({
        ...document,
        savedViews: (document.savedViews ?? []).filter((view) => view.id !== viewId)
      }));
    }
  };

  return { actions };
}
