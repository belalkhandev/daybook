import type { Note, NoteColor, Priority } from "./types";

const pad = (n: number) => String(n).padStart(2, "0");

export function dayKey(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function parseDayKey(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(d: Date, n: number): Date {
  const c = new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
  return c;
}

export function weekStart(d: Date): Date {
  const dow = (d.getDay() + 6) % 7;
  return addDays(new Date(d.getFullYear(), d.getMonth(), d.getDate()), -dow);
}

export function toIso(d: Date): string {
  return d.toISOString().replace(/\.\d{3}Z$/, "Z");
}

export function localIso(day: string, time: string | null): string {
  const d = parseDayKey(day);
  if (time) {
    const [h, m] = time.split(":").map(Number);
    d.setHours(h || 0, m || 0, 0, 0);
  }
  return toIso(d);
}

export function parseClock(text: string): string | null {
  const m = /^\s*(\d{1,2})(?::(\d{2}))?\s*$/.exec(text);
  if (!m) return null;
  const h = Number(m[1]);
  const mi = m[2] ? Number(m[2]) : 0;
  if (h > 23 || mi > 59) return null;
  return `${pad(h)}:${pad(mi)}`;
}

export function clock(iso: string): string {
  const d = new Date(iso);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function hasTime(iso: string): boolean {
  const d = new Date(iso);
  return d.getHours() !== 0 || d.getMinutes() !== 0;
}

export function timeLabel(iso: string | null): string {
  if (!iso) return "No date";
  return hasTime(iso) ? clock(iso) : "All day";
}

export type Part = "Morning" | "Afternoon" | "Evening";

export function partOfDay(iso: string | null): Part {
  if (!iso) return "Morning";
  const h = new Date(iso).getHours();
  if (h < 12) return "Morning";
  return h < 17 ? "Afternoon" : "Evening";
}

export function greeting(now: Date): string {
  const h = now.getHours();
  if (h < 12) return "Good morning";
  return h < 17 ? "Good afternoon" : "Good evening";
}

export function longDate(d: Date): string {
  const wd = d.toLocaleDateString("en-GB", { weekday: "long" });
  const month = d.toLocaleDateString("en-GB", { month: "long" });
  return `${wd} · ${d.getDate()} ${month} ${d.getFullYear()}`;
}

export function dueLabel(iso: string | null): string {
  if (!iso) return "No date";
  const d = new Date(iso);
  const today = new Date();
  const key = dayKey(d);
  let day: string;
  if (key === dayKey(today)) day = "Today";
  else if (key === dayKey(addDays(today, 1))) day = "Tomorrow";
  else day = d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
  return hasTime(iso) ? `${day} · ${clock(iso)}` : day;
}

export function fmtElapsed(secs: number): string {
  const s = Math.max(0, Math.floor(secs));
  return `${Math.floor(s / 3600)}h ${pad(Math.floor((s % 3600) / 60))}m ${pad(s % 60)}s`;
}

export function fmtTarget(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${h}h ${pad(m)}m`;
}

export function fmtTargetShort(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${pad(m)}m`;
}

export function edited(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const mins = Math.floor((now.getTime() - d.getTime()) / 60000);
  if (mins < 1) return "Edited just now";
  if (mins < 60) return `Edited ${mins}m ago`;
  const todayKey = dayKey(now);
  if (dayKey(d) === todayKey) return `Edited ${Math.floor(mins / 60)}h ago`;
  if (dayKey(d) === dayKey(addDays(now, -1))) return "Edited yesterday";
  if (mins < 7 * 24 * 60) return `Edited ${d.toLocaleDateString("en-GB", { weekday: "short" })}`;
  return d.toLocaleDateString("en-GB", { month: "short", day: "numeric" }).replace(/^(\d+) (\w+)$/, "$2 $1");
}

export function excerpt(md: string): string {
  const lines = md
    .split("\n")
    .map((l) =>
      l
        .replace(/^\s*(?:[-*+]|\d+[.)])\s+\[[ xX]\]\s+/, "")
        .replace(/^\s*(?:[-*+]|\d+[.)])\s+/, "")
        .replace(/^#{1,6}\s+/, "")
        .replace(/[*_`~]/g, "")
        .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
        .trim(),
    )
    .filter((l) => l && !l.startsWith("```"));
  return lines.join(" · ");
}

export function wordCount(md: string): number {
  const t = md.trim();
  return t ? t.split(/\s+/).length : 0;
}

export function hasOpenItems(md: string): boolean {
  let fence = false;
  for (const line of md.split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) fence = !fence;
    else if (!fence && /^\s*[-*+]\s+\[ \]\s+\S/.test(line)) return true;
  }
  return false;
}

export function toggleCheckbox(md: string, index: number): string {
  const lines = md.split("\n");
  let fence = false;
  let n = 0;
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*(```|~~~)/.test(lines[i])) {
      fence = !fence;
      continue;
    }
    if (fence) continue;
    const m = /^(\s*(?:[-*+]|\d+[.)])\s+\[)([ xX])(\])/.exec(lines[i]);
    if (!m) continue;
    if (n === index) {
      lines[i] = m[1] + (m[2] === " " ? "x" : " ") + lines[i].slice(m[0].length - 1);
      break;
    }
    n++;
  }
  return lines.join("\n");
}

export const NOTE_DOT: Record<NoteColor, string> = {
  violet: "#A78BFA",
  mint: "#34D399",
  peach: "#FDBA74",
  sky: "#93C5FD",
  rose: "#F9A8D4",
  yellow: "#FCD34D",
};

export const NOTE_PICK: { key: NoteColor; name: string; hex: string }[] = [
  { key: "violet", name: "Violet", hex: "#C4B5FD" },
  { key: "mint", name: "Mint", hex: "#6EE7B7" },
  { key: "peach", name: "Peach", hex: "#FDBA74" },
  { key: "sky", name: "Sky", hex: "#93C5FD" },
  { key: "rose", name: "Rose", hex: "#F9A8D4" },
];

export const FOLDER_LABEL: Record<Note["folder"], string> = {
  work: "Work",
  personal: "Personal",
  ideas: "Ideas",
};

export const PRIORITY: Record<Priority, { label: string; short: string; bg: string; text: string; dot: string }> = {
  high: { label: "High", short: "High", bg: "#FFF1E8", text: "#B4410B", dot: "#EA580C" },
  med: { label: "Medium", short: "Med", bg: "#EEF0FF", text: "#4338CA", dot: "#6366F1" },
  low: { label: "Low", short: "Low", bg: "#EAF3F0", text: "#2F5A4F", dot: "#5FA898" },
};

export const STATUS_DOT = { done: "#10B981", progress: "#F59E0B", todo: "#9CA3AF" } as const;

export function debounce<A extends unknown[]>(fn: (...a: A) => void, ms: number) {
  let t: ReturnType<typeof setTimeout> | undefined;
  const d = (...a: A) => {
    if (t) clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
  d.cancel = () => {
    if (t) clearTimeout(t);
  };
  d.flush = (...a: A) => {
    if (t) clearTimeout(t);
    fn(...a);
  };
  return d;
}

export function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace("#", ""), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function shotDayLabel(day: string, now = new Date()): string {
  const d = parseDayKey(day);
  if (day === dayKey(now)) return "Today";
  if (day === dayKey(addDays(now, -1))) return "Yesterday";
  const wd = d.toLocaleDateString("en-GB", { weekday: "long" });
  const month = d.toLocaleDateString("en-GB", { month: "long" });
  return `${wd}, ${d.getDate()} ${month}${d.getFullYear() === now.getFullYear() ? "" : " " + d.getFullYear()}`;
}

export function shotShortDay(day: string, now = new Date()): string {
  if (day === dayKey(now)) return "Today";
  if (day === dayKey(addDays(now, -1))) return "Yesterday";
  const d = parseDayKey(day);
  return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" }).replace(",", "");
}

export function monthLabel(day: string): string {
  const d = parseDayKey(day + "-01");
  return `${d.toLocaleDateString("en-GB", { month: "long" })} ${d.getFullYear()}`;
}

export function fmtBytes(n: number): string {
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(n / 1024))} KB`;
}
