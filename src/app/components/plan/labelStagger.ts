// Shared greedy row-stagger for dimension labels: a label that doesn't fit
// centered on its own segment steps down to the shallowest row that clears
// every label already placed in that row. Used by both PartitionDimensionLines
// (plan chains, mm) and GroupDimensionLines (elevation wall selections, px) —
// unit-agnostic so each caller keeps its own coordinate space; `rowEnd` is
// mutated in place across the caller's label loop, one array per dimension
// chain/row.
export function staggerLabelRow(
  rowEnd: number[],
  {
    fits,
    mid,
    halfWidth,
    gap,
    maxRow
  }: {
    // Whether the label fits centered on its own segment (row 0).
    fits: boolean;
    // Position of the label's center along the line, in the caller's units.
    mid: number;
    // Half the label's estimated on-screen width, same units as `mid`.
    halfWidth: number;
    // Breathing room kept between two labels sharing a row, same units as `mid`.
    gap: number;
    // The deepest row to search before giving up and stacking on the last one.
    maxRow: number
  }
): number {
  let row = fits ? 0 : 1;
  while (row > 0 && row < maxRow && (rowEnd[row] ?? -Infinity) > mid - halfWidth) {
    row += 1;
  }
  if (row > 0) rowEnd[row] = mid + halfWidth + gap;
  return row;
}
