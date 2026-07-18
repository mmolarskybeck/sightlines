import { useEffect, useState, type ReactNode } from "react";
import { TrashIcon } from "@phosphor-icons/react/dist/csr/Trash";
import type { DisplayUnit, WallTextWallObject } from "../../../domain/project";
import { WALL_TEXT_DEFAULT_NAME } from "../../../domain/placement/createWallText";
import { getScopedUnitContext } from "../shared/scopedUnits";
import { LengthField } from "../shared/LengthField";
import { InspectorFieldGrid } from "./InspectorFieldGrid";
import { InspectorRow } from "./InspectorRow";
import { Button } from "../ui/button";
import { Input } from "../ui/input";

// Minimal inspector for a wall text: rename plus size, with the shared
// wall-placement fields injected by App as `placementSection` (the same slot
// pattern ArtworkInspector uses). A wall text carries no other metadata — every
// panel renders the same skeleton bars regardless of its name.
export function WallTextInspector({
  wallText,
  placementSection,
  onRename,
  onCommitSize,
  onDelete,
  unit
}: {
  wallText: WallTextWallObject;
  placementSection?: ReactNode;
  onRename: (name: string) => void;
  onCommitSize: (widthMm: number, heightMm: number) => void;
  onDelete: () => void;
  unit: DisplayUnit;
}) {
  const size = getScopedUnitContext(unit, "openingSize");

  // Local draft so typing is smooth; commit on blur/Enter. Reset when the
  // selected wall text (or its stored name) changes.
  const storedName = wallText.name ?? WALL_TEXT_DEFAULT_NAME;
  const [name, setName] = useState(storedName);
  useEffect(() => {
    setName(storedName);
  }, [wallText.id, storedName]);

  const commitName = () => {
    if (name !== storedName) onRename(name);
  };

  return (
    <form className="inspector-form" onSubmit={(event) => event.preventDefault()}>
      <InspectorRow label="Name">
        <Input
          value={name}
          placeholder={WALL_TEXT_DEFAULT_NAME}
          onChange={(event) => setName(event.target.value)}
          onBlur={commitName}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              commitName();
            }
          }}
        />
      </InspectorRow>

      <InspectorFieldGrid columns={2}>
        <LengthField
          compact
          positiveOnly
          label="Width"
          valueMm={wallText.widthMm}
          displayUnit={size.displayUnit}
          parseUnit={size.parseUnit}
          placeholder={size.placeholder}
          onCommit={(widthMm) => onCommitSize(widthMm, wallText.heightMm)}
        />
        <LengthField
          compact
          positiveOnly
          label="Height"
          valueMm={wallText.heightMm}
          displayUnit={size.displayUnit}
          parseUnit={size.parseUnit}
          placeholder={size.placeholder}
          onCommit={(heightMm) => onCommitSize(wallText.widthMm, heightMm)}
        />
      </InspectorFieldGrid>

      {placementSection}

      <div className="inspector-placement">
        <Button
          className="inspector-action inspector-danger"
          variant="destructive-ghost"
          onClick={onDelete}
        >
          <TrashIcon aria-hidden="true" size={15} />
          Delete wall text
        </Button>
      </div>
    </form>
  );
}
