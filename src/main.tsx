import React from "react";
import ReactDOM from "react-dom/client";
// Figtree and Geist use stable /fonts/ URLs for preloading; non-critical Geist
// Mono can keep its hashed package URL.
import "@fontsource-variable/geist-mono";
import { App } from "./app/App";
import "./styles/global.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
