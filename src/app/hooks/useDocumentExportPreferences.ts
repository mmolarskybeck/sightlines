import { useEffect, useMemo, useRef, useState } from "react";
import {
  EMPTY_DOCUMENT_EXPORT_PREFERENCES,
  reconcileDocumentExportPreferences,
  sanitizeDocumentExportPreferences,
  type DocumentExportPreferences
} from "../../domain/export/documentSettings";
import type { Project } from "../../domain/project";

export const DOCUMENT_EXPORT_PREFERENCES_STORAGE_KEY =
  "sightlines.documentExportPreferences.v1";

type PreferenceStore = Record<string, DocumentExportPreferences>;

function readPreferenceStore(): PreferenceStore {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(
      DOCUMENT_EXPORT_PREFERENCES_STORAGE_KEY
    );
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return {};
    }
    return Object.fromEntries(
      Object.entries(parsed).map(([projectId, preferences]) => [
        projectId,
        sanitizeDocumentExportPreferences(preferences)
      ])
    );
  } catch {
    return {};
  }
}

function writePreferenceStore(store: PreferenceStore): void {
  window.localStorage.setItem(
    DOCUMENT_EXPORT_PREFERENCES_STORAGE_KEY,
    JSON.stringify(store)
  );
}

export function deleteStoredDocumentExportPreferences(projectId: string): void {
  if (typeof window === "undefined") return;
  const store = readPreferenceStore();
  if (!Object.prototype.hasOwnProperty.call(store, projectId)) return;
  delete store[projectId];
  if (Object.keys(store).length === 0) {
    window.localStorage.removeItem(DOCUMENT_EXPORT_PREFERENCES_STORAGE_KEY);
  } else {
    writePreferenceStore(store);
  }
}

export function useDocumentExportPreferences(
  project: Project,
  onPersistenceError?: (message: string) => void
) {
  const [store, setStore] = useState<PreferenceStore>(readPreferenceStore);
  const onPersistenceErrorRef = useRef(onPersistenceError);
  onPersistenceErrorRef.current = onPersistenceError;
  const locale =
    typeof navigator === "undefined" ? undefined : navigator.language;

  const reconciled = useMemo(
    () =>
      reconcileDocumentExportPreferences(
        project,
        store[project.id],
        locale
      ),
    [locale, project, store]
  );

  // Project edits can remove ids. Compact stale overrides promptly so deleted
  // room/wall/view ids do not accumulate in workspace storage.
  useEffect(() => {
    const current =
      store[project.id] ?? EMPTY_DOCUMENT_EXPORT_PREFERENCES;
    if (
      JSON.stringify(current) === JSON.stringify(reconciled.preferences)
    ) {
      return;
    }
    setStore((existing) => ({
      ...existing,
      [project.id]: reconciled.preferences
    }));
  }, [project.id, reconciled.preferences, store]);

  useEffect(() => {
    try {
      writePreferenceStore(store);
    } catch {
      onPersistenceErrorRef.current?.(
        "Could not save PDF export settings. Browser storage may be full or unavailable; your latest choices may be lost when you reload."
      );
    }
  }, [store]);

  const updatePreferences = (
    update: (
      current: DocumentExportPreferences
    ) => DocumentExportPreferences
  ) => {
    setStore((existing) => {
      const current = reconcileDocumentExportPreferences(
        project,
        existing[project.id],
        locale
      ).preferences;
      return {
        ...existing,
        [project.id]: sanitizeDocumentExportPreferences(update(current))
      };
    });
  };

  return {
    preferences: reconciled.preferences,
    settings: reconciled.settings,
    updatePreferences
  };
}
