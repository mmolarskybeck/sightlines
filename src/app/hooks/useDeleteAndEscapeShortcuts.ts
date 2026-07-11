import { useEffect } from "react";

import type { ArrangeSession } from "../store";
import type { Selection } from "../store/selectionSlice";
import { isEditableTarget } from "./isEditableTarget";
import { shouldDeleteRoomOnKey, summarizeRoomContents } from "../roomDeletion";
import type { Project } from "../../domain/project";

export type UseDeleteAndEscapeShortcutsParams = {
  project: Project | null;
  selection: Selection;
  selectedObjectIds: string[];
  selectedFreestandingWallId: string | null;
  deleteFreestandingWall: (wallId: string) => Promise<void>;
  deleteRoom: (roomId: string) => Promise<void>;
  reshapeRoomId: string | null;
  confirmDeleteRoomId: string | null;
  draggingArtworkId: string | null;
  isHelpOpen: boolean;
  removeSelectedPlacements: () => Promise<void>;
  clearObjectSelection: () => void;
  arrangeSession: ArrangeSession | null;
  cancelArrangeSession: () => void;
  setIsHelpOpen: (open: boolean) => void;
  setConfirmDeleteRoomId: (roomId: string | null) => void;
};

// Escape reverts a live arrange session first (leaving the selection intact
// so a second Escape can then clear it), else clears whatever is selected.
// Delete/Backspace removes whichever placement is currently selected — a
// placed anything (artwork, opening, blocked zone, single or multi) is an
// objects-selection now, so one branch covers all of it in a single undo
// entry. Both guarded against editable targets (LengthFields use Backspace
// for text editing) and an in-flight checklist drag, the same idiom as the
// undo/redo effect above.
export function useDeleteAndEscapeShortcuts({
  project,
  selection,
  selectedObjectIds,
  selectedFreestandingWallId,
  deleteFreestandingWall,
  deleteRoom,
  reshapeRoomId,
  confirmDeleteRoomId,
  draggingArtworkId,
  isHelpOpen,
  removeSelectedPlacements,
  clearObjectSelection,
  arrangeSession,
  cancelArrangeSession,
  setIsHelpOpen,
  setConfirmDeleteRoomId
}: UseDeleteAndEscapeShortcutsParams) {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      // The help dialog (Radix) closes itself on Escape; setting the same
      // false here is idempotent. The branch stays because the early return
      // is what keeps Esc-priority: while help is open, no key may fall
      // through to the delete/clear-selection handling below.
      if (isHelpOpen) {
        if (event.key === "Escape") {
          setIsHelpOpen(false);
        }
        return;
      }

      // The delete-room confirm dialog owns the keyboard while open: Radix
      // itself closes on Escape (this handler must not ALSO clear the
      // selection), and Delete must not re-trigger the branch below while
      // the question is already on screen.
      if (confirmDeleteRoomId) return;

      // Escape now clears ANY selection kind — objects, an unplaced checklist
      // pick, or a room focus (previously only the multi-object slot cleared
      // here; clearing a room selection was reachable only via other paths,
      // e.g. selecting a wall). PlanView's own Escape listener disarms an
      // armed placement tool; both firing together is harmless.
      if (event.key === "Escape") {
        if (isEditableTarget(event.target)) return;
        if (arrangeSession) {
          cancelArrangeSession();
          return;
        }
        if (selection.kind !== "none") clearObjectSelection();
        return;
      }

      if (event.key !== "Delete" && event.key !== "Backspace") return;
      if (isEditableTarget(event.target)) return;
      if (draggingArtworkId) return;
      if (!project) return;

      // A placed selection (artwork, opening, blocked zone) is always an
      // objects-selection, so this one branch removes it — single or multi —
      // in one undo entry. An unplaced checklist pick
      // (selection.kind === "libraryArtwork") is deliberately ignored: there's
      // no placement id to remove.
      if (selectedObjectIds.length > 0) {
        event.preventDefault();
        void removeSelectedPlacements();
        return;
      }

      // A selected partition deletes with its cascade (both faces' objects) in
      // one undo entry.
      if (selectedFreestandingWallId) {
        event.preventDefault();
        void deleteFreestandingWall(selectedFreestandingWallId);
        return;
      }

      // Last in the chain: a whole-room selection (selection kind "room" —
      // never a wall focus, which selectWall writes as NO_SELECTION + wall
      // context). shouldDeleteRoomOnKey also stands down while edit-shape is
      // armed (vertex removal owns the key there, via PlanView). Empty rooms
      // delete immediately (one undo entry, cascade handled by deleteRoom);
      // occupied rooms confirm through the dialog first.
      const roomIdToDelete = shouldDeleteRoomOnKey({
        eventTarget: event.target,
        reshapeRoomId,
        selection
      });
      if (roomIdToDelete) {
        const placement = project.floor.rooms.find(
          (candidate) => candidate.roomId === roomIdToDelete
        );
        if (!placement) return;
        event.preventDefault();
        if (summarizeRoomContents(project, placement).isEmpty) {
          void deleteRoom(roomIdToDelete);
        } else {
          setConfirmDeleteRoomId(roomIdToDelete);
        }
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    project,
    selection,
    selectedObjectIds,
    selectedFreestandingWallId,
    deleteFreestandingWall,
    deleteRoom,
    reshapeRoomId,
    confirmDeleteRoomId,
    draggingArtworkId,
    isHelpOpen,
    removeSelectedPlacements,
    clearObjectSelection,
    arrangeSession,
    cancelArrangeSession,
    setIsHelpOpen,
    setConfirmDeleteRoomId
  ]);
}
