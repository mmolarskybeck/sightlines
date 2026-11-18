import { createElement, useEffect, useState, type ComponentType } from "react";
import { CircleNotchIcon } from "@phosphor-icons/react/dist/csr/CircleNotch";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../ui/dialog";
import { cn } from "../ui/utils";

type DialogProps = { open: boolean; onOpenChange: (open: boolean) => void };

// A dialog whose code is fetched on first open instead of shipping in the
// entry chunk. `lazy()` alone is not enough: React starts the fetch as soon as
// a lazy component RENDERS, and these dialogs render (closed) from startup. So
// nothing is rendered until the dialog is first opened; after that the real
// dialog stays mounted, so its close animation and open/close effects behave
// exactly as when it was eager.
//
// `preload` is for intent prefetch (hover/focus on the trigger), so the first
// open usually finds the code already loaded. A failed fetch clears the cached
// promise, so closing and reopening tries again. That is not offered as an
// in-place "Try again": Chromium caches a failed dynamic import() per URL
// (whatwg/html#6768) and never refetches it, and a chunk 404 after a deploy
// cannot succeed anyway — reloading the page is the recovery that always works.
export type DeferredModule<P> = {
  preload: () => Promise<ComponentType<P>>;
  loaded: () => ComponentType<P> | null;
};

export function deferredModule<P>(load: () => Promise<ComponentType<P>>): DeferredModule<P> {
  let pending: Promise<ComponentType<P>> | null = null;
  let resolved: ComponentType<P> | null = null;
  const preload = () => {
    pending ??= load().then(
      (component) => (resolved = component),
      (error: unknown) => {
        pending = null;
        throw error;
      }
    );
    return pending;
  };
  return { preload, loaded: () => resolved };
}

// A quick load shows nothing at all, so a fast first open feels like an eager
// one. Only a slow one shows the loading shell.
const SHELL_DELAY_MS = 300;

// idle: never opened (or reset after a failure) — renders nothing.
// loading: fetching; the shell appears once SHELL_DELAY_MS passes.
// failed: the shell shows the error and offers a reload.
// ready: the real dialog, mounted from here on.
type Phase = "idle" | "loading" | "failed" | "ready";

export function DeferredDialog<P extends DialogProps>({
  module,
  open,
  onOpenChange,
  title,
  className,
  props
}: {
  module: DeferredModule<P>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // Shown in the loading/error shell; should match the real dialog's title.
  title: string;
  // The real dialog's DialogContent class, so the shell opens at its size.
  className?: string;
  props: Omit<P, keyof DialogProps>;
}) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [shellVisible, setShellVisible] = useState(false);

  // Setting own state during render is React's sanctioned "derive from props"
  // pattern; it re-renders before commit.
  if (open && phase === "idle") setPhase(module.loaded() ? "ready" : "loading");

  useEffect(() => {
    if (phase !== "loading") return;
    let cancelled = false;
    const timer = window.setTimeout(() => setShellVisible(true), SHELL_DELAY_MS);
    module.preload().then(
      () => {
        if (cancelled) return;
        window.clearTimeout(timer);
        setPhase("ready");
        setShellVisible(false);
      },
      () => {
        if (cancelled) return;
        window.clearTimeout(timer);
        setPhase("failed");
        setShellVisible(true);
      }
    );
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [phase, module]);

  const Loaded = phase === "ready" ? module.loaded() : null;
  if (Loaded) return createElement(Loaded, { ...props, open, onOpenChange } as P);

  if ((phase !== "loading" && phase !== "failed") || !shellVisible) return null;
  return (
    <DeferredDialogShell
      className={className}
      open={open}
      title={title}
      state={phase === "failed" ? "error" : "loading"}
      onOpenChange={(next) => {
        if (!next && phase === "failed") {
          // The next open starts over and refetches.
          setPhase("idle");
          setShellVisible(false);
        }
        onOpenChange(next);
      }}
    />
  );
}

function DeferredDialogShell({
  className,
  open,
  title,
  state,
  onOpenChange
}: {
  className?: string;
  open: boolean;
  title: string;
  state: "loading" | "error";
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        aria-busy={state === "loading"}
        aria-describedby={undefined}
        className={cn("deferred-dialog", className)}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        {state === "loading" ? (
          <p className="deferred-dialog-state">
            <CircleNotchIcon aria-hidden="true" className="animate-spin" size={14} />
            <span>Loading…</span>
          </p>
        ) : (
          <div className="deferred-dialog-state" role="alert">
            <p>
              This couldn’t load, usually because the connection dropped or Sightlines was updated
              since this page opened. Reload the page to try again.
            </p>
            <div className="deferred-dialog-actions">
              <Button size="sm" onClick={() => window.location.reload()}>
                Reload page
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
