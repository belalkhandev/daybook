import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { addDays, dayKey, parseDayKey, weekStart } from "../lib/util";
import { Icon } from "./Icon";

const DOW = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const MONTHS_SHORT = MONTHS.map((m) => m.slice(0, 3));
const ITEM_H = 36;
const pad = (n: number) => String(n).padStart(2, "0");

export function Popup({ anchor, onClose, children }: { anchor: React.RefObject<HTMLElement | null>; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    const compute = () => {
      const t = anchor.current?.getBoundingClientRect();
      if (!t) return;
      const w = ref.current?.offsetWidth ?? 300;
      const h = ref.current?.offsetHeight ?? 340;
      const m = 8;
      let left = t.left;
      if (left + w > window.innerWidth - m) left = Math.max(m, window.innerWidth - m - w);
      let top = t.bottom + 6;
      if (top + h > window.innerHeight - m && t.top - h - 6 > m) top = t.top - h - 6;
      setPos({ top, left });
    };
    compute();
    const raf = requestAnimationFrame(compute);
    window.addEventListener("resize", compute);
    window.addEventListener("scroll", compute, true);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", compute);
      window.removeEventListener("scroll", compute, true);
    };
  }, [anchor]);

  useEffect(() => {
    const down = (e: MouseEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t) || anchor.current?.contains(t)) return;
      onClose();
    };
    document.addEventListener("mousedown", down);
    return () => document.removeEventListener("mousedown", down);
  }, [anchor, onClose]);

  return createPortal(
    <motion.div
      ref={ref}
      data-picker-popup=""
      className="pk-pop"
      style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999, visibility: pos ? "visible" : "hidden" }}
      initial={{ opacity: 0, y: -6, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -4, scale: 0.98 }}
      transition={{ duration: 0.14 }}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onClose();
        }
      }}
    >
      {children}
    </motion.div>,
    document.body,
  );
}

function fmtDay(key: string): string {
  return parseDayKey(key).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
}

function fmtClock(v: string): string {
  const m = /^(\d{2}):(\d{2})$/.exec(v);
  if (!m) return "";
  const h = Number(m[1]);
  return `${pad(h % 12 || 12)}:${m[2]} ${h >= 12 ? "PM" : "AM"}`;
}

interface DateProps {
  id?: string;
  value: string;
  onChange: (day: string) => void;
  placeholder?: string;
}

export function DatePicker({ id, value, onChange, placeholder = "Pick a date" }: DateProps) {
  const [open, setOpen] = useState(false);
  const [level, setLevel] = useState<"days" | "months" | "years">("days");
  const base = value ? parseDayKey(value) : new Date();
  const [view, setView] = useState({ y: base.getFullYear(), m: base.getMonth() });
  const btn = useRef<HTMLButtonElement>(null);
  const today = dayKey(new Date());

  const toggle = () => {
    if (!open) {
      const b = value ? parseDayKey(value) : new Date();
      setView({ y: b.getFullYear(), m: b.getMonth() });
      setLevel("days");
    }
    setOpen(!open);
  };

  const cells = useMemo(() => {
    const start = weekStart(new Date(view.y, view.m, 1));
    return Array.from({ length: 42 }, (_, i) => addDays(start, i));
  }, [view]);

  const step = (n: number) => {
    if (level === "years") setView((v) => ({ ...v, y: v.y + n * 12 }));
    else if (level === "months") setView((v) => ({ ...v, y: v.y + n }));
    else setView((v) => ({ y: new Date(v.y, v.m + n, 1).getFullYear(), m: new Date(v.y, v.m + n, 1).getMonth() }));
  };

  const yearStart = view.y - 5;

  return (
    <div className="pk">
      <button ref={btn} id={id} type="button" className={`pk-trigger${open ? " is-open" : ""}`} aria-haspopup="dialog" aria-expanded={open} onClick={toggle}>
        <Icon name="calendar" size={14} sw={2} />
        <span className={value ? "" : "is-ph"}>{value ? fmtDay(value) : placeholder}</span>
      </button>
      <AnimatePresence>
        {open && (
          <Popup anchor={btn} onClose={() => setOpen(false)}>
            <div className="pk-cal" role="dialog" aria-label="Choose date">
              <div className="pk-head">
                <button type="button" className="pk-nav" aria-label="Previous" onClick={() => step(-1)}>
                  <Icon name="arrowLeft" size={14} sw={2} />
                </button>
                <button type="button" className="pk-title" onClick={() => setLevel(level === "days" ? "months" : level === "months" ? "years" : "days")}>
                  {level === "days" ? `${MONTHS[view.m]} ${view.y}` : level === "months" ? view.y : `${yearStart} - ${yearStart + 11}`}
                </button>
                <button type="button" className="pk-nav" aria-label="Next" onClick={() => step(1)}>
                  <Icon name="arrowRight" size={14} sw={2} />
                </button>
              </div>
              {level === "days" && (
                <div className="pk-grid">
                  {DOW.map((d) => (
                    <span key={d} className="pk-dow">
                      {d}
                    </span>
                  ))}
                  {cells.map((d) => {
                    const k = dayKey(d);
                    return (
                      <button
                        key={k}
                        type="button"
                        className={`pk-day${d.getMonth() !== view.m ? " is-out" : ""}${k === value ? " is-sel" : ""}${k === today ? " is-today" : ""}`}
                        onClick={() => {
                          onChange(k);
                          setOpen(false);
                        }}
                      >
                        {d.getDate()}
                      </button>
                    );
                  })}
                </div>
              )}
              {level === "months" && (
                <div className="pk-tiles">
                  {MONTHS_SHORT.map((m, i) => (
                    <button key={m} type="button" className={`pk-tile${i === view.m ? " is-sel" : ""}`} onClick={() => (setView({ ...view, m: i }), setLevel("days"))}>
                      {m}
                    </button>
                  ))}
                </div>
              )}
              {level === "years" && (
                <div className="pk-tiles">
                  {Array.from({ length: 12 }, (_, i) => yearStart + i).map((y) => (
                    <button key={y} type="button" className={`pk-tile${y === view.y ? " is-sel" : ""}`} onClick={() => (setView({ ...view, y }), setLevel("months"))}>
                      {y}
                    </button>
                  ))}
                </div>
              )}
              <div className="pk-foot">
                <button type="button" className="pk-link" onClick={() => (onChange(today), setOpen(false))}>
                  Today
                </button>
              </div>
            </div>
          </Popup>
        )}
      </AnimatePresence>
    </div>
  );
}

function Wheel<T extends string | number>({ items, value, onChange, label, render }: { items: T[]; value: T; onChange: (v: T) => void; label: string; render?: (v: T) => string }) {
  const ref = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const idx = Math.max(0, items.indexOf(value));

  useLayoutEffect(() => {
    if (ref.current) ref.current.scrollTop = idx * ITEM_H;
  }, []);

  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  const go = (i: number, smooth = true) => {
    const c = Math.min(items.length - 1, Math.max(0, i));
    ref.current?.scrollTo({ top: c * ITEM_H, behavior: smooth ? "smooth" : "auto" });
    if (items[c] !== value) onChange(items[c]);
  };

  return (
    <div
      ref={ref}
      tabIndex={0}
      role="listbox"
      aria-label={label}
      className="pk-wheel"
      onScroll={() => {
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => {
          const el = ref.current;
          if (!el) return;
          const i = Math.min(items.length - 1, Math.max(0, Math.round(el.scrollTop / ITEM_H)));
          if (items[i] !== value) onChange(items[i]);
        }, 120);
      }}
      onKeyDown={(e) => {
        if (e.key === "ArrowUp" || e.key === "ArrowDown") {
          e.preventDefault();
          go(idx + (e.key === "ArrowUp" ? -1 : 1));
        }
      }}
    >
      <div className="pk-wheel-pad">
        {items.map((it, i) => (
          <button key={String(it)} type="button" role="option" aria-selected={i === idx} className={`pk-item${i === idx ? " is-sel" : Math.abs(i - idx) === 1 ? " is-near" : ""}`} onClick={() => go(i)}>
            {render ? render(it) : it}
          </button>
        ))}
      </div>
    </div>
  );
}

const HOURS = Array.from({ length: 12 }, (_, i) => i + 1);
const MINUTES = Array.from({ length: 60 }, (_, i) => i);

interface TimeProps {
  id?: string;
  value: string;
  onChange: (time: string) => void;
  placeholder?: string;
}

export function TimePicker({ id, value, onChange, placeholder = "Time" }: TimeProps) {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const m = /^(\d{2}):(\d{2})$/.exec(value);
  const h24 = m ? Number(m[1]) : 9;
  const min = m ? Number(m[2]) : 0;
  const h12 = h24 % 12 || 12;
  const period = h24 >= 12 ? "PM" : "AM";

  const emit = (h: number, mi: number, p: string) => onChange(`${pad(p === "PM" ? (h % 12) + 12 : h % 12)}:${pad(mi)}`);

  return (
    <div className="pk">
      <button ref={btn} id={id} type="button" className={`pk-trigger${open ? " is-open" : ""}`} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(!open)}>
        <Icon name="clock" size={14} sw={2} />
        <span className={value ? "" : "is-ph"}>{value ? fmtClock(value) : placeholder}</span>
      </button>
      <AnimatePresence>
        {open && (
          <Popup anchor={btn} onClose={() => setOpen(false)}>
            <div className="pk-time" role="dialog" aria-label="Choose time">
              <div className="pk-wheels">
                <div className="pk-band" aria-hidden="true" />
                <Wheel label="Hour" items={HOURS} value={h12} render={(v) => pad(v)} onChange={(v) => emit(v, min, period)} />
                <span className="pk-colon" aria-hidden="true">
                  :
                </span>
                <Wheel label="Minute" items={MINUTES} value={min} render={(v) => pad(v)} onChange={(v) => emit(h12, v, period)} />
                <Wheel label="AM or PM" items={["AM", "PM"]} value={period} onChange={(v) => emit(h12, min, v)} />
              </div>
              <div className="pk-foot">
                <button type="button" className="pk-link is-danger" onClick={() => (onChange(""), setOpen(false))}>
                  Clear
                </button>
                <button type="button" className="pk-link" onClick={() => (value || emit(h12, min, period), setOpen(false))}>
                  Done
                </button>
              </div>
            </div>
          </Popup>
        )}
      </AnimatePresence>
    </div>
  );
}
