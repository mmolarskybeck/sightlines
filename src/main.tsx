import React from "react";
import ReactDOM from "react-dom/client";
import "@fontsource-variable/figtree";
import "@fontsource-variable/geist";
import { App } from "./app/App";
import "./styles/global.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
