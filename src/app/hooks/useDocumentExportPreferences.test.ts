import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSampleProject } from "../../domain/sample/sampleProject";
import {
  deleteStoredDocumentExportPreferences,
  DOCUMENT_EXPORT_PREFERENCES_STORAGE_KEY,
  useDocumentExportPreferences
} from "./useDocumentExportPreferences";

describe("useDocumentExportPreferences", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("persists explicit settings under the current project id", () => {
    const project = createSampleProject();
    const { result } = renderHook(() =>
      useDocumentExportPreferences(project)
    );

    act(() => {
      result.current.updatePreferences((current) => ({
        ...current,
        sections: { ...current.sections, overview: false },
        grid: true,
        paperSize: "a3"
      }));
    });

    const stored = JSON.parse(
      window.localStorage.getItem(
        DOCUMENT_EXPORT_PREFERENCES_STORAGE_KEY
      ) ?? "{}"
    );
    expect(stored[project.id]).toMatchObject({
      sections: { overview: false },
      grid: true,
      paperSize: "a3"
    });
    expect(result.current.settings.sections.overview).toBe(false);
    expect(result.current.settings.grid).toBe(true);
  });

  it("drops deleted ids during reconciliation", () => {
    const project = createSampleProject();
    window.localStorage.setItem(
      DOCUMENT_EXPORT_PREFERENCES_STORAGE_KEY,
      JSON.stringify({
        [project.id]: {
          sections: {},
          roomPlans: {
            "room-main": true,
            "deleted-room": false
          },
          elevations: {
            "wall-north": false,
            "deleted-wall": true
          },
          savedViews: { "deleted-view": true }
        }
      })
    );

    renderHook(() => useDocumentExportPreferences(project));

    const stored = JSON.parse(
      window.localStorage.getItem(
        DOCUMENT_EXPORT_PREFERENCES_STORAGE_KEY
      ) ?? "{}"
    );
    expect(stored[project.id].roomPlans).toEqual({ "room-main": true });
    expect(stored[project.id].elevations).toEqual({ "wall-north": false });
    expect(stored[project.id].savedViews).toEqual({});
  });

  it("reports storage write failures", () => {
    const onError = vi.fn();
    vi.spyOn(window.localStorage, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    const project = createSampleProject();

    const { result } = renderHook(() =>
      useDocumentExportPreferences(project, onError)
    );
    act(() => {
      result.current.updatePreferences((current) => ({
        ...current,
        grid: true
      }));
    });

    expect(onError).toHaveBeenCalledWith(
      expect.stringContaining("Could not save PDF export settings")
    );
  });

  it("removes one project's record without touching other projects", () => {
    window.localStorage.setItem(
      DOCUMENT_EXPORT_PREFERENCES_STORAGE_KEY,
      JSON.stringify({
        "project-a": {
          sections: { overview: false },
          roomPlans: {},
          elevations: {},
          savedViews: {}
        },
        "project-b": {
          sections: { overview: true },
          roomPlans: {},
          elevations: {},
          savedViews: {}
        }
      })
    );

    deleteStoredDocumentExportPreferences("project-a");

    expect(
      JSON.parse(
        window.localStorage.getItem(
          DOCUMENT_EXPORT_PREFERENCES_STORAGE_KEY
        ) ?? "{}"
      )
    ).toEqual({
      "project-b": {
        sections: { overview: true },
        roomPlans: {},
        elevations: {},
        savedViews: {}
      }
    });
  });

  it("removes the storage key after deleting the final project record", () => {
    window.localStorage.setItem(
      DOCUMENT_EXPORT_PREFERENCES_STORAGE_KEY,
      JSON.stringify({
        "project-a": {
          sections: {},
          roomPlans: {},
          elevations: {},
          savedViews: {}
        }
      })
    );

    deleteStoredDocumentExportPreferences("project-a");

    expect(
      window.localStorage.getItem(
        DOCUMENT_EXPORT_PREFERENCES_STORAGE_KEY
      )
    ).toBeNull();
  });
});
