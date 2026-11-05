import { useEffect, useState } from "react";
import { Icon } from "../components/Icon";
import { Modal } from "../components/Modal";
import { call } from "../lib/ipc";
import { useUI } from "../lib/store";
import type { Note, Task } from "../lib/types";
import { NOTE_DOT, dueLabel } from "../lib/util";

interface Hit {
  key: string;
  label: string;
  meta: string;
  dot: string;
  open: () => void;
}

export function SearchModal() {
  const setModal = useUI((s) => s.setModal);
  const go = useUI((s) => s.go);
  const selectNote = useUI((s) => s.selectNote);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [sel, setSel] = useState(0);

  useEffect(() => {
    const text = q.trim();
    if (!text) {
      setHits([]);
      return;
    }
    let alive = true;
    const t = setTimeout(async () => {
      const [tasks, notes] = await Promise.all([
        call<Task[]>("search_tasks", { queryText: text }),
        call<Note[]>("list_notes", { filter: "all", query: text }),
      ]);
      if (!alive) return;
      const th: Hit[] = tasks.map((x) => ({
        key: `t${x.id}`,
        label: x.title,
        meta: `Task · ${dueLabel(x.due_at)}`,
        dot: x.project?.color ?? "#9CA3AF",
        open: () => {
          setModal(null);
          void call("open_task_window", { id: x.id });
        },
      }));
      const nh: Hit[] = notes.slice(0, 10).map((n) => ({
        key: `n${n.id}`,
        label: n.title,
        meta: "Note",
        dot: NOTE_DOT[n.color],
        open: () => {
          selectNote(n.id);
          go("notes");
        },
      }));
      setHits([...th, ...nh]);
      setSel(0);
    }, 120);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [q, go, selectNote, setModal]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      setModal(null);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setSel((s) => Math.min(hits.length - 1, s + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSel((s) => Math.max(0, s - 1));
    } else if (e.key === "Enter" && hits[sel]) {
      e.preventDefault();
      hits[sel].open();
    }
  };

  return (
    <Modal onClose={() => setModal(null)} top={96} maxWidth={680} labelledBy="search-title" onKeyDown={onKeyDown}>
      <h2 id="search-title" className="sr">
        Search tasks and notes
      </h2>
      <div style={{ display: "flex", alignItems: "center", paddingLeft: 24, color: "var(--muted)" }}>
        <Icon name="search" size={18} />
        <input className="search-input" autoFocus placeholder="Search tasks and notes" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {q.trim() && (
        <div style={{ borderTop: "1px solid rgba(22,22,29,0.07)", padding: "8px 0", borderRadius: "0 0 28px 28px" }}>
          {hits.length === 0 && <p className="empty">No results.</p>}
          {hits.map((h, i) => (
            <button key={h.key} type="button" className={`search-row${i === sel ? " is-sel" : ""}`} onClick={h.open} onMouseEnter={() => setSel(i)}>
              <span className="dot" aria-hidden="true" style={{ background: h.dot }} />
              <span style={{ flex: 1, minWidth: 0, fontWeight: 500 }}>{h.label}</span>
              <span style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--muted)" }}>{h.meta}</span>
            </button>
          ))}
        </div>
      )}
    </Modal>
  );
}
