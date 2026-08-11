import { useRef } from "react";
import { toast } from "sonner";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "../ui/dialog";

export function ShareProjectDialog({
  url,
  warningCount,
  onClose
}: {
  url: string | null;
  warningCount: number;
  onClose: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  async function copyLink() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Share link copied.");
    } catch {
      inputRef.current?.focus();
      inputRef.current?.select();
      toast.error("Could not copy automatically. Select and copy the link below.");
    }
  }

  return (
    <Dialog open={url !== null} onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent className="share-project-dialog" showClose={false}>
        <DialogHeader>
          <DialogTitle>Share this project snapshot</DialogTitle>
          <DialogDescription>
            Anyone with this link can download the snapshot from your Dropbox and save an
            independent, editable copy in Sightlines. Later changes will not sync.
          </DialogDescription>
        </DialogHeader>
        <div className="share-project-body">
          <label className="share-project-link-field">
            <span>Share link</span>
            <Input
              ref={inputRef}
              aria-label="Share link"
              size="compact"
              readOnly
              value={url ?? ""}
              onFocus={(event) => event.currentTarget.select()}
            />
          </label>
          <p className="share-project-note">
            The snapshot stays in your Dropbox until you delete it there. Removing the file or its
            Dropbox link stops this Sightlines link from working.
          </p>
          {warningCount > 0 ? (
            <p className="share-project-warning">
              {warningCount === 1
                ? "One image was unavailable when this snapshot was created."
                : `${warningCount} images were unavailable when this snapshot was created.`}
            </p>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Done
          </Button>
          <Button variant="primary" onClick={() => void copyLink()}>
            Copy link
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
