import { useEffect, useRef, useState } from "react";
import type { DisplayUnit } from "../../../domain/project";
import { formatLength } from "../../../domain/units/length";
import type { MeasurementToolState } from "../../hooks/useMeasurementTool";

function stateDistanceMm(state: MeasurementToolState): number | null {
  if (state.phase === "armed-empty") return null;
  const end = state.phase === "drawing" ? state.preview : state.end;
  return Math.hypot(end.xMm - state.start.xMm, end.yMm - state.start.yMm);
}

/** One shared, non-visual announcement surface for both 2D canvases. */
export function MeasurementLiveRegion({
  state,
  unit,
  throttleMs = 500
}: {
  state: MeasurementToolState;
  unit: DisplayUnit;
  throttleMs?: number;
}) {
  const [announcement, setAnnouncement] = useState("");
  const lastLiveAtRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRef = useRef("");

  useEffect(() => {
    const distanceMm = stateDistanceMm(state);
    if (distanceMm === null) {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = null;
      pendingRef.current = "";
      setAnnouncement("");
      return;
    }

    const label = formatLength(distanceMm, { unit });
    if (state.phase === "armed-complete") {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = null;
      pendingRef.current = "";
      setAnnouncement(`Measurement complete, ${label}`);
      return;
    }

    // Refinement has a stable, directly focused handle; avoid a second stream
    // of announcements competing with its changing accessible name.
    if (state.phase !== "drawing" || distanceMm === 0) return;

    pendingRef.current = `Measurement, ${label}`;
    const elapsed = Date.now() - lastLiveAtRef.current;
    const publish = () => {
      timerRef.current = null;
      lastLiveAtRef.current = Date.now();
      setAnnouncement(pendingRef.current);
    };
    if (elapsed >= throttleMs) publish();
    else if (!timerRef.current) timerRef.current = setTimeout(publish, throttleMs - elapsed);

    return () => {
      // Preserve the timer across rapid drawing updates; phase transitions
      // explicitly cancel it above.
    };
  }, [state, throttleMs, unit]);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    []
  );

  return (
    <span aria-atomic="true" aria-live="polite" className="sr-only" role="status">
      {announcement}
    </span>
  );
}
