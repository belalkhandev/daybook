import "@fontsource/geist/400.css";
import "@fontsource/geist/500.css";
import "@fontsource/geist/600.css";
import "@fontsource/geist/700.css";
import "@fontsource/geist-mono/400.css";
import "@fontsource/geist-mono/500.css";
import "./styles/tokens.css";
import "./styles/global.css";
import "./styles/markdown.css";
import "./styles/today.css";
import "./styles/notes.css";
import "./styles/modals.css";
import "./styles/settings.css";
import "./styles/task.css";
import "./styles/shots.css";
import "./styles/capture.css";
import "./styles/calendar.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import TaskApp from "./views/TaskApp";
import { CaptureOverlay } from "./views/CaptureOverlay";
import { CaptureToast } from "./views/CaptureToast";
import { ShotEditor } from "./views/ShotEditor";

const params = new URLSearchParams(window.location.search);
const view = params.get("view");
const id = params.get("id") ?? "";

function Root() {
  if (view === "task" && id) return <TaskApp id={id} />;
  if (view === "shot" && id) return <ShotEditor id={id} />;
  if (view === "capture") return <CaptureOverlay index={Number(params.get("m") ?? 0)} />;
  if (view === "toast" && id) return <CaptureToast id={id} copied={params.get("copied") === "1"} />;
  return <App />;
}

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
