import { useCallback, useMemo, useRef, useState } from "react";

// One registry for every workspace dialog App owns, replacing the parallel
// `useState(false)` flags that had to be re-listed (and kept in sync) at each
// "a dialog owns the keyboard" check.
//
// The payload map is the type: a dialog whose value is `true` is a plain
// open/closed dialog, and one whose value is an object carries the subject the
// dialog asks about. That single declaration is what makes `open("deleteRoom")`
// (no room) and `open("help", …)` (nothing to carry) compile errors.
export type DialogPayloads = {
  help: true;
  settings: true;
  exportPdf: true;
  exportChecklist: true;
  importWizard: true;
  libraryPicker: true;
  deleteRoom: { roomId: string };
  openWall: { wallId: string };
};

export type DialogName = keyof DialogPayloads;

// The dialogs with nothing to carry — the only ones `setOpen` can hand to Radix,
// since re-opening a confirm needs a subject that a bare `true` cannot supply.
export type PlainDialogName = {
  [K in DialogName]: DialogPayloads[K] extends true ? K : never;
}[DialogName];

// A union of argument tuples rather than an optional second parameter, so the
// payload is required exactly where the map says it exists.
type OpenArgs = {
  [K in DialogName]: DialogPayloads[K] extends true
    ? [name: K]
    : [name: K, payload: DialogPayloads[K]];
}[DialogName];

// Open dialogs hold their payload; closed ones hold null. Several can be open at
// once (Settings hands off to Help; the import wizard and the library picker are
// independent), so this is a record, not one `activeDialog`.
type DialogState = { [K in DialogName]: DialogPayloads[K] | null };

const DIALOG_NAMES = [
  "help",
  "settings",
  "exportPdf",
  "exportChecklist",
  "importWizard",
  "libraryPicker",
  "deleteRoom",
  "openWall"
] as const satisfies readonly DialogName[];

const ALL_CLOSED: DialogState = {
  help: null,
  settings: null,
  exportPdf: null,
  exportChecklist: null,
  importWizard: null,
  libraryPicker: null,
  deleteRoom: null,
  openWall: null
};

export type DialogsHandle = {
  isOpen: (name: DialogName) => boolean;
  open: (...args: OpenArgs) => void;
  close: (name: DialogName) => void;
  /** The subject an open confirm asks about; null while it is closed. */
  payload: <K extends DialogName>(name: K) => DialogPayloads[K] | null;
  /**
   * A Radix `onOpenChange` handle. Stable per name across renders, so effects
   * and memoized children that take one do not churn.
   */
  setOpen: (name: PlainDialogName) => (open: boolean) => void;
  /** Any dialog open at all — the one "a dialog owns the keyboard" flag. */
  anyOpen: boolean;
};

export function useDialogs(): DialogsHandle {
  const [state, setState] = useState<DialogState>(ALL_CLOSED);

  const open = useCallback((...args: OpenArgs) => {
    const [name, payload] = args as [DialogName, DialogPayloads[DialogName] | undefined];
    setState((previous) => ({ ...previous, [name]: payload ?? true }));
  }, []);

  // Closing clears the payload with it: a stale room/wall id must never outlive
  // the question it belonged to.
  const close = useCallback((name: DialogName) => {
    setState((previous) => (previous[name] === null ? previous : { ...previous, [name]: null }));
  }, []);

  // Cached per name so `setOpen("help")` is the same function on every render.
  const setOpenHandles = useRef(new Map<PlainDialogName, (isOpen: boolean) => void>());
  const setOpen = useCallback((name: PlainDialogName) => {
    const cached = setOpenHandles.current.get(name);
    if (cached) return cached;
    const handle = (isOpen: boolean) => {
      setState((previous) => ({ ...previous, [name]: isOpen ? true : null }));
    };
    setOpenHandles.current.set(name, handle);
    return handle;
  }, []);

  return useMemo(() => {
    const isOpen = (name: DialogName) => state[name] !== null;
    return {
      isOpen,
      open,
      close,
      payload: <K extends DialogName>(name: K) => state[name],
      setOpen,
      anyOpen: DIALOG_NAMES.some(isOpen)
    };
  }, [state, open, close, setOpen]);
}
