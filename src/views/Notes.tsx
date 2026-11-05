import { motion } from "framer-motion";
import { reveal } from "../lib/motion";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "../components/Icon";
import { Markdown } from "../components/Markdown";
import { useDataChanged } from "../lib/hooks";
import { applyFormat, type FormatKind } from "../lib/format";
import { call, errorCode, errorMessage } from "../lib/ipc";
import { useUI } from "../lib/store";
import type { Note, NoteCounts, NotePatch } from "../lib/types";
import { FOLDER_LABEL, NOTE_DOT, edited, excerpt, hasOpenItems, toggleCheckbox } from "../lib/util";

type Filter = "all" | "pinned" | "work" | "personal" | "ideas";

const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "pinned", label: "Pinned" },
  { key: "work", label: "Work" },
  { key: "personal", label: "Personal" },
  { key: "ideas", label: "Ideas" },
];

const TOOLS: { kind: FormatKind; label: string; icon: string }[] = [
  { kind: "bold", label: "Bold", icon: "bold" },
  { kind: "italic", label: "Italic", icon: "italic" },
  { kind: "checklist", label: "Checklist", icon: "checklist" },
  { kind: "bullets", label: "Bulleted list", icon: "bullets" },
  { kind: "link", label: "Insert link", icon: "link" },
];

function Editor({ note }: { note: Note }) {
  const go = useUI((s) => s.go);
  const openSettings = useUI((s) => s.openSettings);
  const [title, setTitle] = useState(note.title);
  const [body, setBody] = useState(note.body_md);
  const [editing, setEditing] = useState(note.body_md === "");
  const [saving, setSaving] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [ai, setAi] = useState<{ busy: boolean; result: string | null; error: string }>({ busy: false, result: null, error: "" });
  const area = useRef<HTMLTextAreaElement>(null);
  const pending = useRef<{ id: string; patch: NotePatch } | null>(null);
  const timer = useRef<number>();
  const formatNext = useRef<FormatKind | null>(null);
  const noteId = note.id;

  const flush = useCallback(async () => {
    window.clearTimeout(timer.current);
    const p = pending.current;
    if (!p) return;
    pending.current = null;
    await call("update_note", { id: p.id, patch: p.patch });
    if (!pending.current) setSaving(false);
  }, []);

  const schedule = useCallback(
    (patch: NotePatch, immediate = false) => {
      pending.current = { id: noteId, patch: { ...(pending.current?.patch ?? {}), ...patch } };
      setSaving(true);
      window.clearTimeout(timer.current);
      if (immediate) void flush();
      else timer.current = window.setTimeout(() => void flush(), 500);
    },
    [noteId, flush],
  );

  useEffect(() => {
    setTitle(note.title);
    setBody(note.body_md);
    setEditing(note.body_md === "");
    setConfirm(false);
    setAi({ busy: false, result: null, error: "" });
    return () => {
      void flush();
    };
  }, [noteId]);

  useEffect(() => {
    if (!pending.current) {
      setTitle(note.title);
      setBody(note.body_md);
    }
  }, [note.updated_at, note.title, note.body_md]);

  useEffect(() => {
    if (!confirm) return;
    const t = setTimeout(() => setConfirm(false), 3000);
    return () => clearTimeout(t);
  }, [confirm]);

  useEffect(() => {
    if (editing && formatNext.current && area.current) {
      const kind = formatNext.current;
      formatNext.current = null;
      runFormat(kind);
    }
  });

  const onBody = (value: string) => {
    setBody(value);
    schedule({ body_md: value });
  };

  const runFormat = (kind: FormatKind) => {
    const ta = area.current;
    if (!ta) return;
    const r = applyFormat(kind, ta.value, ta.selectionStart, ta.selectionEnd);
    onBody(r.text);
    requestAnimationFrame(() => {
      ta.focus();
      ta.setSelectionRange(r.start, r.end);
    });
  };

  const tool = (kind: FormatKind) => {
    if (!editing) {
      formatNext.current = kind;
      setEditing(true);
    } else runFormat(kind);
  };

  const improve = async () => {
    setAi({ busy: true, result: null, error: "" });
    try {
      const md = await call<string>("ai_improve_markdown", { md: body, requestId: crypto.randomUUID() });
      setAi({ busy: false, result: md, error: "" });
    } catch (e) {
      if (errorCode(e) === "missing_key") {
        openSettings("ai");
        return;
      }
      setAi({ busy: false, result: null, error: errorMessage(e) });
    }
  };

  const remove = async () => {
    if (!confirm) {
      setConfirm(true);
      return;
    }
    pending.current = null;
    window.clearTimeout(timer.current);
    await call("delete_note", { id: noteId });
  };

  const addToToday = async () => {
    await flush();
    await call("note_open_items_to_today", { id: noteId });
    go("today");
  };

  return (
    <article aria-labelledby="editor-title" className="glass-strong note-editor">
      <div className="ed-top">
        <div role="toolbar" aria-label="Formatting" className="ed-tools">
          {TOOLS.map((t) => (
            <button key={t.kind} type="button" className="ed-tool" aria-label={t.label} onMouseDown={(e) => e.preventDefault()} onClick={() => tool(t.kind)}>
              <Icon name={t.icon} size={16} />
            </button>
          ))}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <button type="button" className="ai-tint-btn" disabled={ai.busy || !body.trim()} onClick={() => void improve()}>
            <Icon name="sparkles" size={15} />
            {ai.busy ? "Formatting..." : "Format with AI"}
          </button>
          <span className="saved">
            <span className="dot" aria-hidden="true" style={{ width: 6, height: 6, background: saving ? "var(--st-progress)" : "var(--st-done)" }} />
            {saving ? "Saving" : "Saved"}
          </span>
          <button
            type="button"
            className={`ed-square${note.pinned ? " is-active" : ""}`}
            aria-label={note.pinned ? "Unpin note" : "Pin note"}
            aria-pressed={note.pinned}
            onClick={() => void call("update_note", { id: noteId, patch: { pinned: !note.pinned } })}
          >
            <Icon name="pin" />
          </button>
          <button
            type="button"
            className={`ed-square${confirm ? " is-danger" : ""}`}
            aria-label={confirm ? "Confirm delete note" : "Delete note"}
            onClick={() => void remove()}
          >
            <Icon name="trash" />
          </button>
        </div>
      </div>

      {ai.error && <div className="error-banner">{ai.error}</div>}
      {ai.result !== null && (
        <div className="ai-review">
          <div className="ai-review-head">
            <span className="ai-badge">
              <Icon name="sparkles" size={13} sw={2} />
              AI version
            </span>
            <div style={{ display: "flex", gap: 6 }}>
              <button type="button" className="ai-discard" onClick={() => setAi({ busy: false, result: null, error: "" })}>
                Discard
              </button>
              <button
                type="button"
                className="ai-accept"
                onClick={() => {
                  onBody(ai.result ?? "");
                  setAi({ busy: false, result: null, error: "" });
                }}
              >
                Accept
              </button>
            </div>
          </div>
          <div className="ai-review-body">
            <Markdown md={ai.result} className="md-compact" />
          </div>
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, fontSize: 12, color: "var(--text-3b)" }}>
          <span className="note-tag">
            <span className="dot" aria-hidden="true" style={{ background: NOTE_DOT[note.color] }} />
            {FOLDER_LABEL[note.folder]}
          </span>
          <span style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--muted)" }}>{edited(note.updated_at)}</span>
        </div>
        <label htmlFor="editor-title" className="sr">
          Note title
        </label>
        <input
          id="editor-title"
          className="note-title-input"
          value={title}
          placeholder="Note title"
          onChange={(e) => {
            setTitle(e.target.value);
            schedule({ title: e.target.value });
          }}
        />
      </div>
      <div aria-hidden="true" style={{ height: 1, background: "rgba(22,22,29,0.08)" }} />

      {editing ? (
        <textarea
          ref={area}
          className="note-body-input"
          value={body}
          autoFocus
          placeholder="Start writing... type - [ ] for a checklist"
          onChange={(e) => onBody(e.target.value)}
          onBlur={() => body.trim() && setEditing(false)}
        />
      ) : (
        <div className="note-body-view" onClick={() => setEditing(true)} role="textbox" aria-label="Note body, click to edit" tabIndex={0} onKeyDown={(e) => e.key === "Enter" && setEditing(true)}>
          <Markdown
            md={body}
            onToggleCheck={(i) => {
              const next = toggleCheckbox(body, i);
              setBody(next);
              schedule({ body_md: next }, true);
            }}
          />
        </div>
      )}

      {hasOpenItems(body) && (
        <div className="add-today">
          <span style={{ fontSize: 13, color: "var(--text-3b)" }}>Send the open items in this note to Today</span>
          <button type="button" className="add-today-btn" onClick={() => void addToToday()}>
            Add to today
            <Icon name="arrowRight" size={14} sw={2} />
          </button>
        </div>
      )}
    </article>
  );
}

export function Notes() {
  const selectedId = useUI((s) => s.selectedNoteId);
  const selectNote = useUI((s) => s.selectNote);
  const setModal = useUI((s) => s.setModal);
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [notes, setNotes] = useState<Note[]>([]);
  const [counts, setCounts] = useState<NoteCounts>({ all: 0, pinned: 0, work: 0, personal: 0, ideas: 0 });

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query), 150);
    return () => clearTimeout(t);
  }, [query]);

  const load = useCallback(async () => {
    const [n, c] = await Promise.all([
      call<Note[]>("list_notes", { filter, query: debounced }),
      call<NoteCounts>("note_counts"),
    ]);
    setNotes(n);
    setCounts(c);
  }, [filter, debounced]);

  useEffect(() => {
    void load();
  }, [load]);
  useDataChanged(["notes"], () => void load());

  const sel = useMemo(() => notes.find((n) => n.id === selectedId) ?? notes[0] ?? null, [notes, selectedId]);

  return (
    <>
      <section style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", justifyContent: "space-between", gap: 20 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <span className="eyebrow">
            {counts.all} notes · {counts.pinned} pinned
          </span>
          <h1 className="h1">Notes</h1>
        </div>
        <div className="glass notes-search">
          <Icon name="search" size={16} />
          <label htmlFor="note-search" className="sr">
            Search notes
          </label>
          <input id="note-search" type="search" placeholder="Search notes" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
      </section>

      <div role="group" aria-label="Filter notes" style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {FILTERS.map((f) => (
          <button key={f.key} type="button" className={`note-chip chip-blur${filter === f.key ? " is-on" : ""}`} aria-pressed={filter === f.key} onClick={() => setFilter(f.key)}>
            {f.label}
            <span style={{ fontFamily: "var(--mono)", fontSize: 11, opacity: 0.8 }}>{counts[f.key]}</span>
          </button>
        ))}
      </div>

      <div className="two-col">
        <div className="notes-grid">
          <button type="button" className="new-note-card" onClick={() => setModal({ type: "quick", kind: "note" })}>
            <span className="new-note-plus" aria-hidden="true">
              <Icon name="plus" size={20} sw={2} />
            </span>
            New note
          </button>
          {notes.map((n, idx) => {
            const on = sel?.id === n.id;
            return (
              <motion.button {...reveal(idx)} whileTap={{ scale: 0.98 }} key={n.id} type="button" className={`glass note-card${on ? " is-on" : ""}`} aria-pressed={on} onClick={() => selectNote(n.id)}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 12, fontWeight: 500, color: "var(--text-3b)" }}>
                    <span className="dot" aria-hidden="true" style={{ background: NOTE_DOT[n.color] }} />
                    {FOLDER_LABEL[n.folder]}
                  </span>
                  {n.pinned && <Icon name="pin" size={15} label="Pinned" />}
                </div>
                <span className="note-card-title">{n.title}</span>
                <span className="note-card-excerpt">{excerpt(n.body_md)}</span>
                <span style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--faint)" }}>{edited(n.updated_at)}</span>
              </motion.button>
            );
          })}
        </div>
        {sel ? (
          <Editor key={sel.id} note={sel} />
        ) : (
          <article className="glass-strong note-editor" style={{ alignItems: "center", justifyContent: "center", minHeight: 260 }}>
            <p style={{ fontSize: 14, color: "var(--muted)" }}>{query ? "No notes match your search." : "No notes yet. Create one to get started."}</p>
          </article>
        )}
      </div>
    </>
  );
}
