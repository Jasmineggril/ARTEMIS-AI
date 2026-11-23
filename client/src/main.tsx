import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

// After a new deploy, a tab that was already open may ask for JS chunks that no
// longer exist. Vite fires this event when a dynamic import fails: reload once
// to fetch the new version (guarded so it can never loop).
window.addEventListener("vite:preloadError", (event) => {
  try {
    const last = Number(sessionStorage.getItem("ceres-chunk-reload-at") || 0);
    if (Date.now() - last < 10_000) return;
    sessionStorage.setItem("ceres-chunk-reload-at", String(Date.now()));
  } catch {
    return;
  }
  event.preventDefault();
  window.location.reload();
});

createRoot(document.getElementById("root")!).render(<App />);
