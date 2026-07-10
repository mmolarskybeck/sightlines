// Site-wide constants. Edit here, not in individual pages.

/** Where the "Open the app" buttons point. */
export const APP_URL = "https://app.sightlines.art/";

export const SITE_NAME = "Sightlines";

export const SITE_TAGLINE =
  "Exhibition planning, drawn to scale — private by design.";

export const DEFAULT_DESCRIPTION =
  "Sightlines is a private-by-design exhibition planning tool for scaled room layouts, wall elevations, artwork placement, and 3D preview. Built for curators, galleries, museums, and installation teams.";

/** Shown in header and footer navigation, in order. */
export const NAV_LINKS = [
  { href: "/about", label: "About" },
  { href: "/privacy", label: "Privacy" },
  { href: "/security", label: "Security" },
  { href: "/it", label: "For IT teams" },
] as const;
