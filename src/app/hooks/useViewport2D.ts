import { useCallback, useState } from "react";
import { FIT_VIEWPORT, type Viewport2D } from "../../domain/viewport/viewport2d";

// One manual/fit viewport per 2D surface, reset to fit whenever `resetKey`
// changes (e.g. the active project's id). The reset is derived during render
// — the React "derive state from props" idiom — so a project switch never
// shows a one-frame flash of the previous project's panned/zoomed viewport
// before an effect could correct it.
export function useViewport2D(resetKey: string): [Viewport2D, (v: Viewport2D) => void] {
  const [state, setState] = useState<{ key: string; viewport: Viewport2D }>({
    key: resetKey,
    viewport: FIT_VIEWPORT
  });

  if (state.key !== resetKey) setState({ key: resetKey, viewport: FIT_VIEWPORT });

  const setViewport = useCallback(
    (v: Viewport2D) => setState((s) => ({ ...s, viewport: v })),
    []
  );

  // Read through the reset so the render that first observes a new key returns
  // fit immediately, matching the setState scheduled above.
  const viewport = state.key === resetKey ? state.viewport : FIT_VIEWPORT;
  return [viewport, setViewport];
}
