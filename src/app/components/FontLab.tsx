import { useEffect, useMemo, useState } from "react";
import "@fontsource-variable/inter";
import "@fontsource-variable/montserrat";
import "@fontsource-variable/ibm-plex-sans";
import "@fontsource-variable/geist";
import "@fontsource-variable/public-sans";
import "@fontsource-variable/manrope";
import "@fontsource-variable/work-sans";
import "@fontsource-variable/figtree";
import "@fontsource/poppins/400.css";
import "@fontsource/poppins/500.css";
import "@fontsource/poppins/600.css";
import "@fontsource/poppins/700.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/600.css";

type FontMode = "single" | "pair";

type FontId =
  | "inter"
  | "montserrat"
  | "ibm-plex-sans"
  | "geist"
  | "public-sans"
  | "manrope"
  | "work-sans"
  | "figtree"
  | "poppins";

type FontLabState = {
  displayFontId: FontId;
  isOpen: boolean;
  mode: FontMode;
  uiFontId: FontId;
};

type FontOption = {
  id: FontId;
  label: string;
  stack: string;
};

const STORAGE_KEY = "sightlines.fontLab.v2";

const FONT_OPTIONS: FontOption[] = [
  {
    id: "inter",
    label: "Inter",
    stack: '"Inter Variable", Inter, ui-sans-serif, system-ui, -apple-system, sans-serif'
  },
  {
    id: "ibm-plex-sans",
    label: "IBM Plex Sans",
    stack: '"IBM Plex Sans Variable", "IBM Plex Sans", ui-sans-serif, system-ui, sans-serif'
  },
  {
    id: "geist",
    label: "Geist",
    stack: '"Geist Variable", Geist, ui-sans-serif, system-ui, sans-serif'
  },
  {
    id: "public-sans",
    label: "Public Sans",
    stack: '"Public Sans Variable", "Public Sans", ui-sans-serif, system-ui, sans-serif'
  },
  {
    id: "manrope",
    label: "Manrope",
    stack: '"Manrope Variable", Manrope, ui-sans-serif, system-ui, sans-serif'
  },
  {
    id: "work-sans",
    label: "Work Sans",
    stack: '"Work Sans Variable", "Work Sans", ui-sans-serif, system-ui, sans-serif'
  },
  {
    id: "figtree",
    label: "Figtree",
    stack: '"Figtree Variable", Figtree, ui-sans-serif, system-ui, sans-serif'
  },
  {
    id: "poppins",
    label: "Poppins",
    stack: 'Poppins, ui-sans-serif, system-ui, sans-serif'
  },
  {
    id: "montserrat",
    label: "Montserrat",
    stack: '"Montserrat Variable", Montserrat, ui-sans-serif, system-ui, sans-serif'
  }
];

const DEFAULT_STATE: FontLabState = {
  displayFontId: "figtree",
  isOpen: true,
  mode: "pair",
  uiFontId: "geist"
};

const FONT_IDS = new Set<FontId>(FONT_OPTIONS.map((font) => font.id));

export default function FontLab() {
  const [state, setState] = useState<FontLabState>(() => readStoredState());

  const uiFont = useMemo(() => getFontOption(state.uiFontId), [state.uiFontId]);
  const displayFont = useMemo(
    () => getFontOption(state.mode === "single" ? state.uiFontId : state.displayFontId),
    [state.displayFontId, state.mode, state.uiFontId]
  );

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.fontLab = "active";
    root.style.setProperty("--font-ui", uiFont.stack);
    root.style.setProperty("--font-brand", displayFont.stack);
    root.style.setProperty("--font-display", displayFont.stack);
    root.style.setProperty(
      "--font-numeric",
      '"IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, monospace'
    );
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));

    return () => {
      root.style.removeProperty("--font-ui");
      root.style.removeProperty("--font-brand");
      root.style.removeProperty("--font-display");
      root.style.removeProperty("--font-numeric");
      delete root.dataset.fontLab;
    };
  }, [displayFont.stack, state, uiFont.stack]);

  const setMode = (mode: FontMode) =>
    setState((current) => ({ ...current, mode }));
  const setUiFont = (uiFontId: FontId) =>
    setState((current) => ({ ...current, uiFontId }));
  const setDisplayFont = (displayFontId: FontId) =>
    setState((current) => ({ ...current, displayFontId }));
  const setOpen = (isOpen: boolean) =>
    setState((current) => ({ ...current, isOpen }));
  const reset = () => {
    window.localStorage.removeItem(STORAGE_KEY);
    setState(DEFAULT_STATE);
  };

  if (!state.isOpen) {
    return (
      <button
        aria-label="Open font lab"
        className="font-lab-toggle"
        type="button"
        onClick={() => setOpen(true)}
      >
        Aa
      </button>
    );
  }

  return (
    <aside className="font-lab" aria-label="Font lab">
      <div className="font-lab-header">
        <div>
          <p>Dev type</p>
          <h2>Font Lab</h2>
        </div>
        <button type="button" onClick={() => setOpen(false)}>
          Hide
        </button>
      </div>

      <div className="font-lab-segment" role="group" aria-label="Font mode">
        <button
          aria-pressed={state.mode === "single"}
          type="button"
          onClick={() => setMode("single")}
        >
          Single
        </button>
        <button
          aria-pressed={state.mode === "pair"}
          type="button"
          onClick={() => setMode("pair")}
        >
          Pair
        </button>
      </div>

      <label className="font-lab-field">
        <span>UI</span>
        <select
          value={state.uiFontId}
          onChange={(event) => setUiFont(event.target.value as FontId)}
        >
          {FONT_OPTIONS.map((font) => (
            <option key={font.id} value={font.id}>
              {font.label}
            </option>
          ))}
        </select>
      </label>

      <label className="font-lab-field">
        <span>Display</span>
        <select
          disabled={state.mode === "single"}
          value={state.mode === "single" ? state.uiFontId : state.displayFontId}
          onChange={(event) => setDisplayFont(event.target.value as FontId)}
        >
          {FONT_OPTIONS.map((font) => (
            <option key={font.id} value={font.id}>
              {font.label}
            </option>
          ))}
        </select>
      </label>

      <div className="font-lab-preview" aria-label="Font preview">
        <p className="font-lab-preview-brand">Sightlines</p>
        <div>
          <strong>Gallery 2 - North wall</strong>
          <span>Centerline 57 in / 4 works / 18 in gap</span>
        </div>
      </div>

      <button className="font-lab-reset" type="button" onClick={reset}>
        Reset to current
      </button>
    </aside>
  );
}

function getFontOption(id: FontId): FontOption {
  return FONT_OPTIONS.find((font) => font.id === id) ?? FONT_OPTIONS[0];
}

function readStoredState(): FontLabState {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_STATE;
    const parsed = JSON.parse(raw) as Partial<FontLabState>;
    return {
      displayFontId: isFontId(parsed.displayFontId)
        ? parsed.displayFontId
        : DEFAULT_STATE.displayFontId,
      isOpen: typeof parsed.isOpen === "boolean" ? parsed.isOpen : DEFAULT_STATE.isOpen,
      mode: parsed.mode === "single" || parsed.mode === "pair" ? parsed.mode : DEFAULT_STATE.mode,
      uiFontId: isFontId(parsed.uiFontId) ? parsed.uiFontId : DEFAULT_STATE.uiFontId
    };
  } catch {
    return DEFAULT_STATE;
  }
}

function isFontId(value: unknown): value is FontId {
  return typeof value === "string" && FONT_IDS.has(value as FontId);
}
