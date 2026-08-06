import React from "react";
import ReactDOM from "react-dom/client";
import "streamdown/styles.css";
import App from "./App";
import Demo from "./demo/Demo";

// Renders the component gallery instead of the app — see src/demo. Three ways
// in, because the Tauri window can't carry a query string: `devUrl` is a fixed
// origin and a production build loads index.html off disk. The hash works
// anywhere, and the localStorage flag survives a restart.
const demo =
  new URLSearchParams(location.search).has("demo") ||
  location.hash === "#demo" ||
  localStorage.getItem("ade.demo") === "1";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>{demo ? <Demo /> : <App />}</React.StrictMode>,
);
