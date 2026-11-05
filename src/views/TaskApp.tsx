import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Blobs } from "../components/Blobs";
import { Icon } from "../components/Icon";
import { Markdown } from "../components/Markdown";
import { WindowControls } from "../components/TopBar";
import { applyFormat, type FormatKind } from "../lib/format";
import { useDataChanged, useNow, useOutside } from "../lib/hooks";
import { call, errorCode, errorMessage, win } from "../lib/ipc";
import { applyAppearance, useUI } from "../lib/store";
import type { Comment, Priority, Status, Task, TaskPatch } from "../lib/types";
import {
  PRIORITY,
  STATUS_DOT,
  dayKey,
  dueLabel,
  fmtElapsed,
  fmtTarget,
  fmtTargetShort,
  localIso,
  parseClock,
  toggleCheckbox,
  wordCount,
  clock,
} from "../lib/util";

const TOOLS: { kind: FormatKind; label: string; icon?: string }[] = [
  { kind: "heading", label: "Heading" },
  { kind: "bold", label: "Bold", icon: "bold" },
  { kind: "italic", label: "Italic", icon: "italic" },
  { kind: "code", label: "Inline code", icon: "code" },
  { kind: "codeblock", label: "Code block", icon: "codeblock" },
  { kind: "bullets", label: "Bulleted list", icon: "bullets" },
  { kind: "checklist", label: "Checklist", icon: "checklist" },
  { kind: "link", label: "Insert link", icon: "link" },
];

const REMIND = [null, 5, 15, 30, 60];

type Pop = null | "priority" | "due" | "target" | "tags" | "property";

function Popover({ onClose, children, width = 220 }: { onClose: () => void; children: React.ReactNode; width?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  useOutside(ref, onClose);
  return (
    <div ref={ref} className="popover" style={{ left: 0, top: 42, width, padding: 8 }}>
      {children}
    </div>
  );
}

function Properties({ task, patch }: { task: Task; patch: (p: TaskPatch) => void }) {
  const [pop, setPop] = useState<Pop>(null);
  const [allTags, setAllTags] = useState<string[]>([]);
  const [newTag, setNewTag] = useState("");
  const close = () => setPop(null);
  const pr = PRIORITY[task.priority];
  const toggle = (p: Pop) => setPop((cur) => (cur === p ? null : p));
  const dueDay = task.due_at ? dayKey(new Date(task.due_at)) : dayKey(new Date());
  const dueTime = task.due_at ? clock(task.due_at) : "";

  useEffect(() => {
    if (pop === "tags") void call<string[]>("list_tags").then(setAllTags);
  }, [pop]);

  const setTags = (tags: string[]) => patch({ tags });
  const tagChoices = Array.from(new Set([...allTags, ...task.tags]));

  return (
    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
      <div style={{ position: "relative" }}>
        <button type="button" className="glass-pill prop-btn" aria-haspopup="dialog" onClick={() => toggle("priority")}>
          <span className="k">Priority</span>
          <span className="dot" aria-hidden="true" style={{ background: pr.dot }} />
          <span style={{ color: pr.text, fontWeight: 600 }}>{pr.label === "Medium" ? "Med" : pr.label}</span>
        </button>
        {pop === "priority" && (
          <Popover onClose={close} width={180}>
            {(["high", "med", "low"] as Priority[]).map((p) => (
              <button key={p} type="button" className="popover-item" onClick={() => (patch({ priority: p }), close())}>
                <span className="dot" aria-hidden="true" style={{ background: PRIORITY[p].dot }} />
                {PRIORITY[p].label}
              </button>
            ))}
          </Popover>
        )}
      </div>

      <div style={{ position: "relative" }}>
        <button type="button" className="glass-pill prop-btn" aria-haspopup="dialog" onClick={() => toggle("due")}>
          <span className="k">Due</span>
          {dueLabel(task.due_at)}
        </button>
        {pop === "due" && (
          <Popover onClose={close} width={250}>
            <div className="pop-form">
              <label className="mono-label" htmlFor="due-day">
                Date
              </label>
              <input id="due-day" type="date" className="input-sm" value={dueDay} onChange={(e) => e.target.value && patch({ due_at: localIso(e.target.value, parseClock(dueTime)) })} />
              <label className="mono-label" htmlFor="due-time">
                Time
              </label>
              <input
                id="due-time"
                type="text"
                className="input-sm"
                placeholder="HH:MM"
                defaultValue={dueTime}
                onBlur={(e) => {
                  const c = parseClock(e.target.value);
                  patch({ due_at: localIso(dueDay, e.target.value.trim() === "" ? null : c) });
                }}
                onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
              />
              <button type="button" className="popover-item" onClick={() => (patch({ due_at: null }), close())}>
                Clear date
              </button>
            </div>
          </Popover>
        )}
      </div>

      <div style={{ position: "relative" }}>
        <button type="button" className="glass-pill prop-btn" aria-haspopup="dialog" onClick={() => toggle("target")}>
          <span className="k">Target</span>
          {task.target_minutes ? fmtTarget(task.target_minutes) : "Not set"}
        </button>
        {pop === "target" && (
          <Popover onClose={close} width={240}>
            <div className="pop-form">
              <label className="mono-label" htmlFor="target-min">
                Minutes
              </label>
              <input
                id="target-min"
                type="number"
                min={1}
                className="input-sm"
                defaultValue={task.target_minutes ?? ""}
                onBlur={(e) => {
                  const v = parseInt(e.target.value, 10);
                  patch({ target_minutes: Number.isFinite(v) && v > 0 ? v : null });
                }}
                onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
              />
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {[30, 60, 120, 240].map((m) => (
                  <button key={m} type="button" className="pill" style={{ minHeight: 32 }} onClick={() => (patch({ target_minutes: m }), close())}>
                    {fmtTargetShort(m)}
                  </button>
                ))}
              </div>
              <button type="button" className="popover-item" onClick={() => (patch({ target_minutes: null }), close())}>
                Clear target
              </button>
            </div>
          </Popover>
        )}
      </div>

      <div style={{ position: "relative" }}>
        <button type="button" className="glass-pill prop-btn" aria-haspopup="dialog" onClick={() => toggle("tags")}>
          <span className="k">Tags</span>
          {task.tags.length ? task.tags.map((t) => `#${t}`).join(" ") : "None"}
        </button>
        {pop === "tags" && (
          <Popover onClose={close} width={260}>
            <div className="pop-form">
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {tagChoices.map((t) => (
                  <button key={t} type="button" className={`pill${task.tags.includes(t) ? " is-on" : ""}`} style={{ minHeight: 32 }} aria-pressed={task.tags.includes(t)} onClick={() => setTags(task.tags.includes(t) ? task.tags.filter((x) => x !== t) : [...task.tags, t])}>
                    #{t}
                  </button>
                ))}
              </div>
              <input
                className="input-sm"
                placeholder="New tag, press Enter"
                value={newTag}
                onChange={(e) => setNewTag(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    const t = newTag.trim().replace(/^#/, "").toLowerCase();
                    if (t && !task.tags.includes(t)) setTags([...task.tags, t]);
                    setNewTag("");
                  }
                }}
              />
            </div>
          </Popover>
        )}
      </div>

      {task.remind_before_min !== null && (
        <button type="button" className="glass-pill prop-btn" onClick={() => toggle("property")}>
          <span className="k">Remind</span>
          {task.remind_before_min === 0 ? "At due time" : `${task.remind_before_min}m before`}
        </button>
      )}

      <div style={{ position: "relative" }}>
        <button type="button" className="pill-dashed" style={{ borderRadius: 999 }} aria-haspopup="dialog" onClick={() => toggle("property")}>
          <Icon name="plus" size={13} sw={2} />
          Property
        </button>
        {pop === "property" && (
          <Popover onClose={close} width={220}>
            <span className="mono-label" style={{ padding: "6px 10px 4px" }}>
              Remind me
            </span>
            {REMIND.map((m) => (
              <button key={String(m)} type="button" className="popover-item" aria-pressed={task.remind_before_min === m} style={task.remind_before_min === m ? { background: "rgba(22,22,29,0.06)" } : undefined} onClick={() => (patch({ remind_before_min: m }), close())}>
                {m === null ? "No reminder" : `${m} minutes before`}
              </button>
            ))}
          </Popover>
        )}
      </div>
    </div>
  );
}

function Editor({ task, save }: { task: Task; save: (p: TaskPatch) => void }) {
  const openSettingsHint = useUI((s) => s.settings);
  void openSettingsHint;
  const [tab, setTab] = useState<"write" | "preview">("preview");
  const [md, setMd] = useState(task.description_md);
  const [dirty, setDirty] = useState(false);
  const [ai, setAi] = useState<{ busy: boolean; result: string | null; error: string }>({ busy: false, result: null, error: "" });
  const area = useRef<HTMLTextAreaElement>(null);
  const timer = useRef<number>();
  const latest = useRef(md);
  const pending = useRef(false);

  const flush = useCallback(() => {
    window.clearTimeout(timer.current);
    if (!pending.current) return;
    pending.current = false;
    save({ description_md: latest.current });
    setDirty(false);
  }, [save]);

  const change = (value: string, immediate = false) => {
    setMd(value);
    latest.current = value;
    pending.current = true;
    setDirty(true);
    window.clearTimeout(timer.current);
    if (immediate) flush();
    else timer.current = window.setTimeout(flush, 500);
  };

  useEffect(() => {
    if (!pending.current) {
      setMd(task.description_md);
      latest.current = task.description_md;
    }
  }, [task.description_md]);

  useEffect(
    () => () => {
      flush();
    },
    [flush],
  );

  const format = (kind: FormatKind) => {
    if (tab !== "write") setTab("write");
    requestAnimationFrame(() => {
      const ta = area.current;
      if (!ta) return;
      const r = applyFormat(kind, ta.value, ta.selectionStart, ta.selectionEnd);
      change(r.text);
      requestAnimationFrame(() => {
        ta.focus();
        ta.setSelectionRange(r.start, r.end);
      });
    });
  };

  const improve = async () => {
    setAi({ busy: true, result: null, error: "" });
    try {
      const out = await call<string>("ai_improve_markdown", { md, requestId: crypto.randomUUID() });
      setAi({ busy: false, result: out, error: "" });
    } catch (e) {
      setAi({ busy: false, result: null, error: errorCode(e) === "missing_key" ? "Add an API key in Settings, AI assistant first." : errorMessage(e) });
    }
  };

  return (
    <div className="task-editor">
      <div className="te-bar">
        <div role="group" aria-label="Editor mode" className="seg" style={{ borderRadius: 10 }}>
          {(["write", "preview"] as const).map((t) => (
            <button key={t} type="button" className={`seg-btn${tab === t ? " is-on" : ""}`} style={{ minHeight: 32, padding: "0 12px" }} aria-pressed={tab === t} onClick={() => setTab(t)}>
              {t === "write" ? "Write" : "Preview"}
            </button>
          ))}
        </div>
        <div role="toolbar" aria-label="Markdown formatting" style={{ display: "flex", flexWrap: "wrap", gap: 2 }}>
          <button type="button" className="improve-btn" disabled={ai.busy || !md.trim()} onClick={() => void improve()}>
            <Icon name="sparkles" size={15} />
            {ai.busy ? "Improving..." : "Improve with AI"}
          </button>
          {TOOLS.map((t) => (
            <button key={t.kind} type="button" className="te-tool" aria-label={t.label} onMouseDown={(e) => e.preventDefault()} onClick={() => format(t.kind)}>
              {t.icon ? <Icon name={t.icon} size={16} /> : <span style={{ fontSize: 14, fontWeight: 700 }}>H</span>}
            </button>
          ))}
        </div>
      </div>

      {ai.error && (
        <div className="error-banner" style={{ margin: "12px 14px 0" }}>
          {ai.error}
        </div>
      )}
      {ai.result !== null && (
        <div className="ai-review" style={{ margin: "12px 14px 0" }}>
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
                  change(ai.result ?? "", true);
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

      {tab === "write" ? (
        <textarea ref={area} className="te-write" aria-label="Description markdown" value={md} placeholder="Describe the task. Markdown is supported." onChange={(e) => change(e.target.value)} />
      ) : (
        <div className="te-preview">
          {md.trim() ? <Markdown md={md} onToggleCheck={(i) => change(toggleCheckbox(md, i), true)} /> : <p style={{ fontSize: 14, color: "var(--muted)" }}>No description yet. Switch to Write to add one.</p>}
        </div>
      )}

      <div className="te-foot">
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <Icon name="markdown" size={14} />
          Markdown supported{dirty ? " · saving" : ""}
        </span>
        <span>{wordCount(md)} words</span>
      </div>
    </div>
  );
}

function CommentItem({ c, onSaved }: { c: Comment; onSaved: () => void }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(c.body_md);
  const submit = async () => {
    const body = text.trim();
    if (!body) return;
    await call("update_comment", { id: c.id, bodyMd: body });
    setEditing(false);
    onSaved();
  };
  return (
    <div style={{ display: "flex", gap: 12 }}>
      <div aria-hidden="true" className="avatar">
        Y
      </div>
      <div className="bubble">
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 13, fontWeight: 600 }}>You</span>
          <span style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--muted)" }}>{dueLabel(c.created_at)}</span>
          <span className="bubble-actions">
            <button type="button" aria-label="Edit comment" onClick={() => setEditing(true)}>
              <Icon name="pencil" size={13} />
            </button>
            <button type="button" aria-label="Delete comment" onClick={() => void call("delete_comment", { id: c.id })}>
              <Icon name="trash" size={13} />
            </button>
          </span>
        </div>
        {editing ? (
          <>
            <textarea
              className="comment-edit"
              rows={3}
              autoFocus
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && e.ctrlKey) void submit();
                if (e.key === "Escape") setEditing(false);
              }}
            />
            <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
              <button type="button" className="ai-discard" onClick={() => setEditing(false)}>
                Cancel
              </button>
              <button type="button" className="ai-accept" onClick={() => void submit()}>
                Save
              </button>
            </div>
          </>
        ) : (
          <Markdown md={c.body_md} className="md-comment" />
        )}
      </div>
    </div>
  );
}

export default function TaskApp({ id, onClose }: { id: string; onClose?: () => void }) {
  const embedded = !!onClose;
  const closeSelf = () => (onClose ? onClose() : void win.close());
  const settings = useUI((s) => s.settings);
  const projects = useUI((s) => s.projects);
  const [task, setTask] = useState<Task | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [draft, setDraft] = useState("");
  const [title, setTitle] = useState("");
  const titleFocus = useRef(false);
  const running = !!task?.timer_started_at;
  const now = useNow(1000, running);

  const load = useCallback(async () => {
    try {
      const t = await call<Task>("get_task", { id });
      setTask(t);
      if (!titleFocus.current) setTitle(t.title);
      setComments(await call<Comment[]>("list_comments", { taskId: id }));
    } catch (e) {
      if (errorCode(e) === "not_found") closeSelf();
    }
  }, [id]);

  useEffect(() => {
    const ui = useUI.getState();
    void ui.loadSettings();
    void ui.loadProjects();
    void load();
  }, [load]);
  useEffect(() => applyAppearance(settings), [settings]);
  useDataChanged(["tasks", "comments"], () => void load());
  useDataChanged(["settings"], () => void useUI.getState().loadSettings());
  useDataChanged(["projects"], () => void useUI.getState().loadProjects());

  const patch = useCallback(
    (p: TaskPatch) => {
      setTask((t) => (t ? { ...t, ...p } as Task : t));
      void call("update_task", { id, patch: p });
    },
    [id],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== "Space" || e.ctrlKey || e.metaKey || e.altKey) return;
      const el = e.target as HTMLElement;
      if (el.closest?.("input, textarea, select, button, [contenteditable='true']")) return;
      e.preventDefault();
      setTask((t) => {
        if (t) void call(t.timer_started_at ? "timer_pause" : "timer_start", { id: t.id });
        return t;
      });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!onClose) return;
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !document.querySelector(".popover")) onClose();
    };
    window.addEventListener("keydown", onEsc);
    return () => window.removeEventListener("keydown", onEsc);
  }, [onClose]);

  const elapsed = useMemo(() => {
    if (!task) return 0;
    const extra = task.timer_started_at ? Math.max(0, Math.floor((now - Date.parse(task.timer_started_at)) / 1000)) : 0;
    return task.tracked_seconds + extra;
  }, [task, now]);

  if (!task) {
    return embedded ? null : (
      <div className="app">
        <Blobs variant="task" />
      </div>
    );
  }

  const done = task.status === "done";
  const target = task.target_minutes ? task.target_minutes * 60 : 0;
  const left = target - elapsed;
  const pct = target ? Math.min(100, Math.round((elapsed / target) * 100)) : 0;
  const over = target > 0 && left <= 0;
  const barColor = over ? "#EA580C" : "var(--accent)";
  const project = projects.find((p) => p.id === task.project_id);

  const send = async () => {
    const body = draft.trim();
    if (!body) return;
    setDraft("");
    await call("add_comment", { taskId: id, bodyMd: body });
  };

  const body = (
      <div className="page">
        <header className="glass task-bar" data-tauri-drag-region>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }} data-tauri-drag-region>
            <button type="button" className="back-btn" onClick={() => (embedded ? closeSelf() : void call("focus_main_window"))}>
              <Icon name="arrowLeft" size={15} sw={2} />
              {embedded ? "Back" : "Today"}
            </button>
            <span style={{ fontFamily: "var(--mono)", fontSize: 12, color: "var(--muted)" }} data-tauri-drag-region>
              TASK-{task.seq}
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }} data-tauri-drag-region>
            <div className="timer-pill">
              <span aria-hidden="true" className="dot" style={{ background: barColor }} />
              <span style={{ fontFamily: "var(--mono)", fontSize: 13 }}>{fmtElapsed(elapsed)}</span>
              <button type="button" aria-label={running ? "Pause" : "Start focus"} onClick={() => void call(running ? "timer_pause" : "timer_start", { id })}>
                <Icon name={running ? "pause" : "play"} size={13} />
              </button>
            </div>
            <button type="button" className="mark-done" onClick={() => void call("set_task_status", { id, status: (done ? "progress" : "done") as Status })}>
              <Icon name="check" size={15} sw={2.4} />
              {done ? "Reopen" : "Mark done"}
            </button>
            <div className="divider-v" aria-hidden="true" data-tauri-drag-region />
            {embedded ? (
              <button type="button" className="win-btn" aria-label="Close" onClick={closeSelf}>
                <Icon name="close" size={14} />
              </button>
            ) : (
              <WindowControls />
            )}
          </div>
        </header>

        <section aria-labelledby="task-title" style={{ display: "flex", flexDirection: "column", gap: 18, padding: "0 4px" }}>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
            <div className="select-wrap">
              <span aria-hidden="true" className="sel-dot sq-lg" style={{ background: project?.color ?? "#9CA3AF" }} />
              <label htmlFor="tw-project" className="sr">
                Project
              </label>
              <select id="tw-project" className="glass-pill sel-pill" value={task.project_id ?? ""} onChange={(e) => patch({ project_id: e.target.value || null })}>
                <option value="">No project</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <Icon name="chevron" size={13} className="chev" />
            </div>
            <div className="select-wrap">
              <span aria-hidden="true" className="sel-dot" style={{ background: STATUS_DOT[task.status] }} />
              <label htmlFor="tw-status" className="sr">
                Status
              </label>
              <select
                id="tw-status"
                className="glass-pill sel-pill"
                value={task.status}
                onChange={(e) => void call("set_task_status", { id, status: e.target.value })}
              >
                <option value="todo">To do</option>
                <option value="progress">In progress</option>
                <option value="done">Done</option>
              </select>
              <Icon name="chevron" size={13} className="chev" />
            </div>
          </div>
          <input
            id="task-title"
            className="task-title-input"
            style={done ? { textDecoration: "line-through", color: "var(--faint)" } : undefined}
            value={title}
            aria-label="Task title"
            onFocus={() => (titleFocus.current = true)}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => {
              titleFocus.current = false;
              const t = title.trim();
              if (t && t !== task.title) patch({ title: t });
              else setTitle(task.title);
            }}
            onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
          />
          <Properties task={task} patch={patch} />
        </section>

        <div className="two-col">
          <div style={{ flex: "999 1 660px", minWidth: 0 }}>
            <Editor key={task.id} task={task} save={patch} />
          </div>
          <aside style={{ flex: "1 1 360px", minWidth: 0, display: "flex", flexDirection: "column", gap: 20 }}>
            <section aria-labelledby="target-h" className="glass side-box" style={{ gap: 12 }}>
              <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10 }}>
                <h2 id="target-h" style={{ fontSize: 15, fontWeight: 600 }}>
                  Time target
                </h2>
                <span style={{ fontFamily: "var(--mono)", fontSize: 12, color: "var(--muted)" }}>{target ? `${pct}% of ${fmtTargetShort(task.target_minutes ?? 0)}` : "Not set"}</span>
              </div>
              <div aria-hidden="true" className="bar-track">
                <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, borderRadius: 999, transition: "width 0.4s ease", background: barColor, width: `${pct}%` }} />
              </div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                <span style={{ fontSize: 13, color: "var(--text-3b)" }}>
                  {!target ? "No target set" : left > 0 ? `${fmtElapsed(left)} left of your ${fmtTargetShort(task.target_minutes ?? 0)} target` : `${fmtElapsed(-left)} over target`}
                </span>
                <button type="button" className="reset-btn" onClick={() => void call("timer_reset", { id })}>
                  Reset
                </button>
              </div>
            </section>

            <section aria-labelledby="comments-h" className="glass side-box" style={{ gap: 16, padding: 22 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <h2 id="comments-h" style={{ fontSize: 15, fontWeight: 600 }}>
                  Comments
                </h2>
                <span className="count-pill">{comments.length}</span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                {comments.map((c) => (
                  <CommentItem key={c.id + c.updated_at} c={c} onSaved={() => void load()} />
                ))}
              </div>
              <div className="composer">
                <label htmlFor="comment-box" className="sr">
                  Write a comment
                </label>
                <textarea
                  id="comment-box"
                  rows={3}
                  value={draft}
                  placeholder={"Write a comment... **bold**, `code` and lists work"}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && e.ctrlKey) {
                      e.preventDefault();
                      void send();
                    }
                  }}
                />
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "8px 8px 8px 16px" }}>
                  <span style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--muted)" }}>Markdown · Ctrl {"↵"} to send</span>
                  <button type="button" className="send-btn" onClick={() => void send()}>
                    Comment
                    <Icon name="arrowRight" size={14} sw={2} />
                  </button>
                </div>
              </div>
            </section>
          </aside>
        </div>
      </div>
  );

  if (embedded) return body;
  return (
    <div className="app">
      <Blobs variant="task" />
      {body}
    </div>
  );
}
