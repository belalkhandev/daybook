import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "../components/Icon";
import { Modal } from "../components/Modal";
import { Switch } from "../components/Switch";
import { call, errorMessage } from "../lib/ipc";
import { useUI } from "../lib/store";
import type { Folder, ItemKind, Note, NoteColor, Priority, Task } from "../lib/types";
import { FOLDER_LABEL, NOTE_PICK, PRIORITY, addDays, dayKey, localIso, parseClock } from "../lib/util";

type Due = "today" | "tomorrow" | "pick";

const DUES: { key: Due; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "tomorrow", label: "Tomorrow" },
  { key: "pick", label: "Pick a date" },
];

const PRIOS: Priority[] = ["low", "med", "high"];
const FOLDERS: Folder[] = ["ideas", "work", "personal"];

function defaultTime(): string {
  const d = new Date();
  d.setHours(d.getHours() + 1, 0, 0, 0);
  return `${String(d.getHours()).padStart(2, "0")}:00`;
}

export function QuickAddModal({ initial }: { initial: ItemKind }) {
  const setModal = useUI((s) => s.setModal);
  const projects = useUI((s) => s.projects);
  const day = useUI((s) => s.day);
  const selectNote = useUI((s) => s.selectNote);
  const [kind, setKind] = useState<ItemKind>(initial);
  const [name, setName] = useState("");
  const [body, setBody] = useState("");
  const [due, setDue] = useState<Due>("today");
  const [pickedDay, setPickedDay] = useState(day);
  const [time, setTime] = useState(defaultTime);
  const [prio, setPrio] = useState<Priority>("med");
  const [projectId, setProjectId] = useState("");
  const [tagList, setTagList] = useState<string[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [newTag, setNewTag] = useState<string | null>(null);
  const [remind, setRemind] = useState(true);
  const [color, setColor] = useState<NoteColor>("violet");
  const [folder, setFolder] = useState<Folder>("ideas");
  const [pin, setPin] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const isTask = kind === "task";

  useEffect(() => {
    void call<string[]>("list_tags").then(setTagList);
  }, []);
  useEffect(() => {
    if (!projectId && projects[0]) setProjectId(projects[0].id);
  }, [projects, projectId]);
  useEffect(() => nameRef.current?.focus(), [kind]);

  const project = projects.find((p) => p.id === projectId);
  const close = () => setModal(null);
  const allTags = useMemo(() => Array.from(new Set([...tagList, ...tags])), [tagList, tags]);

  const save = async () => {
    const title = name.trim();
    if (!title) {
      setError(isTask ? "Give the task a title first." : "Give the note a title first.");
      nameRef.current?.focus();
      return;
    }
    setBusy(true);
    try {
      if (isTask) {
        const base = due === "today" ? dayKey(new Date()) : due === "tomorrow" ? dayKey(addDays(new Date(), 1)) : pickedDay;
        const clock = parseClock(time);
        await call<Task>("create_task", {
          input: {
            title,
            description_md: body,
            priority: prio,
            project_id: projectId || null,
            due_at: localIso(base, clock),
            remind_before_min: remind && clock ? 15 : null,
            tags,
          },
        });
      } else {
        const n = await call<Note>("create_note", { input: { title, body_md: body, folder, color, pinned: pin } });
        selectNote(n.id);
      }
      close();
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "Enter" && e.ctrlKey) {
      e.preventDefault();
      void save();
    } else if (e.key === "Tab" && !e.shiftKey && document.activeElement === nameRef.current) {
      e.preventDefault();
      setKind(isTask ? "note" : "task");
    }
  };

  const toggleTag = (t: string) => setTags((cur) => (cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t]));

  return (
    <Modal onClose={close} top={96} maxWidth={680} labelledBy="qa-title" onKeyDown={onKeyDown}>
      <div className="qa-top">
        <h2 id="qa-title" className="sr">
          Quick add
        </h2>
        <div role="group" aria-label="Item type" className="seg seg-lg">
          {(["task", "note"] as const).map((k) => (
            <button key={k} type="button" className={`seg-btn${kind === k ? " is-on" : ""}`} aria-pressed={kind === k} onClick={() => setKind(k)}>
              {k === "task" ? "Task" : "Note"}
            </button>
          ))}
        </div>
        <button type="button" className="close-btn" aria-label="Close" onClick={close}>
          <Icon name="close" size={16} />
        </button>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 6, padding: "18px 24px 4px" }}>
        <label htmlFor="qa-name" className="mono-label">
          {isTask ? "New task" : "New note"}
        </label>
        <input
          id="qa-name"
          ref={nameRef}
          className="qa-name"
          type="text"
          value={name}
          placeholder={isTask ? "What needs doing?" : "Note title"}
          onChange={(e) => {
            setName(e.target.value);
            setError("");
          }}
        />
        <label htmlFor="qa-body" className="sr">
          Details
        </label>
        <textarea
          id="qa-body"
          className="qa-body"
          rows={isTask ? 2 : 6}
          value={body}
          placeholder={isTask ? "Add details (optional)" : "Start writing... type - [ ] for a checklist"}
          onChange={(e) => setBody(e.target.value)}
        />
      </div>

      <div aria-hidden="true" style={{ height: 1, margin: "12px 24px 0", background: "rgba(22,22,29,0.08)" }} />

      {isTask ? (
        <div className="qa-fields">
          <div className="field-row">
            <span className="field-label">Due</span>
            <div role="group" aria-label="Due date" style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {DUES.map((d) => (
                <button key={d.key} type="button" className={`pill${due === d.key ? " is-on" : ""}`} aria-pressed={due === d.key} onClick={() => setDue(d.key)}>
                  {d.label}
                </button>
              ))}
            </div>
            {due === "pick" && <input type="date" className="input-sm" aria-label="Date" value={pickedDay} onChange={(e) => e.target.value && setPickedDay(e.target.value)} />}
            <label className="time-field">
              <Icon name="clock" size={14} sw={2} />
              <span className="sr">Time</span>
              <input type="text" value={time} placeholder="HH:MM" onChange={(e) => setTime(e.target.value)} />
            </label>
          </div>
          <div className="field-row">
            <span className="field-label">Priority</span>
            <div role="group" aria-label="Priority" style={{ display: "flex", gap: 6 }}>
              {PRIOS.map((p) => (
                <button key={p} type="button" className={`pill${prio === p ? " is-on" : ""}`} aria-pressed={prio === p} onClick={() => setPrio(p)}>
                  <span className="dot" aria-hidden="true" style={{ background: PRIORITY[p].dot }} />
                  {PRIORITY[p].label}
                </button>
              ))}
            </div>
          </div>
          <div className="field-row">
            <label htmlFor="qa-project" className="field-label">
              Project
            </label>
            <div className="select-wrap">
              <span aria-hidden="true" className="proj-sq" style={{ background: project?.color ?? "#9CA3AF" }} />
              <select id="qa-project" className="proj-select" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
                <option value="">No project</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <Icon name="chevron" size={14} className="chev" />
            </div>
          </div>
          <div className="field-row">
            <span className="field-label">Tag</span>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {allTags.map((t) => (
                <button key={t} type="button" className={`pill${tags.includes(t) ? " is-on" : ""}`} aria-pressed={tags.includes(t)} onClick={() => toggleTag(t)}>
                  #{t}
                </button>
              ))}
              {newTag === null ? (
                <button type="button" className="pill-dashed" onClick={() => setNewTag("")}>
                  <Icon name="plus" size={13} sw={2} />
                  New tag
                </button>
              ) : (
                <input
                  className="input-sm"
                  autoFocus
                  aria-label="New tag"
                  placeholder="tag name"
                  style={{ width: 120 }}
                  value={newTag}
                  onChange={(e) => setNewTag(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      e.stopPropagation();
                      const t = newTag.trim().replace(/^#/, "").toLowerCase();
                      if (t && !tags.includes(t)) setTags([...tags, t]);
                      setNewTag(null);
                    }
                  }}
                  onBlur={() => setNewTag(null)}
                />
              )}
            </div>
          </div>
          <div className="toggle-row">
            <span id="remind-label">Remind me 15 minutes before</span>
            <Switch on={remind} onChange={setRemind} labelledBy="remind-label" />
          </div>
        </div>
      ) : (
        <div className="qa-fields">
          <div className="field-row">
            <span className="field-label">Color</span>
            <div role="group" aria-label="Note color" style={{ display: "flex", gap: 8 }}>
              {NOTE_PICK.map((c) => (
                <button
                  key={c.key}
                  type="button"
                  aria-label={c.name}
                  aria-pressed={color === c.key}
                  className="swatch"
                  style={{ background: c.hex, boxShadow: color === c.key ? "0 0 0 2px #16161D" : "0 0 0 1px rgba(22,22,29,0.12)" }}
                  onClick={() => setColor(c.key)}
                />
              ))}
            </div>
          </div>
          <div className="field-row">
            <span className="field-label">Folder</span>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {FOLDERS.map((f) => (
                <button key={f} type="button" className={`pill${folder === f ? " is-on" : ""}`} aria-pressed={folder === f} onClick={() => setFolder(f)}>
                  {FOLDER_LABEL[f]}
                </button>
              ))}
            </div>
          </div>
          <div className="toggle-row">
            <span id="pin-label">Pin to Today</span>
            <Switch on={pin} onChange={setPin} labelledBy="pin-label" />
          </div>
        </div>
      )}

      {error && (
        <div className="error-banner" style={{ margin: "0 24px 16px" }}>
          {error}
        </div>
      )}

      <div className="modal-foot">
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 14, fontSize: 12, color: "var(--muted)" }}>
          <span className="hint">
            <kbd className="kbd" style={{ color: "var(--text-3)" }}>
              Ctrl {"↵"}
            </kbd>
            Save
          </span>
          <span className="hint">
            <kbd className="kbd" style={{ color: "var(--text-3)" }}>
              Tab
            </kbd>
            Switch type
          </span>
          <span className="hint">
            <kbd className="kbd" style={{ color: "var(--text-3)" }}>
              Esc
            </kbd>
            Close
          </span>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button type="button" className="btn-tint" onClick={() => setModal({ type: "ai", kind })}>
            <Icon name="sparkles" size={16} />
            Write with AI
          </button>
          <button type="button" className="btn-ghost" onClick={close}>
            Cancel
          </button>
          <button type="button" className="btn-primary" disabled={busy} onClick={() => void save()}>
            {isTask ? "Add task" : "Save note"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
