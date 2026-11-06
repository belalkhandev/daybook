import { useCallback, useEffect, useState } from "react";
import { useDataChanged } from "../lib/hooks";
import { call } from "../lib/ipc";
import { useUI } from "../lib/store";
import type { Status, Task } from "../lib/types";
import { addDays, dayKey, parseDayKey } from "../lib/util";
import { TaskRow } from "./Today";

const DAYS = 14;

function label(key: string, today: string): string {
  const d = parseDayKey(key);
  const text = d.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "short" });
  if (key === today) return `Today, ${text}`;
  if (key === dayKey(addDays(parseDayKey(today), 1))) return `Tomorrow, ${text}`;
  return text;
}

export function Upcoming() {
  const setDay = useUI((s) => s.setDay);
  const go = useUI((s) => s.go);
  const [tasks, setTasks] = useState<Task[]>([]);
  const today = dayKey(new Date());

  const load = useCallback(async () => {
    setTasks(await call<Task[]>("list_upcoming", { from: today, days: DAYS }));
  }, [today]);

  useEffect(() => {
    void load();
  }, [load]);
  useDataChanged(["tasks"], () => void load());

  const toggle = (t: Task) => {
    const status: Status = t.status === "done" ? "todo" : "done";
    setTasks((cur) => cur.map((x) => (x.id === t.id ? { ...x, status } : x)));
    void call("set_task_status", { id: t.id, status });
  };

  const groups = Array.from({ length: DAYS }, (_, i) => dayKey(addDays(parseDayKey(today), i)))
    .map((key) => ({ key, items: tasks.filter((t) => t.due_at && dayKey(new Date(t.due_at)) === key) }))
    .filter((g) => g.items.length > 0);
  const open = tasks.filter((t) => t.status !== "done").length;
  let n = 0;

  return (
    <>
      <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <span className="mono-label">Next {DAYS} days</span>
        <h1 className="h1">Upcoming</h1>
        <p style={{ fontSize: 15, color: "var(--muted)" }}>
          {open} {open === 1 ? "task" : "tasks"} open across {groups.length} {groups.length === 1 ? "day" : "days"}
        </p>
      </section>
      <section style={{ display: "flex", flexDirection: "column", gap: 22 }}>
        {groups.map((g) => (
          <div key={g.key} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <button
              type="button"
              className="mono-label"
              style={{ padding: "0 4px", background: "none", border: "none", textAlign: "left", cursor: "pointer" }}
              onClick={() => (setDay(g.key), go("today"))}
            >
              {label(g.key, today)}
            </button>
            {g.items.map((t) => (
              <TaskRow key={t.id} task={t} onToggle={toggle} index={n++} />
            ))}
          </div>
        ))}
        {groups.length === 0 && <p className="empty">Nothing scheduled for the next {DAYS} days.</p>}
      </section>
    </>
  );
}
