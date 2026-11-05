import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState } from "react";
import { Modal } from "./components/Modal";
import TaskApp from "./views/TaskApp";
import { Blobs } from "./components/Blobs";
import { TopBar } from "./components/TopBar";
import { call, onDataChanged, onEvent } from "./lib/ipc";
import type { View } from "./lib/store";
import { applyAppearance, useUI } from "./lib/store";
import { AiModal } from "./views/AiModal";
import { ComingSoon } from "./views/ComingSoon";
import { Notes } from "./views/Notes";
import { Shots } from "./views/Shots";
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
    const offView = onEvent<string>("go-view", (v) => useUI.getState().go(v as View));
    const offAttach = onEvent<string>("shot-attach", (id) => {
      const s = useUI.getState();
      s.selectShot(id);
      s.requestAttach(id);
      s.go("shots");
    });
    return () => {
      offView();
      offAttach();
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "PrintScreen") {
        e.preventDefault();
        void call("start_capture", { mode: e.shiftKey ? "window" : e.ctrlKey ? "screen" : "area" }).catch(() => undefined);
        return;
      }
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
      } else if (["1", "2", "3", "4", "5"].includes(k)) {
        e.preventDefault();
        s.go((["today", "upcoming", "notes", "shots", "calendar"] as const)[Number(k) - 1]);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const blobs = view === "notes" ? "notes" : view === "settings" ? "settings" : view === "shots" ? "shots" : "today";

  return (
    <div className="app">
      <Blobs variant={blobs} />
      <div className="page">
        <TopBar />
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={view}
            className="view-slot"
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
          >
            {loaded && view === "today" && <Today />}
            {loaded && view === "notes" && <Notes />}
            {loaded && view === "shots" && <Shots />}
            {view === "upcoming" && <ComingSoon title="Upcoming" />}
            {view === "calendar" && <ComingSoon title="Calendar" />}
            {loaded && view === "settings" && <SettingsView />}
          </motion.div>
        </AnimatePresence>
      </div>
      <AnimatePresence>
        {modal?.type === "quick" && <QuickAddModal key={"q" + modal.kind} initial={modal.kind} />}
        {modal?.type === "ai" && <AiModal key={"a" + modal.kind} initial={modal.kind} />}
        {modal?.type === "search" && <SearchModal key="search" />}
        {modal?.type === "task" && (
          <Modal key={"t" + modal.id} onClose={() => useUI.getState().setModal(null)} top={24} maxWidth={1180} labelledBy="task-title">
            <TaskApp id={modal.id} onClose={() => useUI.getState().setModal(null)} />
          </Modal>
        )}
      </AnimatePresence>
    </div>
  );
}
