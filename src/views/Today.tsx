import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "../components/Icon";
import { useDataChanged, useNow, useOutside } from "../lib/hooks";
import { call, errorMessage } from "../lib/ipc";
import { motion } from "framer-motion";
import { reveal } from "../lib/motion";
import { useUI } from "../lib/store";
import type { DayCount, Note, QuickAddResult, Status, Task } from "../lib/types";
import {
  NOTE_DOT,
  PRIORITY,
  addDays,
  dayKey,
  edited,
  excerpt,
  greeting,
  longDate,
  parseDayKey,
  partOfDay,
  timeLabel,
  weekStart,
  type Part,
} from "../lib/util";

type Filter = "all" | "open" | "done";

function TaskMenu({ task, onClose }: { task: Task; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useOutside(ref, onClose);
  const run = (fn: () => Promise<unknown>) => {
    onClose();
    void fn();
  };
  return (
    <div ref={ref} className="popover" style={{ right: 0, top: 36 }} role="menu">
      <button type="button" className="popover-item" role="menuitem" onClick={() => run(() => Promise.resolve(useUI.getState().setModal({ type: "task", id: task.id })))}>
        Edit
      </button>
      <button type="button" className="popover-item" role="menuitem" onClick={() => run(() => call("move_task_to_tomorrow", { id: task.id }))}>
        Move to tomorrow
      </button>
      <button type="button" className="popover-item is-danger" role="menuitem" onClick={() => run(() => call("delete_task", { id: task.id }))}>
        Delete
      </button>
    </div>
  );
}

function TaskRow({ task, onToggle, index }: { task: Task; onToggle: (t: Task) => void; index: number }) {
  const [menu, setMenu] = useState(false);
  const done = task.status === "done";
  const pr = PRIORITY[task.priority];
  return (
    <motion.div className="row-card task-row" {...reveal(index)}>
      <button
        type="button"
        className={`check task-check${done ? " is-on" : ""}`}
        aria-label={(done ? "Mark as not done: " : "Mark as done: ") + task.title}
        onClick={() => onToggle(task)}
      >
        {done && <Icon name="check" size={16} />}
      </button>
      <div className="task-main">
        <a
          href="#"
          className={`task-title${done ? " is-done" : ""}`}
          onClick={(e) => {
            e.preventDefault();
            useUI.getState().setModal({ type: "task", id: task.id });
          }}
        >
          {task.title}
        </a>
        <div className="task-meta">
          <span className="task-time">
            <Icon name="clock" size={13} />
            {timeLabel(task.due_at)}
          </span>
          {task.project && (
            <span className="task-project">
              <span className="sq" aria-hidden="true" style={{ background: task.project.color }} />
              {task.project.name}
            </span>
          )}
          {task.tags[0] && <span>#{task.tags[0]}</span>}
        </div>
      </div>
      <span className="task-pr" style={{ background: pr.bg, color: pr.text }}>
        {pr.short}
      </span>
      <div style={{ position: "relative", flex: "none" }}>
        <button type="button" className="task-more" aria-label="More options" aria-haspopup="menu" onClick={() => setMenu((m) => !m)}>
          <Icon name="more" size={16} />
        </button>
        {menu && <TaskMenu task={task} onClose={() => setMenu(false)} />}
      </div>
    </motion.div>
  );
}

function WeekStrip({ counts }: { counts: DayCount[] }) {
  const day = useUI((s) => s.day);
  const setDay = useUI((s) => s.setDay);
  const todayKey = dayKey(new Date());
  const start = weekStart(new Date());
  const has = new Map(counts.map((c) => [c.day, c.count > 0]));
  return (
    <div role="group" aria-label="This week" className="glass weekstrip">
      {Array.from({ length: 7 }, (_, i) => {
        const d = addDays(start, i);
        const key = dayKey(d);
        const on = key === day;
        return (
          <button
            key={key}
            type="button"
            className={`day${on ? " is-on" : ""}${key === todayKey && !on ? " is-today" : ""}`}
            aria-current={key === todayKey ? "date" : undefined}
            aria-pressed={on}
            onClick={() => setDay(key)}
          >
            <span className="day-name">{d.toLocaleDateString("en-GB", { weekday: "short" }).toUpperCase()}</span>
            <span className="day-num">{d.getDate()}</span>
            <span aria-hidden="true" className="day-dot" style={{ background: has.get(key) ? (on ? "#fff" : "var(--accent)") : "transparent" }} />
          </button>
        );
      })}
    </div>
  );
}

export function Today() {
  const day = useUI((s) => s.day);
  const lastSaved = useUI((s) => s.lastSaved);
  const go = useUI((s) => s.go);
  const selectNote = useUI((s) => s.selectNote);
  const setModal = useUI((s) => s.setModal);
  const now = useNow(30000);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [counts, setCounts] = useState<DayCount[]>([]);
  const [pinned, setPinned] = useState<Note[]>([]);
  const [filter, setFilter] = useState<Filter>("all");
  const [quickType, setQuickType] = useState<"task" | "note">("task");
  const [quickText, setQuickText] = useState("");
  const [quickError, setQuickError] = useState("");

  const load = useCallback(async () => {
    const start = dayKey(weekStart(new Date()));
    const [t, c, p] = await Promise.all([
      call<Task[]>("list_tasks", { day }),
      call<DayCount[]>("list_week_counts", { weekStart: start }),
      call<Note[]>("list_notes", { filter: "pinned", query: "" }),
    ]);
    setTasks(t);
    setCounts(c);
    setPinned(p);
  }, [day]);

  useEffect(() => {
    void load();
  }, [load]);
  useDataChanged(["tasks", "notes"], () => void load());

  const toggle = (t: Task) => {
    const status: Status = t.status === "done" ? "todo" : "done";
    setTasks((cur) => cur.map((x) => (x.id === t.id ? { ...x, status } : x)));
    void call("set_task_status", { id: t.id, status });
  };

  const submit = async () => {
    const text = quickText.trim();
    if (!text) return;
    try {
      setQuickError("");
      const r = await call<QuickAddResult>("create_from_quick_add", { text, kind: quickType, day });
      setQuickText("");
      if (r.kind === "note") selectNote(r.id);
    } catch (e) {
      setQuickError(errorMessage(e));
    }
  };

  const total = tasks.length;
  const doneCount = tasks.filter((t) => t.status === "done").length;
  const circ = 2 * Math.PI * 52;
  const pct = total ? Math.round((doneCount / total) * 100) : 0;
  const next = tasks.find((t) => t.status !== "done");
  const visible = useMemo(
    () => tasks.filter((t) => filter === "all" || (filter === "open" ? t.status !== "done" : t.status === "done")),
    [tasks, filter],
  );
  const groups = (["Morning", "Afternoon", "Evening"] as Part[])
    .map((name) => ({ name, items: visible.filter((t) => partOfDay(t.due_at) === name) }))
    .filter((g) => g.items.length > 0);
  const nowDate = new Date(now);
  const savedAt = `${String(lastSaved.getHours()).padStart(2, "0")}:${String(lastSaved.getMinutes()).padStart(2, "0")}`;
  const viewingDay = parseDayKey(day);

  return (
    <>
      <section className="today-head">
        <div className="today-head-text">
          <span className="eyebrow">{longDate(nowDate)}</span>
          <h1 className="h1">{greeting(nowDate)}</h1>
          <p className="lede">
            {total - doneCount} tasks open · {doneCount} done · {pinned.length} pinned notes
          </p>
        </div>
        <WeekStrip counts={counts} />
      </section>

      <div className="glass quickbar">
        <Icon name="plus" size={20} sw={2} />
        <label htmlFor="quick-add" className="sr">
          Quick add
        </label>
        <input
          id="quick-add"
          className="quick-input"
          type="text"
          value={quickText}
          placeholder={
            quickType === "task"
              ? "Add a task for today, try “Call Rafi at 4pm #work !high”"
              : "Jot a quick note, title on the first line"
          }
          onChange={(e) => setQuickText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.ctrlKey && !e.shiftKey) {
              e.preventDefault();
              void submit();
            }
          }}
        />
        <div role="group" aria-label="Item type" className="seg">
          {(["task", "note"] as const).map((k) => (
            <button key={k} type="button" className={`seg-btn${quickType === k ? " is-on" : ""}`} aria-pressed={quickType === k} onClick={() => setQuickType(k)}>
              {k === "task" ? "Task" : "Note"}
            </button>
          ))}
        </div>
        <button type="button" className="quick-add-btn" onClick={() => void submit()}>
          Add
          <kbd className="kbd-dark">{"↵"}</kbd>
        </button>
      </div>
      {quickError && <div className="error-banner">{quickError}</div>}

      <div className="two-col">
        <section aria-labelledby="today-h" className="glass card today-list">
          <div className="card-head">
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <h2 id="today-h" className="card-title">
                {dayKey(viewingDay) === dayKey(nowDate) ? "Today’s tasks" : `Tasks for ${viewingDay.toLocaleDateString("en-GB", { weekday: "long" })}`}
              </h2>
              <span className="count-pill">{total}</span>
            </div>
            <div role="group" aria-label="Filter tasks" style={{ display: "flex", gap: 6 }}>
              {(["all", "open", "done"] as Filter[]).map((f) => (
                <button key={f} type="button" className={`chip${filter === f ? " is-on" : ""}`} aria-pressed={filter === f} onClick={() => setFilter(f)}>
                  {f === "all" ? "All" : f === "open" ? "Open" : "Done"}
                </button>
              ))}
            </div>
          </div>
          {groups.map((g) => (
            <div key={g.name} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <span className="mono-label" style={{ padding: "0 4px" }}>
                {g.name}
              </span>
              {g.items.map((t, i) => (
                <TaskRow key={t.id} task={t} onToggle={toggle} index={i} />
              ))}
            </div>
          ))}
          {groups.length === 0 && <p className="empty">Nothing here yet. Switch the filter or add a task above.</p>}
        </section>

        <aside className="side-col">
          <section aria-labelledby="prog-h" className="glass card side-card" style={{ gap: 18 }}>
            <h2 id="prog-h" className="side-title">
              Daily progress
            </h2>
            <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
              <div style={{ position: "relative", flex: "none", width: 120, height: 120 }}>
                <svg viewBox="0 0 120 120" width="120" height="120" aria-hidden="true">
                  <circle cx="60" cy="60" r="52" style={{ fill: "none", stroke: "rgba(22,22,29,0.08)", strokeWidth: 10 }} />
                  <circle
                    cx="60"
                    cy="60"
                    r="52"
                    transform="rotate(-90 60 60)"
                    style={{
                      fill: "none",
                      stroke: "var(--accent)",
                      strokeWidth: 10,
                      strokeLinecap: "round",
                      strokeDasharray: `${((circ * doneCount) / (total || 1)).toFixed(1)} ${circ.toFixed(1)}`,
                      transition: "stroke-dasharray 0.4s ease",
                    }}
                  />
                </svg>
                <div className="ring-center">
                  <span className="ring-pct">{pct}%</span>
                  <span className="ring-sub">done</span>
                </div>
              </div>
              <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 6 }}>
                <span style={{ fontSize: 14, color: "var(--text-3b)" }}>
                  {doneCount} of {total} tasks finished
                </span>
                <span className="mono-label" style={{ marginTop: 10 }}>
                  Up next
                </span>
                <span style={{ fontSize: 15, fontWeight: 600, lineHeight: 1.3 }}>{next ? next.title : "All done for today"}</span>
                <span style={{ fontFamily: "var(--mono)", fontSize: 12, color: "var(--muted)" }}>{next ? timeLabel(next.due_at) : "-"}</span>
              </div>
            </div>
          </section>

          <section aria-labelledby="notes-h" className="glass card side-card" style={{ gap: 12 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
              <h2 id="notes-h" className="side-title">
                Pinned notes
              </h2>
              <a
                href="#"
                className="all-notes"
                onClick={(e) => {
                  e.preventDefault();
                  go("notes");
                }}
              >
                All notes
                <Icon name="arrowRight" size={14} sw={2} />
              </a>
            </div>
            {pinned.slice(0, 3).map((n) => (
              <a
                key={n.id}
                href="#"
                className="row-card pinned-note"
                onClick={(e) => {
                  e.preventDefault();
                  selectNote(n.id);
                  go("notes");
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span className="dot" aria-hidden="true" style={{ background: NOTE_DOT[n.color] }} />
                  <span style={{ fontSize: 14, fontWeight: 600 }}>{n.title}</span>
                </div>
                <span className="pinned-excerpt">{excerpt(n.body_md)}</span>
                <span className="pinned-edited">{edited(n.updated_at)}</span>
              </a>
            ))}
            <button type="button" className="new-note-dashed" onClick={() => setModal({ type: "quick", kind: "note" })}>
              <Icon name="plus" size={15} sw={2} />
              New note
            </button>
          </section>
        </aside>
      </div>

      <footer className="foot">
        <span>Stored locally · ~/.local/share/daybook</span>
        <span>Last saved {savedAt}</span>
      </footer>
    </>
  );
}
