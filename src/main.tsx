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
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import TaskApp from "./views/TaskApp";

const params = new URLSearchParams(window.location.search);
const taskId = params.get("view") === "task" ? params.get("id") : null;

createRoot(document.getElementById("root") as HTMLElement).render(<StrictMode>{taskId ? <TaskApp id={taskId} /> : <App />}</StrictMode>);
