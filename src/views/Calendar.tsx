import { motion } from "framer-motion";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Icon } from "../components/Icon";
import { useDataChanged } from "../lib/hooks";
import { call } from "../lib/ipc";
import { useUI } from "../lib/store";
import type { Status, Task } from "../lib/types";
import { PRIORITY, addDays, dayKey, parseDayKey, weekStart } from "../lib/util";
import { TaskRow } from "./Today";

const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const CHIPS = 3;

export function Calendar() {
  const setDay = useUI((s) => s.setDay);
  const go = useUI((s) => s.go);
  const projects = useUI((s) => s.projects);
  const todayKey = dayKey(new Date());
  const [month, setMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [selected, setSelected] = useState(todayKey);
  const [tasks, setTasks] = useState<Task[]>([]);

  const gridStart = useMemo(() => weekStart(month), [month]);
  const cells = useMemo(() => Array.from({ length: 42 }, (_, i) => addDays(gridStart, i)), [gridStart]);

  const load = useCallback(async () => {
    setTasks(await call<Task[]>("list_upcoming", { from: dayKey(gridStart), days: 42 }));
  }, [gridStart]);

  useEffect(() => {
    void load();
  }, [load]);
  useDataChanged(["tasks"], () => void load());

  const byDay = useMemo(() => {
    const m = new Map<string, Task[]>();
    for (const t of tasks) {
      if (!t.due_at) continue;
      const k = dayKey(new Date(t.due_at));
      m.set(k, [...(m.get(k) ?? []), t]);
    }
    return m;
  }, [tasks]);

  const shift = (n: number) => setMonth((m) => new Date(m.getFullYear(), m.getMonth() + n, 1));
  const toggle = (t: Task) => {
    const status: Status = t.status === "done" ? "todo" : "done";
    setTasks((cur) => cur.map((x) => (x.id === t.id ? { ...x, status } : x)));
    void call("set_task_status", { id: t.id, status });
  };

  const chosen = byDay.get(selected) ?? [];
  const title = month.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  const chosenLabel = parseDayKey(selected).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });
  const color = (t: Task) => projects.find((p) => p.id === t.project_id)?.color ?? PRIORITY[t.priority].dot;

  return (
    <>
      <section className="cal-head">
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <span className="mono-label">Month view</span>
          <h1 className="h1">{title}</h1>
        </div>
        <div className="cal-nav">
          <button type="button" className="icon-btn" aria-label="Previous month" onClick={() => shift(-1)}>
            <Icon name="arrowLeft" size={16} />
          </button>
          <button
            type="button"
            className="cal-today"
            onClick={() => {
              setMonth(new Date(new Date().getFullYear(), new Date().getMonth(), 1));
              setSelected(todayKey);
            }}
          >
            Today
          </button>
          <button type="button" className="icon-btn" aria-label="Next month" onClick={() => shift(1)}>
            <Icon name="arrowRight" size={16} />
          </button>
        </div>
      </section>

      <section className="glass cal-card" aria-label={title}>
        <div className="cal-dow">
          {DOW.map((d) => (
            <span key={d}>{d}</span>
          ))}
        </div>
        <motion.div key={dayKey(month)} className="cal-grid" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.22 }}>
          {cells.map((d) => {
            const k = dayKey(d);
            const items = byDay.get(k) ?? [];
            const out = d.getMonth() !== month.getMonth();
            return (
              <button
                key={k}
                type="button"
                className={`cal-cell${out ? " is-out" : ""}${k === selected ? " is-sel" : ""}${k === todayKey ? " is-today" : ""}`}
                aria-pressed={k === selected}
                aria-label={`${d.toDateString()}, ${items.length} tasks`}
                onClick={() => setSelected(k)}
                onDoubleClick={() => (setDay(k), go("today"))}
              >
                <span className="cal-num">{d.getDate()}</span>
                <span className="cal-chips">
                  {items.slice(0, CHIPS).map((t) => (
                    <span key={t.id} className={`cal-chip${t.status === "done" ? " is-done" : ""}`}>
                      <span className="dot" aria-hidden="true" style={{ background: color(t) }} />
                      <span className="cal-chip-t">{t.title}</span>
                    </span>
                  ))}
                  {items.length > CHIPS && <span className="cal-more">+{items.length - CHIPS} more</span>}
                </span>
              </button>
            );
          })}
        </motion.div>
      </section>

      <section style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <div className="cal-day-head">
          <span className="mono-label" style={{ padding: "0 4px" }}>
            {selected === todayKey ? "Today, " : ""}
            {chosenLabel}
          </span>
          <button type="button" className="cal-open" onClick={() => (setDay(selected), go("today"))}>
            Open in Today
            <Icon name="arrowRight" size={13} sw={2} />
          </button>
        </div>
        {chosen.map((t, i) => (
          <TaskRow key={t.id} task={t} onToggle={toggle} index={i} />
        ))}
        {chosen.length === 0 && <p className="empty">Nothing scheduled for this day.</p>}
      </section>
    </>
  );
}
