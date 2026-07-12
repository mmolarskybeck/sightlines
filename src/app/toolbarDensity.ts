export const TOOLBAR_DENSITIES = [
  "comfortable",
  "trimmed",
  "condensed",
  "compact",
  "tight"
] as const;

export type ToolbarDensity = (typeof TOOLBAR_DENSITIES)[number];

export const DEFAULT_TOOLBAR_FIT_BUFFER_PX = 2;

export function chooseToolbarDensity(
  availableWidth: number,
  requiredWidths: Record<ToolbarDensity, number>,
  fitBufferPx = DEFAULT_TOOLBAR_FIT_BUFFER_PX
): ToolbarDensity {
  const usableWidth = availableWidth - fitBufferPx;

  return (
    TOOLBAR_DENSITIES.find((density) => requiredWidths[density] <= usableWidth) ??
    "tight"
  );
}
