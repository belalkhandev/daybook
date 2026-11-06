import { motion } from "framer-motion";
import { reveal } from "../lib/motion";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "../components/Icon";
import { useDataChanged, useOutside } from "../lib/hooks";
import { assetUrl, call, errorMessage, inTauri } from "../lib/ipc";
import { useUI } from "../lib/store";
import type { Note, Shot, Task } from "../lib/types";
import { clock, dayKey, fmtBytes, monthLabel, shotDayLabel, shotShortDay } from "../lib/util";

type Group = "date" | "month" | "app" | "tag";

const GROUPS: { key: Group; label: string }[] = [
  { key: "date", label: "Date" },
  { key: "month", label: "Month" },
  { key: "app", label: "App" },
  { key: "tag", label: "Tag" },
];

export function Camera({ size = 17 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" style={{ flex: "none", fill: "none", stroke: "currentColor", strokeWidth: 1.9, strokeLinejoin: "round" }}>
      <path d="M4 8h3l2-3h6l2 3h3v11H4z" />
      <circle cx="12" cy="13" r="3.5" />
    </svg>
  );
}

function localDay(iso: string): string {
  return dayKey(new Date(iso));
}

function groupKey(s: Shot, by: Group): string {
  if (by === "date") return localDay(s.taken_at);
  if (by === "month") return localDay(s.taken_at).slice(0, 7);
  if (by === "app") return s.app;
  return s.tag ?? "zz";
}

function groupLabel(key: string, by: Group): string {
  if (by === "date") return shotDayLabel(key);
  if (by === "month") return monthLabel(key);
  if (by === "app") return key;
  return key === "zz" ? "Untagged" : `#${key}`;
}

export async function copyImage(id: string): Promise<boolean> {
  try {
    await call("copy_shot_image", { id });
    return true;
  } catch {
    return false;
  }
}

function AttachPopover({ shot, onClose }: { shot: Shot; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useOutside(ref, onClose);
  const [q, setQ] = useState("");
  const [tasks, setTasks] = useState<Task[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);

  useEffect(() => {
    let alive = true;
    const t = setTimeout(async () => {
      const [a, b] = await Promise.all([
        q.trim() ? call<Task[]>("search_tasks", { queryText: q }) : call<Task[]>("list_tasks", { day: dayKey(new Date()) }),
        call<Note[]>("list_notes", { filter: "all", query: q }),
      ]);
      if (alive) {
        setTasks(a.slice(0, 6));
        setNotes(b.slice(0, 6));
      }
    }, 120);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [q]);

  const pick = async (patch: { task_id?: string | null; note_id?: string | null }) => {
    await call("update_shot", { id: shot.id, patch });
    onClose();
  };

  return (
    <div ref={ref} className="popover" style={{ left: 0, right: 0, bottom: 52, padding: 8 }}>
      <input autoFocus className="input-sm" placeholder="Search tasks and notes" value={q} onChange={(e) => setQ(e.target.value)} style={{ margin: 2 }} />
      <div style={{ maxHeight: 220, overflowY: "auto", display: "flex", flexDirection: "column", gap: 2 }}>
        {tasks.length > 0 && <span className="mono-label" style={{ padding: "6px 10px 2px" }}>Tasks</span>}
        {tasks.map((t) => (
          <button key={t.id} type="button" className="popover-item" onClick={() => void pick({ task_id: t.id })}>
            <span className="mono-label" style={{ letterSpacing: 0 }}>TASK-{t.seq}</span>
            <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.title}</span>
          </button>
        ))}
        {notes.length > 0 && <span className="mono-label" style={{ padding: "6px 10px 2px" }}>Notes</span>}
        {notes.map((n) => (
          <button key={n.id} type="button" className="popover-item" onClick={() => void pick({ note_id: n.id })}>
            <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{n.title}</span>
          </button>
        ))}
        {tasks.length + notes.length === 0 && <span style={{ padding: "10px 12px", fontSize: 13, color: "var(--muted)" }}>Nothing found.</span>}
      </div>
    </div>
  );
}

function Details({ shot }: { shot: Shot }) {
  const go = useUI((s) => s.go);
  const selectNote = useUI((s) => s.selectNote);
  const attachId = useUI((s) => s.attachShotId);
  const requestAttach = useUI((s) => s.requestAttach);
  const [title, setTitle] = useState(shot.title);
  const [tagEdit, setTagEdit] = useState<string | null>(null);
  const [attach, setAttach] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [note, setNote] = useState("");
  const [copied, setCopied] = useState("");

  useEffect(() => {
    setTitle(shot.title);
    setTagEdit(null);
    setConfirm(false);
    setNote("");
  }, [shot.id, shot.title]);
  useEffect(() => {
    if (attachId === shot.id) {
      setAttach(true);
      requestAttach(null);
    }
  }, [attachId, shot.id, requestAttach]);
  useEffect(() => {
    if (!confirm) return;
    const t = setTimeout(() => setConfirm(false), 3000);
    return () => clearTimeout(t);
  }, [confirm]);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(""), 1500);
    return () => clearTimeout(t);
  }, [copied]);

  const taken = `${shotShortDay(localDay(shot.taken_at))}, ${clock(shot.taken_at)}`;
  const commitTag = async () => {
    const v = (tagEdit ?? "").trim().replace(/^#/, "");
    setTagEdit(null);
    if (v !== (shot.tag ?? "")) await call("update_shot", { id: shot.id, patch: { tag: v || null } });
  };

  const copyText = async () => {
    try {
      await navigator.clipboard.writeText(shot.ocr_text);
      setCopied("text");
    } catch {
      setNote("Couldn't reach the clipboard");
    }
  };

  const copyImg = async () => {
    if (await copyImage(shot.id)) {
      setCopied("image");
      return;
    }
    try {
      const bytes = await call<ArrayBuffer>("read_shot_bytes", { id: shot.id }).catch(() => null);
      if (bytes) await navigator.clipboard.write([new ClipboardItem({ "image/png": new Blob([bytes], { type: "image/png" }) })]);
      setCopied("image");
    } catch {
      setNote("Couldn't reach the clipboard");
    }
  };

  const openLink = () => {
    if (shot.task) useUI.getState().setModal({ type: "task", id: shot.task.id });
    else if (shot.note) {
      selectNote(shot.note.id);
      go("notes");
    }
  };

  const link = shot.task ?? shot.note;

  return (
    <aside aria-label="Screenshot details" className="glass-strong shot-detail">
      <div className="shot-preview big">
        <img src={assetUrl(shot.thumb)} alt="Selected screenshot preview" />
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 14, padding: "0 6px" }}>
        <input
          className="shot-title-input"
          aria-label="Screenshot title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => {
            const t = title.trim();
            if (t && t !== shot.title) void call("update_shot", { id: shot.id, patch: { title: t } });
            else setTitle(shot.title);
          }}
          onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
        />
        <div className="info-grid">
          {[
            ["Taken", taken],
            ["From", shot.app],
            ["Size", `${shot.width} × ${shot.height}`],
            ["File", `${fmtBytes(shot.bytes)} · PNG`],
          ].map(([k, v]) => (
            <div key={k} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <span className="mono-label" style={{ letterSpacing: "0.06em" }}>
                {k}
              </span>
              <span style={{ fontSize: 14 }}>{v}</span>
            </div>
          ))}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
            <span className="mono-label" style={{ letterSpacing: "0.06em" }}>
              Text in image
            </span>
            <button type="button" className="mini-btn" disabled={!shot.ocr_text} onClick={() => void copyText()}>
              {copied === "text" ? "Copied" : "Copy text"}
            </button>
          </div>
          <p className="ocr-box">{shot.ocr_text || "No text found in this screenshot."}</p>
        </div>

        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
          {tagEdit === null ? (
            <>
              {shot.tag && (
                <button type="button" className="tag-chip" aria-label="Edit tag" onClick={() => setTagEdit(shot.tag ?? "")}>
                  #{shot.tag}
                </button>
              )}
              <button type="button" className="tag-add" onClick={() => setTagEdit(shot.tag ?? "")}>
                {shot.tag ? "Edit tag" : "+ Tag"}
              </button>
            </>
          ) : (
            <input
              autoFocus
              className="input-sm"
              aria-label="Tag"
              placeholder="tag, Enter to save"
              style={{ minHeight: 30, width: 170 }}
              value={tagEdit}
              onChange={(e) => setTagEdit(e.target.value)}
              onBlur={() => void commitTag()}
              onKeyDown={(e) => {
                if (e.key === "Enter") void commitTag();
                if (e.key === "Escape") setTagEdit(null);
              }}
            />
          )}
        </div>

        <div style={{ position: "relative" }}>
          {link ? (
            <div className="attached">
              <button type="button" className="attached-main" onClick={openLink}>
                <Icon name="link" size={15} sw={2} />
                <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>Attached to {link.label}</span>
              </button>
              <button type="button" className="attached-x" aria-label="Detach" onClick={() => void call("update_shot", { id: shot.id, patch: { task_id: null, note_id: null } })}>
                <Icon name="close" size={14} />
              </button>
            </div>
          ) : (
            <button type="button" className="attach-empty" onClick={() => setAttach(true)}>
              Attach to a task or note
            </button>
          )}
          {attach && <AttachPopover shot={shot} onClose={() => setAttach(false)} />}
        </div>

        {note && <div className="error-banner">{note}</div>}

        <div style={{ display: "flex", gap: 8 }}>
          <button type="button" className="shot-edit" onClick={() => void call("open_shot_editor", { id: shot.id })}>
            <Icon name="pencil" size={16} sw={2} />
            Edit
          </button>
          <button type="button" className="shot-copy" onClick={() => void copyImg()}>
            {copied === "image" ? "Copied" : "Copy"}
          </button>
          <button type="button" className="shot-sq" aria-label="Show in folder" onClick={() => void call("reveal_shot", { id: shot.id })}>
            <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true" style={{ fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinejoin: "round" }}>
              <path d="M3 6.5A1.5 1.5 0 0 1 4.5 5H9l2 2h8.5A1.5 1.5 0 0 1 21 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z" />
            </svg>
          </button>
          <button
            type="button"
            className={`shot-sq${confirm ? " is-danger" : ""}`}
            aria-label={confirm ? "Confirm delete screenshot" : "Delete screenshot"}
            onClick={() => (confirm ? void call("delete_shot", { id: shot.id }) : setConfirm(true))}
          >
            <Icon name="trash" size={17} />
          </button>
        </div>
      </div>
    </aside>
  );
}

export function Shots() {
  const selectedId = useUI((s) => s.selectedShotId);
  const selectShot = useUI((s) => s.selectShot);
  const [shots, setShots] = useState<Shot[]>([]);
  const [all, setAll] = useState(0);
  const [by, setBy] = useState<Group>("date");
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query), 150);
    return () => clearTimeout(t);
  }, [query]);

  const load = useCallback(async () => {
    const [list, total] = await Promise.all([call<Shot[]>("list_shots", { query: debounced }), call<Shot[]>("list_shots", { query: "" })]);
    setShots(list);
    setAll(total.length);
  }, [debounced]);

  useEffect(() => {
    void load();
  }, [load]);
  useDataChanged(["shots", "tasks", "notes"], () => void load());

  const groups = useMemo(() => {
    const order: string[] = [];
    const map = new Map<string, Shot[]>();
    for (const s of shots) {
      const k = groupKey(s, by);
      if (!map.has(k)) {
        map.set(k, []);
        order.push(k);
      }
      map.get(k)?.push(s);
    }
    if (by === "app") order.sort((a, b) => (map.get(b)?.length ?? 0) - (map.get(a)?.length ?? 0));
    if (by === "tag") order.sort();
    return order.map((k) => ({ key: k, label: groupLabel(k, by), items: map.get(k) ?? [] }));
  }, [shots, by]);

  const sel = shots.find((s) => s.id === selectedId) ?? shots[0] ?? null;

  const capture = async () => {
    try {
      setError("");
      await call("start_capture", { mode: "area" });
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  return (
    <>
      <section style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", justifyContent: "space-between", gap: 20 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <span className="eyebrow">{all} screenshots · ~/Pictures/Trove</span>
          <h1 className="h1">Shots</h1>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10 }}>
          <div className="glass shots-search">
            <Icon name="search" size={16} />
            <label htmlFor="shot-search" className="sr">
              Search screenshots
            </label>
            <input id="shot-search" type="search" value={query} placeholder="Search text inside screenshots" onChange={(e) => setQuery(e.target.value)} />
          </div>
          <button type="button" className="take-btn" onClick={() => void capture()} disabled={!inTauri && !import.meta.env.DEV}>
            <Camera />
            Take screenshot
            <kbd className="kbd-dark" style={{ padding: "2px 6px", borderRadius: 6 }}>
              PrtSc
            </kbd>
          </button>
        </div>
      </section>
      {error && <div className="error-banner">{error}</div>}

      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 13, color: "var(--text-3b)" }}>Group by</span>
          <div role="group" aria-label="Group by" className="seg" style={{ borderRadius: 12 }}>
            {GROUPS.map((g) => (
              <button key={g.key} type="button" className={`seg-btn${by === g.key ? " is-on" : ""}`} style={{ padding: "0 14px", borderRadius: 9 }} aria-pressed={by === g.key} onClick={() => setBy(g.key)}>
                {g.label}
              </button>
            ))}
          </div>
        </div>
        <span style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--muted)" }}>PrtSc area · Shift PrtSc window · Ctrl PrtSc screen</span>
      </div>

      <div className="two-col">
        <div style={{ flex: "999 1 600px", minWidth: 0, display: "flex", flexDirection: "column", gap: 28 }}>
          {groups.map((g) => (
            <section key={g.key} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
                <h2 style={{ fontSize: 17, fontWeight: 600, letterSpacing: "-0.01em" }}>{g.label}</h2>
                <span style={{ fontFamily: "var(--mono)", fontSize: 12, color: "var(--muted)" }}>
                  {g.items.length} {g.items.length === 1 ? "shot" : "shots"}
                </span>
              </div>
              <div className="shot-grid">
                {g.items.map((s, idx) => {
                  const on = sel?.id === s.id;
                  return (
                    <motion.button {...reveal(idx)} whileHover={{ y: -3 }} whileTap={{ scale: 0.98 }} key={s.id} type="button" className={`glass shot-card${on ? " is-on" : ""}`} aria-pressed={on} onClick={() => selectShot(s.id)}>
                      <div className="shot-preview">
                        <img src={assetUrl(s.thumb)} alt="" loading="lazy" />
                      </div>
                      <span className="shot-card-title">{s.title}</span>
                      <span className="shot-card-meta">
                        <span className="shot-meta-text">
                          {by === "date" ? clock(s.taken_at) : shotShortDay(localDay(s.taken_at))} · {s.app}
                        </span>
                        {s.tag && <span className="shot-tag">#{s.tag}</span>}
                      </span>
                    </motion.button>
                  );
                })}
              </div>
            </section>
          ))}
          {groups.length === 0 && (
            <p className="empty" style={{ padding: 40 }}>
              {debounced ? `No screenshot contains “${debounced}”.` : "No screenshots yet. Press PrtSc or use Take screenshot."}
            </p>
          )}
        </div>
        {sel && <Details key={sel.id} shot={sel} />}
      </div>
    </>
  );
}
