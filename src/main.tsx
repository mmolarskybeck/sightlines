import React from "react";
import ReactDOM from "react-dom/client";
// Figtree and Geist use stable /fonts/ URLs for preloading; non-critical Geist
// Mono can keep its hashed package URL.
import "@fontsource-variable/geist-mono";
import { App } from "./app/App";
import { startCloudflareWebAnalytics } from "./app/telemetry/cloudflareWebAnalytics";
import { startAppOpenedTelemetry } from "./app/telemetry/appOpenedTelemetry";
import "./styles/global.css";

startCloudflareWebAnalytics();
startAppOpenedTelemetry();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
