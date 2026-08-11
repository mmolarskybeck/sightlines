import { useEffect, useState } from "react";
import { CircleNotchIcon } from "@phosphor-icons/react/dist/csr/CircleNotch";
import { CheckCircleIcon } from "@phosphor-icons/react/dist/csr/CheckCircle";
import { WarningCircleIcon } from "@phosphor-icons/react/dist/csr/WarningCircle";
import { fetchDropboxSharedPackage } from "../../cloud/fetchDropboxShare";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "../ui/dialog";

type SharedProjectState =
  | { status: "idle" | "loading"; bytes: null; error: null }
  | { status: "ready" | "importing"; bytes: ArrayBuffer; error: null }
  | { status: "error"; bytes: null; error: string };

const IDLE_STATE: SharedProjectState = { status: "idle", bytes: null, error: null };

export function SharedProjectImportDialog({
  dropboxUrl,
  onImport,
  onLeave
}: {
  dropboxUrl: string | null;
  onImport: (bytes: ArrayBuffer) => Promise<boolean>;
  onLeave: () => void;
}) {
  const [state, setState] = useState<SharedProjectState>(IDLE_STATE);

  useEffect(() => {
    if (!dropboxUrl) {
      setState(IDLE_STATE);
      return;
    }
    const controller = new AbortController();
    setState({ status: "loading", bytes: null, error: null });
    void fetchDropboxSharedPackage(dropboxUrl, controller.signal).then(
      (bytes) => setState({ status: "ready", bytes, error: null }),
      (error) => {
        if (controller.signal.aborted) return;
        setState({
          status: "error",
          bytes: null,
          error: error instanceof Error ? error.message : "This shared project could not be opened."
        });
      }
    );
    return () => controller.abort();
  }, [dropboxUrl]);

  async function saveCopy() {
    if (state.status !== "ready") return;
    const bytes = state.bytes;
    setState({ status: "importing", bytes, error: null });
    const imported = await onImport(bytes);
    if (imported) onLeave();
    else setState({ status: "ready", bytes, error: null });
  }

  const busy = state.status === "loading" || state.status === "importing";
  return (
    <Dialog open={dropboxUrl !== null}>
      <DialogContent className="share-project-dialog" showClose={false}>
        <DialogHeader>
          <DialogTitle>A project was shared with you</DialogTitle>
          <DialogDescription>
            Sightlines will save an independent copy in this browser. Your changes will not
            affect the project in Dropbox or anyone else’s copy.
          </DialogDescription>
        </DialogHeader>
        <div className="share-project-body">
          <div className="shared-project-status" data-status={state.status}>
            {busy ? (
              <CircleNotchIcon aria-hidden="true" className="animate-spin" size={18} />
            ) : null}
            {state.status === "ready" ? <CheckCircleIcon aria-hidden="true" size={18} /> : null}
            {state.status === "error" ? <WarningCircleIcon aria-hidden="true" size={18} /> : null}
            {state.status === "loading" ? (
              <span>Downloading the project from Dropbox…</span>
            ) : null}
            {state.status === "ready" ? <span>The project is ready to save.</span> : null}
            {state.status === "importing" ? <span>Saving your copy…</span> : null}
            {state.status === "error" ? <span role="alert">{state.error}</span> : null}
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" disabled={state.status === "importing"} onClick={onLeave}>
            Open my projects
          </Button>
          <Button
            variant="primary"
            disabled={state.status !== "ready"}
            onClick={() => void saveCopy()}
          >
            Save a copy and open
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
