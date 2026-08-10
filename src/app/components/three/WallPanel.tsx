import { useCursor } from "@react-three/drei";
import type { ThreeEvent } from "@react-three/fiber";
import { useEffect, useMemo, useState } from "react";
import { Path, Shape, ShapeGeometry, type Texture } from "three";
import {
  DOOR_KNOB_HEIGHT_MM,
  DOOR_KNOB_INSET_MM,
  DOOR_KNOB_RADIUS_MM,
  DOOR_LEAF_THICKNESS_MM
} from "../../../domain/geometry/doorGlyphs";
import type { Artwork } from "../../../domain/project";
import { effectiveFraming } from "../../../domain/framing";
import type {
  Hole3d,
  WallBlockedZone3d,
  WallPanel3d
} from "../../../domain/geometry/scene3d";
import { ArtworkPlane } from "./ArtworkPlane";
import { WallCaseMesh } from "./CaseMesh";
import { WallTextPanel } from "./WallTextPanel";
import { mmToWorld, MM_TO_WORLD } from "./coordinates";
import { openingPickBandRects } from "./openingPickBand";
import {
  BoxEdgeOutline,
  SelectionBoxOutline,
  SelectionRectOutline
} from "./UncertaintyOutline";
import {
  BLOCKED_ZONE_COLOR,
  DOOR_KNOB_COLOR,
  DOOR_LEAF_COLOR,
  DOOR_LEAF_EDGE_COLOR,
  GHOST_OPACITY,
  OPENING_CAP_COLOR,
  WALL_COLOR,
  WALL_SELECTED_COLOR,
  WINDOW_CAP_COLOR
} from "./tokens";

// Wall blocked zones are planning annotations, not physical (spec §5.3): a
// translucent wash in the same subdued grey family as the 2D hatch, flush to
// the wall (small offset to avoid z-fighting; less than the artworks' 20 mm
// so a zone never reads as covering a work).
const BLOCKED_ZONE_OPACITY = 0.15;
const BLOCKED_ZONE_OFFSET_MM = 6;
const OPENING_CAP_RECESS_MM = -30;
const WINDOW_CAP_OPACITY = 0.48;

// Selection outlines for wall children that are drawn FLAT on the wall face —
// blocked zones and openings. Both sit proud of the surface they wrap so the
// line can't z-fight it, on the same scale as ArtworkPlane's OUTLINE_OFFSET_MM
// (millimetres, not fractions: sub-millimetre steps shimmered under camera
// motion at room scale — see WallTextPanel's z-stack note).
//
// The opening outline rides the WALL plane, not the recessed cap plane: outset
// around the aperture it lands on the wall face either way, and drawn at the
// cap's own depth the part of the ring outside the hole would be behind the
// wall and invisible from inside the room.
const BLOCKED_ZONE_OUTLINE_OFFSET_MM = 5;
const OPENING_OUTLINE_OFFSET_MM = 5;

// Outset of a flat selection outline from the rect it wraps, total across both
// sides — so 10mm of clearance per edge. Matches the value DoorLeafMesh's
// SelectionBoxOutline has always used, so a selected doorway, a selected leaf
// and a selected zone all wear the same ring.
const SELECTION_OUTLINE_OUTSET_MM = 20;

// How far each knob's cylinder barrel stands proud of the leaf face it is
// mounted on. A rendering-only depth (unlike DOOR_KNOB_RADIUS_MM etc., there
// is no plan/elevation glyph that needs this number too), so it lives here
// rather than in doorGlyphs.ts — same reasoning as OPENING_CAP_RECESS_MM just
// above. Small enough to read as a knob barrel, not a handle bar.
const DOOR_KNOB_PROTRUSION_MM = 24;

// How far the leaf's edge outline sits outside the slab it traces, on every
// axis (so half of it on each side). Rendering-only, like the constant above.
//
// It exists purely to keep the line off the surface it bounds: coincident, the
// two z-fight and the outline breaks into dashes. That was measured, not
// guessed — profiling the 335 scanlines crossing a door at 6m/24° off-axis,
// 27.8% of the jamb-side vertical reached exactly bare-wall value (the line was
// absent, not merely faint). With the outset, 0% do.
//
// This is added to the total dimension, so the clearance is HALF of it per
// side: 3mm. At the live camera's near plane (far/10000) that is ~195x the
// resolvable depth step at a 6m room view and ~27x at the 16m Overview.
//
// Do not raise it. Deliberately far smaller than SelectionBoxOutline's 20mm —
// that one is meant to read as a ring AROUND the object, while this must still
// read as the door's own edge. At 2.28m (as close as the orbit rig will get)
// 3mm is ~1 CSS px, which antialiasing absorbs completely: there is no
// wall-coloured band between the leaf face and the line at any reachable
// distance. A larger value would open one.
const DOOR_LEAF_EDGE_OUTSET_MM = 6;

// One zero-thickness, single-sided wall and everything placed on it. The group
// maps wall-local coordinates to the world: local +x runs start -> end, +y up
// from the floor, and +z is the inward normal — the derivation guarantees the
// winding (scene3d.ts `wallInwardNormal`), and rotating the group's +x onto
// (end - start) puts +z exactly on that inward normal. From outside the room
// the near walls are back-face-culled (invisible) while far walls read
// normally — the dollhouse effect (spec §5.3). Children (artworks, zones) are
// therefore pure wall-local placements with no coordinate math of their own.
export function WallPanel({
  wall,
  texturesByAssetId,
  artworksById,
  isSelected,
  selectedObjectIds,
  selectedArtworkId,
  onSelectWall,
  onSelectObject,
  ghosted = false
}: {
  wall: WallPanel3d;
  texturesByAssetId: ReadonlyMap<string, Texture>;
  // Source of the optional schematic framing (matWidthMm / frame): these live
  // on the Artwork record, not the derived WallArtwork3d, so the render layer
  // looks them up here rather than the domain carrying them through.
  artworksById: ReadonlyMap<string, Artwork>;
  isSelected: boolean;
  selectedObjectIds: string[];
  selectedArtworkId: string | null;
  onSelectWall: (wallId: string) => void;
  onSelectObject: (objectId: string, opts: { additive: boolean }) => void;
  // The wall crosses the active eye-level sightline: fade it (and everything
  // riding on it) to a hint so the viewed wall reads through.
  ghosted?: boolean;
}) {
  const { originX, originZ, rotationY, lengthWorld, heightWorld } = useMemo(() => {
    const dxMm = wall.end.xMm - wall.start.xMm;
    const dyMm = wall.end.yMm - wall.start.yMm;
    return {
      originX: wall.start.xMm * MM_TO_WORLD,
      originZ: wall.start.yMm * MM_TO_WORLD,
      // Rotate the group's local +x (world x) onto the wall direction in the
      // xz-plane. World z = plan y, so the direction is (dx, dy) -> yaw of
      // atan2(-dyMm, dxMm); this also lands the plane's front (+z) face on the
      // inward normal.
      rotationY: Math.atan2(-dyMm, dxMm),
      lengthWorld: Math.hypot(dxMm, dyMm) * MM_TO_WORLD,
      heightWorld: wall.heightMm * MM_TO_WORLD
    };
  }, [wall]);

  // The wall rectangle with door/window cutouts punched through as Shape
  // holes (spec §5.3). Shape coordinates are wall-local world units with the
  // origin at the wall's start-bottom corner, which is exactly the group's
  // local frame — so the mesh sits at the group origin, un-centered.
  const geometry = useMemo(() => {
    const shape = new Shape();
    shape.moveTo(0, 0);
    shape.lineTo(lengthWorld, 0);
    shape.lineTo(lengthWorld, heightWorld);
    shape.lineTo(0, heightWorld);
    shape.closePath();

    for (const hole of wall.holes) {
      const path = new Path();
      path.moveTo(mmToWorld(hole.xMinMm), mmToWorld(hole.yMinMm));
      path.lineTo(mmToWorld(hole.xMaxMm), mmToWorld(hole.yMinMm));
      path.lineTo(mmToWorld(hole.xMaxMm), mmToWorld(hole.yMaxMm));
      path.lineTo(mmToWorld(hole.xMinMm), mmToWorld(hole.yMaxMm));
      path.closePath();
      shape.holes.push(path);
    }

    return new ShapeGeometry(shape);
  }, [wall.holes, lengthWorld, heightWorld]);

  // R3F only auto-disposes on unmount; a geometry replaced by a re-derive
  // (resize, opening added) must be released here.
  useEffect(() => {
    return () => geometry.dispose();
  }, [geometry]);

  // Event precedence (spec §4.3): everything riding on the wall — artworks,
  // cases, wall texts, and now openings and blocked zones too — consumes its
  // own click before this fires; a click on BARE wall selects the wall and
  // stops so the canvas miss-handler doesn't also clear the selection.
  const handleWallClick = (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation();
    // An orbit drag's release also fires click — only a true click selects.
    if (event.delta > 6) return;
    onSelectWall(wall.wallId);
  };

  return (
    <group position={[originX, 0, originZ]} rotation={[0, rotationY, 0]}>
      <mesh geometry={geometry} onClick={handleWallClick}>
        <meshLambertMaterial
          key={ghosted ? "ghosted" : "solid"}
          color={isSelected ? WALL_SELECTED_COLOR : WALL_COLOR}
          transparent={ghosted}
          opacity={ghosted ? GHOST_OPACITY : 1}
          depthWrite={!ghosted}
        />
      </mesh>
      {wall.holes
        .filter((hole) => hole.treatment === "capped")
        .map((hole) => (
          <OpeningCapPlane
            key={hole.objectId}
            hole={hole}
            onSelect={onSelectObject}
            ghosted={ghosted}
          />
        ))}
      {/* Open (uncapped) holes have no geometry at all — the wall mesh is
          punched through — so each gets an invisible perimeter pick band to
          stand in for it. Holes carrying a `leaf` are skipped: the leaf slab
          already fills that aperture and is already clickable, and a band on
          top of it would be a second hit at the same depth for the same
          object. The PARTNER side of a shared hinged door has no leaf (the
          dedup in scene3d.ts hands the leaf to one side only) and does get a
          band — it is that room's own door object, with its own inspector. */}
      {wall.holes
        .filter((hole) => hole.treatment === "open" && hole.leaf === undefined)
        .map((hole) => (
          <OpeningPickBand
            key={hole.objectId}
            hole={hole}
            onSelect={onSelectObject}
            ghosted={ghosted}
          />
        ))}
      {/* One selection ring for every opening that isn't a hinged leaf —
          capped windows/doors and open doorways alike, since both now select
          themselves. DoorLeafMesh draws its own (a box, around the slab), so
          leaf holes are excluded here or they would wear two. */}
      {!ghosted
        ? wall.holes
            .filter(
              (hole) =>
                hole.leaf === undefined && selectedObjectIds.includes(hole.objectId)
            )
            .map((hole) => (
              <group
                key={`selected-${hole.objectId}`}
                position={[
                  mmToWorld((hole.xMinMm + hole.xMaxMm) / 2),
                  mmToWorld((hole.yMinMm + hole.yMaxMm) / 2),
                  mmToWorld(OPENING_OUTLINE_OFFSET_MM)
                ]}
              >
                <SelectionRectOutline
                  widthMm={hole.xMaxMm - hole.xMinMm + SELECTION_OUTLINE_OUTSET_MM}
                  heightMm={hole.yMaxMm - hole.yMinMm + SELECTION_OUTLINE_OUTSET_MM}
                />
              </group>
            ))
        : null}
      {/* Hinged-door leaves (spec §6). `leaf` is only ever set on a "door"
          hole (see the derivation in scene3d.ts), and only on the canonical
          side of a shared connection — the filter here is therefore also the
          dedup: the partner's hole for the same aligned pair has no `leaf`
          and never reaches this map. Its own `treatment` was already forced
          away from "capped" (same derivation), so the cap-plane block above
          never draws a competing plane at this hole's position either. */}
      {wall.holes
        .filter((hole) => hole.leaf !== undefined)
        .map((hole) => (
          <DoorLeafMesh
            key={hole.objectId}
            hole={hole}
            isSelected={selectedObjectIds.includes(hole.objectId)}
            onSelect={onSelectObject}
            ghosted={ghosted}
          />
        ))}
      {wall.blockedZones.map((zone) => (
        <WallBlockedZoneWash
          key={zone.objectId}
          zone={zone}
          isSelected={selectedObjectIds.includes(zone.objectId)}
          onSelect={onSelectObject}
          ghosted={ghosted}
        />
      ))}
      {wall.wallTexts.map((wallText) => (
        <WallTextPanel
          key={wallText.objectId}
          wallText={wallText}
          isSelected={selectedObjectIds.includes(wallText.objectId)}
          onSelect={onSelectObject}
          ghosted={ghosted}
        />
      ))}
      {wall.cases.map((wallCase) => (
        <WallCaseMesh
          key={wallCase.objectId}
          wallCase={wallCase}
          isSelected={selectedObjectIds.includes(wallCase.objectId)}
          onSelect={onSelectObject}
          ghosted={ghosted}
        />
      ))}
      {wall.artworks.map((artwork) => {
        const record = artworksById.get(artwork.artworkId);
        // Single interpreter of frameIncludedInImage: a flagged work is handed
        // no band, so ArtworkPlane draws none (the frame is already in the photo).
        const framing = effectiveFraming(record);
        return (
          <ArtworkPlane
            key={artwork.objectId}
            artwork={artwork}
            texture={artwork.assetId ? texturesByAssetId.get(artwork.assetId) : undefined}
            matWidthMm={framing.matWidthMm}
            frame={framing.frame}
            isSelected={
              selectedObjectIds.includes(artwork.objectId) ||
              artwork.artworkId === selectedArtworkId
            }
            onSelect={onSelectObject}
            ghosted={ghosted}
          />
        );
      })}
    </group>
  );
}

// The recessed backing plane an opening gets when it is NOT a geometrically
// aligned pair (a window, or a door with no room on the other side).
//
// It selects THE OPENING, not the wall it sits in. It used to call the wall's
// own click handler, which meant clicking a window selected the wall behind it
// and left the window — a placed object with its own inspector — unreachable
// from 3D. Same onSelectObject idiom as DoorLeafMesh below and every other
// wall child; Hole3d.objectId exists for exactly this.
function OpeningCapPlane({
  hole,
  onSelect,
  ghosted
}: {
  hole: Hole3d;
  onSelect: (objectId: string, opts: { additive: boolean }) => void;
  ghosted: boolean;
}) {
  const [hovered, setHovered] = useState(false);
  useCursor(hovered && !ghosted);

  const handleClick = (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation();
    // An orbit drag's release also fires click — only a true click selects.
    if (event.delta > 6) return;
    const { shiftKey, metaKey, ctrlKey } = event.nativeEvent;
    onSelect(hole.objectId, { additive: shiftKey || metaKey || ctrlKey });
  };

  return (
    <mesh
      onClick={handleClick}
      onPointerOver={(event) => {
        event.stopPropagation();
        setHovered(true);
      }}
      onPointerOut={() => setHovered(false)}
      position={[
        mmToWorld((hole.xMinMm + hole.xMaxMm) / 2),
        mmToWorld((hole.yMinMm + hole.yMaxMm) / 2),
        mmToWorld(OPENING_CAP_RECESS_MM)
      ]}
    >
      <planeGeometry
        args={[mmToWorld(hole.xMaxMm - hole.xMinMm), mmToWorld(hole.yMaxMm - hole.yMinMm)]}
      />
      <meshLambertMaterial
        key={ghosted ? "ghosted" : "solid"}
        color={hole.kind === "window" ? WINDOW_CAP_COLOR : OPENING_CAP_COLOR}
        transparent={ghosted || hole.kind === "window"}
        opacity={
          ghosted ? GHOST_OPACITY : hole.kind === "window" ? WINDOW_CAP_OPACITY : 1
        }
        depthWrite={!ghosted}
      />
    </mesh>
  );
}

// The click target for an OPEN doorway: an invisible band hugging the inside
// edge of the aperture, so the opening can be selected while its middle stays
// see-through AND click-through (openingPickBand.ts owns that rule and the
// geometry — read its header for why the centre is deliberately left alone).
//
// Invisible via the MATERIAL, never `visible={false}`: an object dropped from
// rendering is the sort of thing a renderer or a future three.js is entitled
// to drop from picking too, and this mesh exists ONLY to be picked. Zero
// opacity + no colour write + no depth write leaves it fully in the scene
// graph and fully raycastable while contributing nothing to any buffer.
function OpeningPickBand({
  hole,
  onSelect,
  ghosted
}: {
  hole: Hole3d;
  onSelect: (objectId: string, opts: { additive: boolean }) => void;
  ghosted: boolean;
}) {
  const [hovered, setHovered] = useState(false);
  // The whole target is invisible, so the pointer cursor is the only feedback
  // that there is something here to click. Gated on !ghosted like every other
  // wall child.
  useCursor(hovered && !ghosted);

  const rects = useMemo(() => openingPickBandRects(hole), [hole]);

  const handleClick = (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation();
    // An orbit drag's release also fires click — only a true click selects.
    if (event.delta > 6) return;
    const { shiftKey, metaKey, ctrlKey } = event.nativeEvent;
    onSelect(hole.objectId, { additive: shiftKey || metaKey || ctrlKey });
  };

  return (
    <group
      onPointerOver={(event) => {
        event.stopPropagation();
        setHovered(true);
      }}
      onPointerOut={() => setHovered(false)}
    >
      {rects.map((rect, index) => (
        <mesh
          key={index}
          onClick={handleClick}
          position={[mmToWorld(rect.centerXMm), mmToWorld(rect.centerYMm), 0]}
        >
          <planeGeometry args={[mmToWorld(rect.widthMm), mmToWorld(rect.heightMm)]} />
          {/* Single-sided ON PURPOSE (the material default), and load-bearing:
              a real shared doorway is a pair of COINCIDENT twin walls, so both
              rooms' bands occupy the same world position and a double-sided
              band would leave the winner of that depth tie to chance. Front
              faces point along the wall's inward normal, so each band is
              pickable only from its own room — and each room's click selects
              that room's own opening object, which is the one its inspector
              edits. */}
          <meshBasicMaterial transparent opacity={0} colorWrite={false} depthWrite={false} />
        </mesh>
      ))}
    </group>
  );
}

// A wall blocked zone: the translucent planning wash (spec §5.3) plus, now,
// its own click target. The wash is drawn geometry like anything else, so it
// selects ITS OWN object rather than falling through to the wall — a zone has
// an inspector of its own, and the wall's click handler would have swallowed
// every attempt to reach it.
function WallBlockedZoneWash({
  zone,
  isSelected,
  onSelect,
  ghosted
}: {
  zone: WallBlockedZone3d;
  isSelected: boolean;
  onSelect: (objectId: string, opts: { additive: boolean }) => void;
  ghosted: boolean;
}) {
  const [hovered, setHovered] = useState(false);
  useCursor(hovered && !ghosted);

  const widthMm = zone.xMaxMm - zone.xMinMm;
  const heightMm = zone.yMaxMm - zone.yMinMm;
  const centerXMm = (zone.xMinMm + zone.xMaxMm) / 2;
  const centerYMm = (zone.yMinMm + zone.yMaxMm) / 2;

  const handleClick = (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation();
    // An orbit drag's release also fires click — only a true click selects.
    if (event.delta > 6) return;
    const { shiftKey, metaKey, ctrlKey } = event.nativeEvent;
    onSelect(zone.objectId, { additive: shiftKey || metaKey || ctrlKey });
  };

  return (
    <group position={[mmToWorld(centerXMm), mmToWorld(centerYMm), 0]}>
      {/* A ghosted wall's zone is not drawn at all (it has always been dropped
          rather than faded — a wash at 15% of a hint is nothing), so it is not
          clickable either: an invisible click target over blank wall would be
          a trap. This is the one place the "drawn ⇒ selectable" rule cuts the
          other way. Ghosted ARTWORKS still take clicks because they are still
          drawn, just faint. */}
      <mesh
        visible={!ghosted}
        onClick={ghosted ? undefined : handleClick}
        onPointerOver={
          ghosted
            ? undefined
            : (event) => {
                event.stopPropagation();
                setHovered(true);
              }
        }
        onPointerOut={ghosted ? undefined : () => setHovered(false)}
        position={[0, 0, mmToWorld(BLOCKED_ZONE_OFFSET_MM)]}
      >
        <planeGeometry args={[mmToWorld(widthMm), mmToWorld(heightMm)]} />
        <meshBasicMaterial
          color={BLOCKED_ZONE_COLOR}
          transparent
          opacity={BLOCKED_ZONE_OPACITY}
          depthWrite={false}
        />
      </mesh>
      {/* Outline, never a tint (spec §6.2): the wash's own colour is what says
          "blocked", so tinting it to say "selected" would overwrite one
          meaning with the other. */}
      {!ghosted && isSelected ? (
        <group position={[0, 0, mmToWorld(BLOCKED_ZONE_OFFSET_MM + BLOCKED_ZONE_OUTLINE_OFFSET_MM)]}>
          <SelectionRectOutline
            widthMm={widthMm + SELECTION_OUTLINE_OUTSET_MM}
            heightMm={heightMm + SELECTION_OUTLINE_OUTSET_MM}
          />
        </group>
      ) : null}
    </group>
  );
}

// A hinged door's shut leaf: a thin slab filling the hole exactly (no reveal
// inset — unlike doorElevationGlyph, 3D draws no separate frame, so "filling
// the hole" is the leaf's whole visible footprint) plus one knob per face on
// the latch side. The leaf is a real placed object with its own inspector, so
// it selects the DOOR OBJECT via onSelect — the same onSelectObject idiom
// WallTextPanel and WallCaseMesh already use for their own wall children,
// and exactly what Hole3d.objectId exists for. (OpeningCapPlane and
// OpeningPickBand above now do the same for the two other ways an opening can
// be drawn; the leaf was the first case of this, not the exception.)
function DoorLeafMesh({
  hole,
  isSelected,
  onSelect,
  ghosted
}: {
  hole: Hole3d;
  isSelected: boolean;
  onSelect: (objectId: string, opts: { additive: boolean }) => void;
  ghosted: boolean;
}) {
  const [hovered, setHovered] = useState(false);
  useCursor(hovered && !ghosted);

  // Guaranteed by the caller's filter (wall.holes.filter(hole => hole.leaf
  // !== undefined)); narrowed once here rather than optional-chaining every
  // use below.
  const leaf = hole.leaf!;
  const widthMm = hole.xMaxMm - hole.xMinMm;
  const heightMm = hole.yMaxMm - hole.yMinMm;
  const centerXMm = (hole.xMinMm + hole.xMaxMm) / 2;
  const centerYMm = (hole.yMinMm + hole.yMaxMm) / 2;

  // The knob sits on the LATCH side — opposite the hinge — inset from that
  // free edge; same convention doorElevationGlyph uses for its own knob
  // (DOOR_KNOB_INSET_MM is measured from the leaf's own edge, not the wall's
  // jamb — see that constant's doc comment in doorGlyphs.ts).
  const rawKnobXMm = leaf.hingeAtMinX
    ? hole.xMaxMm - DOOR_KNOB_INSET_MM
    : hole.xMinMm + DOOR_KNOB_INSET_MM;
  // Clamped inside the leaf's own width — the same guard doorElevationGlyph
  // applies to its knob: a wall-bounds-clamped (narrow) hole can push the
  // inset past the panel while the knob itself still fits, and pinning it to
  // the latch edge is right; a knob drawn outside its own leaf would be the
  // caseGlyphs `includeLegs` mistake in a different costume.
  const knobXMm = Math.min(
    Math.max(rawKnobXMm, hole.xMinMm + DOOR_KNOB_RADIUS_MM),
    hole.xMaxMm - DOOR_KNOB_RADIUS_MM
  );
  // Height above the door's own bottom edge (its floor), not the room floor —
  // matches DOOR_KNOB_HEIGHT_MM's own doc comment in doorGlyphs.ts. Doors run
  // floor-to-top (derivePanelContents), so hole.yMinMm is always 0 in
  // practice, but this stays right if that ever changes.
  const knobYMm = hole.yMinMm + DOOR_KNOB_HEIGHT_MM;

  const handleClick = (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation();
    // An orbit drag's release also fires click — only a true click selects.
    if (event.delta > 6) return;
    const { shiftKey, metaKey, ctrlKey } = event.nativeEvent;
    onSelect(hole.objectId, { additive: shiftKey || metaKey || ctrlKey });
  };

  return (
    <group
      onPointerOver={(event) => {
        event.stopPropagation();
        setHovered(true);
      }}
      onPointerOut={() => setHovered(false)}
    >
      {/* The leaf slab, centered ON the wall plane (z=0) like the wall mesh
          itself — deliberately NOT recessed the way the flat cap plane is
          (OPENING_CAP_RECESS_MM): a real door sits IN its frame, not behind
          it, so half its thickness naturally stands proud of each wall face. */}
      <mesh onClick={handleClick} position={[mmToWorld(centerXMm), mmToWorld(centerYMm), 0]}>
        <boxGeometry
          args={[mmToWorld(widthMm), mmToWorld(heightMm), mmToWorld(DOOR_LEAF_THICKNESS_MM)]}
        />
        <meshLambertMaterial
          key={ghosted ? "ghosted" : "solid"}
          color={DOOR_LEAF_COLOR}
          transparent={ghosted}
          opacity={ghosted ? GHOST_OPACITY : 1}
          depthWrite={!ghosted}
        />
      </mesh>
      {/* The leaf's own edge. NOT decoration and not a nicety: measured against
          the shade-side wall the white leaf carries ~1.08 contrast — a 9/255
          step — so on that side this line is the entire reason the door is
          legible at all. The lit side manages ~1.19 on its own.

          Hence DOOR_LEAF_EDGE_OUTSET_MM. Drawn at the leaf's EXACT box the line
          is coplanar with the surface it bounds, and the two fight for the
          depth buffer: the jamb-side vertical and half the head broke into an
          intermittent dashed line at ordinary room distance. That is bad twice
          over — it degrades the one thing holding the door up on the shade
          side, and dashed box edges already MEAN something else here
          (DashedBoxOutline = unknown/approximate dimensions). SelectionBoxOutline
          below has always outset by 20mm and has always drawn clean; this is
          the same trick at the smallest offset that resolves, so the line still
          reads as the door's own edge rather than a halo around it.

          Suppressed while ghosted (the whole wall is a hint then) and while
          selected — the selection outline sits 20mm out and two concentric
          rectangles read as a mistake. */}
      {!ghosted && !isSelected ? (
        <group position={[mmToWorld(centerXMm), mmToWorld(centerYMm), 0]}>
          <BoxEdgeOutline
            widthMm={widthMm + DOOR_LEAF_EDGE_OUTSET_MM}
            heightMm={heightMm + DOOR_LEAF_EDGE_OUTSET_MM}
            depthMm={DOOR_LEAF_THICKNESS_MM + DOOR_LEAF_EDGE_OUTSET_MM}
            color={DOOR_LEAF_EDGE_COLOR}
          />
        </group>
      ) : null}
      {/* One knob per face, standing proud of the leaf on each side — a shut
          door is symmetric about the wall plane, so both faces need a knob
          for the door to read correctly from either room (the swing side,
          which WOULD differ the two faces, is deliberately not drawn at all —
          see Hole3d.leaf's doc comment). Cylinders default to a y-axis
          barrel; rotating 90deg about x lays that axis onto world z, i.e.
          straight out of the leaf face. */}
      {([1, -1] as const).map((sideSign) => (
        <mesh
          key={sideSign}
          onClick={handleClick}
          position={[
            mmToWorld(knobXMm),
            mmToWorld(knobYMm),
            sideSign * mmToWorld(DOOR_LEAF_THICKNESS_MM / 2 + DOOR_KNOB_PROTRUSION_MM / 2)
          ]}
          rotation={[Math.PI / 2, 0, 0]}
        >
          <cylinderGeometry
            args={[
              mmToWorld(DOOR_KNOB_RADIUS_MM),
              mmToWorld(DOOR_KNOB_RADIUS_MM),
              mmToWorld(DOOR_KNOB_PROTRUSION_MM),
              12
            ]}
          />
          <meshLambertMaterial
            key={ghosted ? "ghosted" : "solid"}
            color={DOOR_KNOB_COLOR}
            transparent={ghosted}
            opacity={ghosted ? GHOST_OPACITY : 1}
            depthWrite={!ghosted}
          />
        </mesh>
      ))}
      {!ghosted && isSelected ? (
        <group position={[mmToWorld(centerXMm), mmToWorld(centerYMm), 0]}>
          <SelectionBoxOutline
            widthMm={widthMm + 20}
            heightMm={heightMm + 20}
            depthMm={DOOR_LEAF_THICKNESS_MM + DOOR_KNOB_PROTRUSION_MM * 2 + 20}
          />
        </group>
      ) : null}
    </group>
  );
}
