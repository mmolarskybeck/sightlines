import { useCursor } from "@react-three/drei";
import type { ThreeEvent } from "@react-three/fiber";
import { useMemo, useState } from "react";
import type { WallText3d } from "../../../domain/geometry/scene3d";
import { computeWallTextSkeleton } from "../../../domain/scene2d/wallTextSkeleton";
import { mmToWorld } from "./coordinates";
import { SelectionRectOutline } from "./UncertaintyOutline";
import {
  GHOST_OPACITY,
  WALL_TEXT_BAR_COLOR,
  WALL_TEXT_BORDER_COLOR,
  WALL_TEXT_OFFSET_MM,
  WALL_TEXT_PANEL_COLOR
} from "./tokens";

// The white panel, its skeleton bars, and the selection outline are stacked
// in z so they never z-fight. The steps must be several millimetres, not
// fractions of one: the original 0.5mm steps shimmered against each other
// during camera motion at room scale. These 4mm steps predate the dynamic
// clipping in cameraNav.ts (updateCameraClipping now rides near at
// distance/100, ~10× finer depth precision than before) and remain
// comfortably safe under it, while still reading as one flush panel.
const BORDER_Z_MM = 0;
const PANEL_Z_MM = 4;
const BAR_Z_MM = 8;
const OUTLINE_Z_MM = 12;

// A wall-mounted didactic text panel in 3D: a white plane with a subtle border
// and light-grey skeleton bars (no real text, matching the 2D elevation and
// the PDF export — all three share computeWallTextSkeleton). Rides the wall
// face like an artwork; selection is an outline, never a tint.
export function WallTextPanel({
  wallText,
  isSelected,
  onSelect,
  ghosted = false
}: {
  wallText: WallText3d;
  isSelected: boolean;
  onSelect: (objectId: string, opts: { additive: boolean }) => void;
  ghosted?: boolean;
}) {
  const [hovered, setHovered] = useState(false);
  useCursor(hovered && !ghosted);

  const widthWorld = mmToWorld(wallText.widthMm);
  const heightWorld = mmToWorld(wallText.heightMm);

  const bars = useMemo(() => {
    const skeleton = computeWallTextSkeleton(wallText.widthMm, wallText.heightMm);
    // Normalized bars are top-left / y-down; the plane is centered, so map each
    // bar's center into the panel's local xy (y-up).
    return skeleton.bars.map((bar) => ({
      widthWorld: mmToWorld(wallText.widthMm * bar.widthFrac),
      heightWorld: mmToWorld(wallText.heightMm * bar.heightFrac),
      xWorld: mmToWorld(wallText.widthMm * (bar.xFrac + bar.widthFrac / 2) - wallText.widthMm / 2),
      yWorld: mmToWorld(wallText.heightMm / 2 - wallText.heightMm * (bar.yFrac + bar.heightFrac / 2))
    }));
  }, [wallText.widthMm, wallText.heightMm]);

  const handleClick = (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation();
    // A drag's release also fires click; only a true click selects.
    if (event.delta > 6) return;
    const { shiftKey, metaKey, ctrlKey } = event.nativeEvent;
    onSelect(wallText.objectId, { additive: shiftKey || metaKey || ctrlKey });
  };

  return (
    <group
      position={[mmToWorld(wallText.xMm), mmToWorld(wallText.yMm), mmToWorld(WALL_TEXT_OFFSET_MM)]}
      visible={!ghosted}
      onPointerOver={(event) => {
        event.stopPropagation();
        setHovered(true);
      }}
      onPointerOut={() => setHovered(false)}
    >
      {/* Border: a slightly larger backing plane peeking out behind the white. */}
      <mesh position={[0, 0, mmToWorld(BORDER_Z_MM)]}>
        <planeGeometry args={[widthWorld, heightWorld]} />
        <meshBasicMaterial
          color={WALL_TEXT_BORDER_COLOR}
          transparent={ghosted}
          opacity={ghosted ? GHOST_OPACITY : 1}
        />
      </mesh>
      {/* White panel face; also the click/hover target. */}
      <mesh onClick={handleClick} position={[0, 0, mmToWorld(PANEL_Z_MM)]}>
        <planeGeometry args={[widthWorld * 0.985, heightWorld * 0.978]} />
        <meshBasicMaterial
          color={WALL_TEXT_PANEL_COLOR}
          transparent={ghosted}
          opacity={ghosted ? GHOST_OPACITY : 1}
        />
      </mesh>
      {bars.map((bar, index) => (
        <mesh key={index} position={[bar.xWorld, bar.yWorld, mmToWorld(BAR_Z_MM)]}>
          <planeGeometry args={[bar.widthWorld, bar.heightWorld]} />
          <meshBasicMaterial
            color={WALL_TEXT_BAR_COLOR}
            transparent={ghosted}
            opacity={ghosted ? GHOST_OPACITY : 1}
          />
        </mesh>
      ))}
      {!ghosted && isSelected ? (
        <group position={[0, 0, mmToWorld(OUTLINE_Z_MM)]}>
          <SelectionRectOutline widthMm={wallText.widthMm} heightMm={wallText.heightMm} />
        </group>
      ) : null}
    </group>
  );
}
