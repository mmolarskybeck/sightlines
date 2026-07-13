import { Kbd } from "../ui/kbd";

// The key hint that trails a toolbar tooltip's phrase. The first token is the
// key itself; any remaining text stays as a quiet explanatory suffix.
export function ToolbarTooltipKbd({ hint }: { hint: string }) {
  const [key, ...suffix] = hint.split(" ");
  const hasShiftModifier = key.startsWith("⇧") && key.length > 1;

  return (
    <span className="toolbar-tooltip-kbd">
      {hasShiftModifier ? (
        <>
          <Kbd>⇧</Kbd>
          <Kbd>{key.slice(1)}</Kbd>
        </>
      ) : (
        <Kbd>{key}</Kbd>
      )}
      {suffix.length > 0 ? <span>{suffix.join(" ")}</span> : null}
    </span>
  );
}
