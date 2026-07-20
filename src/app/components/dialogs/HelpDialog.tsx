import { useState } from "react";
import type { ViewMode } from "../../store";
import {
  generalHelpGroup,
  viewHelpGroups,
  type HelpGroup,
  type HelpInputMode,
  type HelpViewTab
} from "./helpContent";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle
} from "../ui/dialog";
import { Kbd } from "../ui/kbd";
import { Tabs, TabsContent } from "../ui/tabs";
import {
  SegmentedToggleGroup,
  SegmentedToggleGroupItem,
  UnderlineTabsList,
  UnderlineTabsTrigger
} from "../ui/segmented";

const VIEW_TABS: { value: HelpViewTab; label: string }[] = [
  { value: "plan", label: "Plan" },
  { value: "elevation", label: "Elevation" },
  { value: "3d", label: "3D" }
];

const TRUST_LINKS = [
  { href: "/about.html", label: "About" },
  { href: "/privacy.html", label: "Privacy" },
  { href: "/security.html", label: "Security" },
  { href: "/it.html", label: "For IT teams" }
];

// Touch-primary devices (iPhone/iPad, most Android) report a coarse pointer;
// the toggle below lets anyone flip regardless of what we detected.
function isTouchPrimary(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(pointer: coarse)").matches
  );
}

// Context-aware help inside the shared .dialog-content overlay: one tab per
// canvas view (preselecting whichever is active), hints per input mode, and a
// view-independent group below the tabs. All hint content lives in
// helpContent.ts as plain data.
export function HelpDialog({
  open,
  onOpenChange,
  viewMode
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  viewMode: ViewMode;
}) {
  const isMac =
    typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
  const [inputMode, setInputMode] = useState<HelpInputMode>(() =>
    isTouchPrimary() ? "touch" : "keyboard"
  );

  // The data view has no canvas controls of its own; fall back to Plan.
  const activeTab: HelpViewTab =
    viewMode === "elevation" || viewMode === "3d" ? viewMode : "plan";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="help-dialog-content">
        <DialogHeader>
          <p className="help-dialog-kicker">Sightlines</p>
          <DialogTitle>Help</DialogTitle>
        </DialogHeader>

        <div className="help-body">
          <p className="help-blurb">
            Plan exhibitions to scale: draw rooms in Plan, hang works on each wall in
            Elevation, and check the result in 3D. Drag artworks from the checklist
            straight onto a wall.
          </p>

          <SegmentedToggleGroup
            aria-label="Input method"
            className="help-input-toggle"
            type="single"
            value={inputMode}
            onValueChange={(value) => {
              // Radix emits "" when the active item is clicked again; a
              // single-select toggle must never go empty.
              if (value) setInputMode(value as HelpInputMode);
            }}
          >
            <SegmentedToggleGroupItem value="keyboard">
              Keyboard &amp; mouse
            </SegmentedToggleGroupItem>
            <SegmentedToggleGroupItem value="touch">
              Touch
            </SegmentedToggleGroupItem>
          </SegmentedToggleGroup>

          {/* DialogContent unmounts when closed, so defaultValue re-reads the
              active view on every open. */}
          <Tabs className="help-tabs" defaultValue={activeTab}>
            <UnderlineTabsList className="help-tabs-list">
              {VIEW_TABS.map((tab) => (
                <UnderlineTabsTrigger key={tab.value} value={tab.value}>
                  {tab.label}
                </UnderlineTabsTrigger>
              ))}
            </UnderlineTabsList>
            {VIEW_TABS.map((tab) => (
              <TabsContent className="help-tab-panel" key={tab.value} value={tab.value}>
                {viewHelpGroups(tab.value, inputMode, isMac).map((group) => (
                  <HintGroup group={group} key={group.title} />
                ))}
              </TabsContent>
            ))}
          </Tabs>

          <HintGroup group={generalHelpGroup(inputMode, isMac)} />

          <p className="help-privacy-note">
            Projects and artwork images stay on this device unless you explicitly export
            them or connect your own Dropbox for direct backup. Sightlines requires no
            account and does not receive a copy of your work.
          </p>

          <nav aria-label="More information" className="help-link-row">
            {TRUST_LINKS.map((link) => (
              <a
                className="help-link"
                href={link.href}
                key={link.href}
                rel="noreferrer"
                target="_blank"
              >
                {link.label}
              </a>
            ))}
          </nav>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function HintGroup({ group }: { group: HelpGroup }) {
  return (
    <section className="help-group">
      <h3 className="help-section-title">{group.title}</h3>
      <dl className="help-shortcut-list">
        {group.hints.map((hint) => (
          <div className="help-shortcut-row" key={hint.action}>
            <dt>{hint.action}</dt>
            <dd>
              {hint.inputs.map((input) => (
                <span className="help-input" key={input.map((token) => token.label).join("|")}>
                  {input.map((token, index) =>
                    token.kind === "key" ? (
                      <Kbd key={`${token.label}-${index}`}>{token.label}</Kbd>
                    ) : (
                      <span className="help-input-text" key={`${token.label}-${index}`}>
                        {token.label}
                      </span>
                    )
                  )}
                </span>
              ))}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
