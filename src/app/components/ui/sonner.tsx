import { Toaster as SonnerToaster, type ToasterProps } from "sonner";

// The app has no dark mode (see :root { color-scheme: light } in
// global.css) and no next-themes provider, so the shadcn template's
// useTheme() hook is omitted — the toaster always renders "light". Visual
// treatment (white surface for every toast type, --radius-overlay corners,
// --shadow-overlay, no colored-fill "rich colors") lives in the
// [data-sonner-toaster]/[data-sonner-toast] rules in global.css, matching
// this app's overlay grammar and the no-pill/no-left-stripe design rule.
export function Toaster({ position = "bottom-center", ...props }: ToasterProps) {
  return (
    <SonnerToaster
      theme="light"
      position={position}
      className="sonner-toaster"
      {...props}
    />
  );
}
