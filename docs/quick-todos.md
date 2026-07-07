# Quick Todos
Here is where I gather small, actionable tasks and scraps for future implementation, things that don't fit cleanly into the overall roadmap and aren't necessarily part of major features.

## Open Scraps

* Made the thin rectangle SVGs defining placement of art/objects in plan mode more visible and distinguishable --> let's refine and improve this, they are hard to see - also maybe petrol is not a good select color for wall select, bc not enough contrast w black
* refine look of imperial/metric switch, it is too thin compared to surrounding elements and also has unnecessary double pill structure
* consider making add to this wall (door/window/zone) buttons in wall inspector pane into equally sized chips w useful hover tooltips
* make checklist/rooms&walls pane area resizable, also maybe make inspector pane resizable and collapsible ?
* i would expect that just entering ONE dim (height OR width) for an artwork should automatically supply the other dim, since we already know the artwork's aspect ratio based on the image file - so you should be able to enter just width or length, press return, and have the other dim autopopulate - you can still edit it manually, as you can now, but it will default on blur/return to the logical value based on the image's aspect ratio and the one defined dimension (this is only for 2d objects, i guess, or at least it doesn't apply to depth (z-axis dims))


## Done / Folded Back Into Progress

* Fixed dims input UI/UX: length fields now reserve a stable message slot for conversion previews/errors.
* Added plan-wall click selection without conflicting with object selection or armed placement tools.
* Moved plan-mode door/window/blocked-zone placement into the top-bar insert workflow.