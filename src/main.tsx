import React from "react";
import ReactDOM from "react-dom/client";
// Figtree and Geist are self-hosted at stable /fonts/ URLs (see the
// @font-face rules in global.css) so index.html can preload them directly —
// @fontsource's hashed build-time asset URLs can't be preloaded. Geist Mono
// isn't in the critical rendering path, so it still loads via the package.
import "@fontsource-variable/geist-mono";
import { App } from "./app/App";
import "./styles/global.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
