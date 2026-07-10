# Quick Todos
Here is where I gather small, actionable tasks and scraps for future implementation, things that don't fit cleanly into the overall roadmap and aren't necessarily part of major features.

## Open Scraps

* another snap case to consider - if we have a group of works in between 2 groups of works (rather than in between 1 group and 1 wall) - we do allow for granular adjustment of the space between those 2 works (with the between works tab) - but what about granularly adjusting the spacing on left and right between that group and the other 2 neighboring groups? space evenly > open space just evenly distributes them across that space, but often we want to essentially do a version of from wall edges but treat the artwork groups to left and right as the targets. 
  * if nothing else, we want to be able to see the dim lines showing space from left-neighbor group/artwork and space from right-neighbor group/artwork. currently, in between works tab, we just see the dim lines for space to left and right walls.
* we need some sort of way to resolve/handle when dims don't perfectly match the aspect ratio of the image
  * for instance, we could add an option to arrive image aspect ratio w the accurate dims, but we don't want to the resulting image preview to appear squished/distorted
* add framing + matting previews in elevation mode and plan mode
  * in plan mode, this is just a simple dim change
  * in elevation mode, an svg is drawn around the object per input details - for instance, a 3in white mat would add 3in white outline around the image, with perhaps a very thin grey or black border to indicate the edge of the mat. a frame would simply be defined by its width and color, and would be represented by a simple color fill, maybe using a hex code picker ultimately but starting w a dropdown list w: gold, white, black, silver/brushed aluminum, wood) - these will be very very simple mockups, not high resolution attempts to perfectly create complex frames

## Done / Folded Back Into Progress

* Added an eyeline (centerline) show/hide toggle in elevation mode, mirroring the grid toggle's state, storage, and UI pattern; centerline alignment snapping stays active while hidden, matching how grid snap stays independent of grid visibility.
* Fixed dims input UI/UX: length fields now reserve a stable message slot for conversion previews/errors.
* Added plan-wall click selection without conflicting with object selection or armed placement tools.
* Moved plan-mode door/window/blocked-zone placement into the top-bar insert workflow.
* Made the thin rectangle SVGs defining placement of art/objects in plan mode more visible and distinguishable --> let's refine and improve this, they are hard to see - also maybe petrol is not a good select color for wall select, bc not enough contrast w black
* polish the checklist UI - current sort dropdown feels clunky/inelegant.
* refine look of imperial/metric switch, it is too thin compared to surrounding elements and also has unnecessary double pill structure
* consider making add to this wall (door/window/zone) buttons in wall inspector pane into equally sized chips w useful hover tooltips
* make checklist/rooms&walls pane area resizable, also maybe make inspector pane resizable and collapsible ?
* i would expect that just entering ONE dim (height OR width) for an artwork should automatically supply the other dim, since we already know the artwork's aspect ratio based on the image file - so you should be able to enter just width or length, press return, and have the other dim autopopulate - you can still edit it manually, as you can now, but it will default on blur/return to the logical value based on the image's aspect ratio and the one defined dimension (this is only for 2d objects, i guess, or at least it doesn't apply to depth (z-axis dims))
* dim entry fields for artworks should reserve a stable message slot for conversion previews/errors so that layout spacing/sizing doesn't change every time the preview conversion pops up, also dim entry field sizing should be tweaked and made consistent w/ clean spacing
* when an artwork is dragged into the workspace, the little thumbnail that appears should be at the correct aspect ratio (currently squished)
* an artwork selected in the inspector pane should show a small thumbnail image there, next to the metadata - consider how best to lay this out responsively. also we should restructure the metadata organization so dims are near the top, currently they are too far down. things like lender/location can be nearer to the bottom.