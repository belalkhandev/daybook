import { useEffect, useState } from "react";
import { Blobs } from "./components/Blobs";
import { TopBar } from "./components/TopBar";
import { onDataChanged } from "./lib/ipc";
import { applyAppearance, useUI } from "./lib/store";
import { AiModal } from "./views/AiModal";
import { ComingSoon } from "./views/ComingSoon";
import { Notes } from "./views/Notes";
import { QuickAddModal } from "./views/QuickAddModal";
import { SearchModal } from "./views/SearchModal";
import { SettingsView } from "./views/SettingsView";
import { Today } from "./views/Today";

export default function App() {
  const view = useUI((s) => s.view);
  const modal = useUI((s) => s.modal);
  const settings = useUI((s) => s.settings);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const ui = useUI.getState();
    void Promise.all([ui.loadSettings(), ui.loadProjects()]).then(() => setLoaded(true));
    return onDataChanged((kind) => {
      const s = useUI.getState();
      s.touch();
      if (kind === "settings") void s.loadSettings();
      if (kind === "projects") void s.loadProjects();
    });
  }, []);

  useEffect(() => applyAppearance(settings), [settings]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      const s = useUI.getState();
      const k = e.key.toLowerCase();
      if (k === "k") {
        e.preventDefault();
        s.setModal({ type: "search" });
      } else if (k === "n" && e.shiftKey) {
        e.preventDefault();
        s.setModal({ type: "ai", kind: "task" });
      } else if (k === "n") {
        e.preventDefault();
        s.setModal({ type: "quick", kind: "task" });
      } else if (["1", "2", "3", "4"].includes(k)) {
        e.preventDefault();
        s.go((["today", "upcoming", "notes", "calendar"] as const)[Number(k) - 1]);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const blobs = view === "notes" ? "notes" : view === "settings" ? "settings" : "today";

  return (
    <div className="app">
      <Blobs variant={blobs} />
      <div className="page">
        <TopBar />
        {loaded && view === "today" && <Today />}
        {loaded && view === "notes" && <Notes />}
        {view === "upcoming" && <ComingSoon title="Upcoming" />}
        {view === "calendar" && <ComingSoon title="Calendar" />}
        {loaded && view === "settings" && <SettingsView />}
      </div>
      {modal?.type === "quick" && <QuickAddModal key={modal.kind} initial={modal.kind} />}
      {modal?.type === "ai" && <AiModal key={modal.kind} initial={modal.kind} />}
      {modal?.type === "search" && <SearchModal />}
    </div>
  );
}
