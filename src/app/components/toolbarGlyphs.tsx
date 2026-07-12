import type { ReactNode, SVGProps } from "react";

// Custom 16px toolbar glyphs for two insert tools whose phosphor stand-ins
// read wrong beside their neighbors: the partition's WallIcon collided with
// the Grid toggle's GridFourIcon (both read as a boxed grid), and a bare
// SquareIcon never read as a window. Both are tuned to phosphor regular's
// ~1.5px stroke weight at 16px and paint in currentColor, so they inherit the
// segment's resting/hover/armed ink exactly like any phosphor icon does.

type GlyphProps = SVGProps<SVGSVGElement> & { size?: number };

function Glyph({ size = 16, children, ...props }: GlyphProps & { children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="square"
      strokeLinejoin="miter"
      {...props}
    >
      {children}
    </svg>
  );
}

// A straight wall segment in plan: a solid horizontal bar with squared ends,
// so it reads as a length of wall rather than the boxed grid GridFourIcon draws.
export function PartitionGlyph(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <rect x="1.5" y="6.75" width="13" height="2.5" fill="currentColor" stroke="none" />
    </Glyph>
  );
}

// A window in elevation: a square pane split by a centered vertical mullion —
// the two-pane silhouette that distinguishes it from a plain square.
export function WindowGlyph(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <rect x="2.75" y="2.75" width="10.5" height="10.5" />
      <line x1="8" y1="2.75" x2="8" y2="13.25" />
    </Glyph>
  );
}
