import type { FloorObjectFace } from "../../../domain/project";
import { DEFAULT_FLOOR_OBJECT_IMAGE_FACES } from "../../../domain/project";
import { InspectorActionGroup } from "./InspectorActionGroup";
import { Toggle } from "../ui/toggle";

// Rendered as: Front Back Top / Left Right Bottom, matching the box's own
// front-back-top "primary" reading before the four secondary faces.
const FACE_ORDER: { face: FloorObjectFace; label: string }[] = [
  { face: "front", label: "Front" },
  { face: "back", label: "Back" },
  { face: "top", label: "Top" },
  { face: "left", label: "Left" },
  { face: "right", label: "Right" },
  { face: "bottom", label: "Bottom" }
];

// Six independent latching toggles — one per box face — for which faces of a
// floor-placed artwork's box carry the image (see FloorObjectFace and
// ArtworkFloorObject.imageFaces in domain/project.ts). Only ever mounted from
// App's `placedFloorArtwork` branch: the prop type (imageFaces, which exists
// only on ArtworkFloorObject) is itself the guarantee that a blocked zone or
// a display case — neither has an image to map — can't end up wired to this
// control, and a wall-hung artwork is a plane with no faces to choose, so it
// never reaches this branch either.
//
// Deliberately NOT a SegmentedToggleGroup/.seg-track: that grammar's sliding
// chip assumes exactly one active segment (see useSlidingIndicator in
// ui/segmented.tsx, which measures the FIRST checked/selected item), and
// DESIGN.md's track rule is explicit that a track is "only for sets where
// something is always chosen" — this set is legitimately 0-to-6 faces at
// once, including all-off (a deliberate neutral, untextured box). Each face
// is instead its own `Toggle`, the same petrol-wash/`--shadow-pressed`
// "latching" grammar already used for other usually-or-sometimes-off
// modes/attributes (ArtworkInspector's "Keep proportions",
// MeasurementInspector's Visible/Locked), laid out three-per-row through the
// `.floor-artwork-image-faces` grid override on InspectorActionGroup's row
// (global.css).
export function FloorArtworkImageFacesField({
  imageFaces,
  onChange
}: {
  // Absent (never touched by the curator) reads as
  // DEFAULT_FLOOR_OBJECT_IMAGE_FACES here — Front and Back must show LIT in
  // the picker, not implied by an all-off grid. See the doc comments on
  // ArtworkFloorObject.imageFaces and DEFAULT_FLOOR_OBJECT_IMAGE_FACES.
  imageFaces: FloorObjectFace[] | undefined;
  onChange: (faces: FloorObjectFace[]) => void;
}) {
  const active = imageFaces ?? DEFAULT_FLOOR_OBJECT_IMAGE_FACES;

  const setFace = (face: FloorObjectFace, pressed: boolean) => {
    const next = pressed
      ? [...active, face]
      : active.filter((existing) => existing !== face);
    // Hand the store the literal result, even when it's []. Turning the last
    // face off is a legal, intentional "no image anywhere" state (see the
    // imageFaces prop doc above) — a `next.length ? next : undefined`
    // shortcut here would silently coalesce back to
    // DEFAULT_FLOOR_OBJECT_IMAGE_FACES the moment the curator clears the last
    // face, making "off" unreachable from this control. The store's own
    // setFloorArtworkImageFaces does the set-equality no-op check, so this
    // component never needs to guard against redundant writes itself.
    onChange(next);
  };

  return (
    <InspectorActionGroup className="floor-artwork-image-faces" label="Image on">
      {FACE_ORDER.map(({ face, label }) => (
        <Toggle
          key={face}
          aria-label={`${label} face`}
          pressed={active.includes(face)}
          size="sm"
          variant="default"
          onPressedChange={(pressed) => setFace(face, pressed)}
        >
          {label}
        </Toggle>
      ))}
    </InspectorActionGroup>
  );
}
