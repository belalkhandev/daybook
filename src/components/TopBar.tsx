import { motion } from "framer-motion";
import { useEffect, useState } from "react";
import { spring } from "../lib/motion";
import { win } from "../lib/ipc";
import { useUI, type View } from "../lib/store";
import { Icon } from "./Icon";

const ITEMS: { view: View; label: string }[] = [
  { view: "today", label: "Today" },
  { view: "upcoming", label: "Upcoming" },
  { view: "notes", label: "Notes" },
  { view: "shots", label: "Shots" },
  { view: "calendar", label: "Calendar" },
];

export function WindowControls() {
  const [max, setMax] = useState(false);
  useEffect(() => {
    const sync = () => void win.isMaximized().then(setMax);
    sync();
    return win.onResized(sync);
  }, []);
  return (
    <>
      <button type="button" className="win-btn" aria-label="Minimize window" onClick={() => void win.minimize()}>
        <Icon name="minimize" size={14} />
      </button>
      <button type="button" className="win-btn" aria-label={max ? "Restore window" : "Maximize window"} onClick={() => void win.toggleMaximize()}>
        <Icon name={max ? "restore" : "maximize"} size={14} />
      </button>
      <button type="button" className="win-btn" aria-label="Close window" onClick={() => void win.close()}>
        <Icon name="close" size={14} />
      </button>
    </>
  );
}

export function TopBar() {
  const view = useUI((s) => s.view);
  const go = useUI((s) => s.go);
  const setModal = useUI((s) => s.setModal);
  const openSettings = useUI((s) => s.openSettings);
  const closeSettings = useUI((s) => s.closeSettings);
  const inSettings = view === "settings";

  return (
    <header className="topbar glass" data-tauri-drag-region>
      <div className="brand" data-tauri-drag-region>
        <div className="brand-mark" aria-hidden="true" data-tauri-drag-region />
        <span className="brand-name" data-tauri-drag-region>
          Daybook
        </span>
      </div>
      <nav className="nav" aria-label="Views">
        {ITEMS.map((i) => (
          <button
            key={i.view}
            type="button"
            className={`nav-item${view === i.view ? " is-active" : ""}`}
            aria-current={view === i.view ? "page" : undefined}
            onClick={() => go(i.view)}
          >
            {view === i.view && <motion.span layoutId="nav-pill" className="nav-pill" transition={spring} />}
            <span className="nav-label">{i.label}</span>
          </button>
        ))}
      </nav>
      <div className="bar-right" data-tauri-drag-region>
        {!inSettings && (
          <>
            <button type="button" className="btn-search" onClick={() => setModal({ type: "search" })}>
              <Icon name="search" />
              Search
              <kbd className="kbd">Ctrl K</kbd>
            </button>
            <motion.button whileTap={{ scale: 0.94 }} whileHover={{ scale: 1.04 }} type="button" className="btn-new" onClick={() => setModal({ type: "quick", kind: "task" })}>
              <Icon name="plus" />
              New
            </motion.button>
          </>
        )}
        <button
          type="button"
          className={`icon-btn${inSettings ? " is-active" : ""}`}
          aria-label="Settings"
          aria-current={inSettings ? "page" : undefined}
          onClick={() => (inSettings ? closeSettings() : openSettings())}
        >
          <Icon name="gear" size={17} />
        </button>
        <div className="divider-v" aria-hidden="true" data-tauri-drag-region />
        <WindowControls />
      </div>
    </header>
  );
}
