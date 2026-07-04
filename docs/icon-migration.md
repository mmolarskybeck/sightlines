# Icon Migration Notes

Sightlines is moving from Lucide toward Phosphor as the default icon family. This is a working map of current Lucide usage, proposed Phosphor replacements, and likely upcoming icons.

## Direction

- Prefer `@phosphor-icons/react` throughout the app for now.
- Start with `regular` weight. Try `light` only if rail icons feel too heavy at 22px.
- Use one family per surface where possible; avoid mixing Lucide and Phosphor in the same toolbar.
- Keep icons line-like, quiet, and architectural. Avoid duotone/fill for routine product chrome.
- If a stock icon reads as generic UI instead of exhibition planning, create a small custom Sightlines icon rather than forcing the set.

Phosphor React components use PascalCase names with an `Icon` suffix, for example `ListChecksIcon`, `CornersOutIcon`, `HandIcon`.

## Left Rail

The rail is the highest-priority replacement. Current Lucide glyphs read too much like generic app layout controls.

| Current Lucide | Current Use | Preferred Phosphor | Alternatives | Notes |
|---|---|---|---|---|
| `PanelLeft` | Checklist panel | `ListChecksIcon` | `RowsIcon`, custom artwork-list icon | `ListChecks` is a clearer checklist metaphor than a layout panel. |
| `Blocks` | Rooms & walls panel | `WallIcon` | `BoundingBoxIcon`, custom floor-plan icon | `Wall` is worth trying first. `BoundingBox` may read more like selection/resize. |
| `TriangleAlert` | Placement issues | `WarningIcon` | `WarningCircleIcon`, `WarningDiamondIcon` | Consider showing stronger color only when issues exist; disabled warning can be very quiet. |
| `FileJson` | Data view | `FileCodeIcon` | `BracketsCurlyIcon`, `CodeBlockIcon` | Keep this in the lower utility cluster; it is still developer-facing. |
| `Settings` | Settings placeholder | `SlidersHorizontalIcon` | `GearSixIcon` | `SlidersHorizontal` feels more product-settings/workspace-preferences than gear. |
| `CircleHelp` | Help placeholder | `QuestionIcon` | `QuestionMarkIcon`, `InfoIcon` | `Question` is simpler and lighter than a circled help mark. |

Future rail candidate:

| Planned Use | Preferred Phosphor | Alternatives | Notes |
|---|---|---|---|
| Artwork library | `ImagesSquareIcon` | `ImageSquareIcon`, custom artwork-stack icon | Use this when the library becomes distinct from the checklist. |
| 3D view | `CubeIcon` | `ThreeDIcon`, `CubeTransparentIcon` | User preference: `Cube`. Good fit. |

## Top Bar

| Current Lucide | Current Use | Proposed Phosphor | Notes |
|---|---|---|---|
| `Undo2` | Undo | `ArrowCounterClockwiseIcon` | Familiar enough; test at 18px. |
| `Redo2` | Redo | `ArrowClockwiseIcon` | Pair with undo. |
| `Upload` | Import project JSON | `UploadSimpleIcon` | Clearer and less tray-heavy than generic upload. |
| `Download` | Export project JSON | `DownloadSimpleIcon` | Pair with import. |
| `Save` | Local save/storage note | `FloppyDiskIcon` | If this feels too old-computer, try `DatabaseIcon` for local persistence. |
| `ChevronDown` | Project picker | `CaretDownIcon` | Phosphor uses caret language well. |

## View Modes And Canvas Controls

| Current Lucide | Current Use | Proposed Phosphor | Alternatives | Notes |
|---|---|---|---|---|
| `Grid2X2` | Plan tab | `GridFourIcon` | custom plan icon | A custom room-plan icon may eventually be stronger. |
| `Ruler` | Elevation tab | `RulerIcon` | custom elevation/wall icon | `Ruler` is acceptable, but risks being confused with measurement tools later. |
| `Grid3X3` | Show grid | `GridNineIcon` | `DotsNineIcon` | Keep visually quieter than Plan mode. |
| `Magnet` | Snap to grid | `MagnetIcon` | none | Direct replacement. |
| `Layers` | Allow overlap | `StackIcon` | `StackSimpleIcon`, `SquaresFourIcon` | `Stack` may read better than literal layers for artwork overlap. |
| `ChevronLeft` | Previous wall | `CaretLeftIcon` | `ArrowLeftIcon` | Carets are better for compact switchers. |
| `ChevronRight` | Next wall | `CaretRightIcon` | `ArrowRightIcon` | Pair with previous. |

Upcoming canvas controls:

| Planned Use | Preferred Phosphor | Alternatives | Notes |
|---|---|---|---|
| Fit to view | `CornersOutIcon` | `FrameCornersIcon` | User preference: `CornersOut`. |
| Pan | `HandIcon` | `CursorIcon`, `ArrowsOutCardinalIcon` | User preference: `Hand`. |
| Zoom in | `MagnifyingGlassPlusIcon` | `PlusCircleIcon` | Use magnifier for explicit zoom. |
| Zoom out | `MagnifyingGlassMinusIcon` | `MinusCircleIcon` | Pair with zoom in. |
| Reset zoom | `CornersInIcon` | `ArrowsInSimpleIcon` | Only if reset/fit need separate controls. |
| Select tool | `CursorIcon` | `MousePointerIcon` if available | Use if pan becomes a separate tool mode. |

## Inspectors And Domain Actions

| Current Lucide | Current Use | Proposed Phosphor | Alternatives | Notes |
|---|---|---|---|---|
| `DoorOpen` | Add door | `DoorIcon` | custom door swing icon | User preference: Phosphor `Door`. A real door-swing custom icon may be better later. |
| `Square` | Add window | `SquareIcon` | custom window icon | User preference: `Square`; acceptable for now. |
| `SquareDashed` | Add blocked zone | `SquareDashedIcon` | `SelectionIcon`, custom blocked-zone icon | Dashed square is a good short-term match. |
| `Link2` | Linked opposing wall dimensions | `LinkIcon` | `ChainIcon` | Direct replacement. |
| `Link2Off` | Remove artwork from wall | `LinkBreakIcon` | `UnlinkIcon` if available | `LinkBreak` is the clearer action. |
| `Trash2` | Delete/remove project or opening | `TrashIcon` | `TrashSimpleIcon` | Use one trash variant everywhere. |
| `Plus` | Add room/project/etc. | `PlusIcon` | none | Direct replacement. |

Future domain actions:

| Planned Use | Preferred Phosphor | Alternatives | Notes |
|---|---|---|---|
| Align left/right/top/bottom | `AlignLeftIcon`, `AlignRightIcon`, `AlignTopIcon`, `AlignBottomIcon` | `*-SimpleIcon` variants | Prefer the simple variants if the full icons are too text-layout-coded. |
| Align center | `AlignCenterHorizontalIcon`, `AlignCenterVerticalIcon` | `AlignCenterHorizontalSimpleIcon`, `AlignCenterVerticalSimpleIcon` | Need horizontal/vertical distinction in tooltips. |
| Distribute spacing | likely custom or Tabler fallback | Phosphor align variants | Phosphor may be weaker here; evaluate when feature shape is known. |
| Lock placement | `LockIcon` | `LockKeyIcon` | Standard. |
| Unlock placement | `LockOpenIcon` | none | Pair with lock. |
| Measurement/dimension | custom Sightlines icon | `RulerIcon`, `ResizeIcon` if suitable | Avoid overloading `Ruler` if Elevation keeps it. |

## Checklist And Artwork

| Current Lucide | Current Use | Proposed Phosphor | Alternatives | Notes |
|---|---|---|---|---|
| `ImagePlus` | Empty checklist/Add artwork | `ImageSquareIcon` | `ImagesSquareIcon`, custom image-plus composition | Phosphor does not need to carry the plus if the button text says Add Artwork. |
| `GripVertical` | Drag handle | `DotsSixVerticalIcon` | `DotsThreeVerticalIcon` | Conventional drag affordance. |
| `X` | Remove row | `XIcon` | `XCircleIcon` | Plain `X` matches current quiet remove behavior. |

## Open Questions

- Should Plan and Elevation eventually use custom Sightlines view icons instead of stock grid/ruler icons?
- Should the rail hide disabled Settings/Help until those views exist, or keep them as future affordances?
- Should artwork library and checklist be separate rail destinations once the library exists?
- Does `WallIcon` read as architectural enough in the 48px rail button, or does it look like masonry? Test against `BoundingBoxIcon` and a custom floor-plan mark.

