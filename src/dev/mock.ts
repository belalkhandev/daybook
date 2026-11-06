import type { Comment, Note, Project, Task } from "../lib/types";
import { toIso } from "../lib/util";
import { art } from "./shotart";

type Args = Record<string, unknown> | undefined;
const subs = new Set<(k: string) => void>();
export const mockSubscribe = (cb: (k: string) => void) => subs.add(cb);
const emit = (k: string) => subs.forEach((s) => s(k));

const pad = (n: number) => String(n).padStart(2, "0");
const id = () => Math.random().toString(36).slice(2);
const todayAt = (h: number, m: number) => {
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return toIso(d);
};
const ago = (mins: number) => toIso(new Date(Date.now() - mins * 60000));

const projects: Project[] = [
  { id: "p1", name: "Trove App", color: "#6366F1", sort: 0 },
  { id: "p2", name: "Client work", color: "#F59E0B", sort: 1 },
  { id: "p3", name: "Website", color: "#EC4899", sort: 2 },
  { id: "p4", name: "Personal", color: "#10B981", sort: 3 },
];

let seq = 141;
const mk = (title: string, h: number, m: number, tag: string, pr: Task["priority"], p: string, status: Task["status"] = "todo"): Task => ({
  id: "t" + ++seq,
  seq,
  title,
  description_md: "",
  status,
  priority: pr,
  project_id: p,
  project: projects.find((x) => x.id === p) ?? null,
  due_at: todayAt(h, m),
  remind_before_min: null,
  target_minutes: null,
  tracked_seconds: 0,
  timer_started_at: null,
  completed_at: null,
  created_at: ago(500),
  updated_at: ago(500),
  tags: [tag],
});

const tasks: Task[] = [
  mk("Review pull request for sync engine", 9, 30, "dev", "high", "p1", "done"),
  mk("Standup with design team", 11, 30, "work", "med", "p2"),
  mk("Write release notes for v0.4", 14, 0, "dev", "med", "p1"),
  mk("Call Rafi about the invoice", 16, 0, "work", "high", "p2"),
  mk("Pay electricity bill", 17, 0, "home", "low", "p4", "done"),
  mk("30-minute walk", 19, 0, "health", "low", "p4"),
  mk("Read 20 pages", 21, 30, "personal", "low", "p4"),
];

const rel = tasks[2];
rel.description_md =
  "## What’s new in v0.4\n\n- Offline-first sync with a local **SQLite** store\n- Keyboard-only mode: open anything with `Ctrl K`\n- The week strip now scrolls back to past weeks\n\n- [x] Credit contributors\n- [ ] Mention the Flatpak release\n\n```rust title=\"bump_version.rs\"\nuse std::{fs, path::Path};\n\npub fn bump_version(manifest: &Path, next: &str) -> std::io::Result<()> {\n    let text = fs::read_to_string(manifest)?;\n    let updated = text.replacen(\"0.3.2\", next, 1);\n    fs::write(manifest, updated)?;\n    Ok(())\n}\n```";
rel.priority = "high";
rel.target_minutes = 120;
rel.tracked_seconds = 5100;
rel.tags = ["dev", "release"];
rel.status = "progress";

const note = (title: string, folder: Note["folder"], color: Note["color"], pinned: boolean, mins: number, body: string): Note => ({
  id: "n" + id(),
  title,
  body_md: body,
  folder,
  color,
  pinned,
  created_at: ago(mins),
  updated_at: ago(mins),
});

const notes: Note[] = [
  note("Sprint ideas", "ideas", "violet", true, 120, "Things worth trying before v1:\n\n- [ ] Offline-first sync with a local SQLite store\n- [x] Keyboard-only mode: every action reachable from Ctrl K\n- [ ] Recurring tasks written in plain language, like “every Friday 5pm”\n\nKeep the glass look, but add a reduced-transparency switch in Settings."),
  note("Groceries", "personal", "mint", true, 1500, "- [x] Rice, 5 kg\n- [ ] Red lentils\n- [ ] Eggs, 12\n- [ ] Green chillies\n- [ ] Mustard oil\n- [ ] Tea"),
  note("Design sync, notes", "work", "peach", true, 4000, "Keep the glass cards; lower the blur on older GPUs.\n\nShip the light theme first, dark theme in v0.5.\n\nThe week strip should scroll back to past weeks."),
  note("Release checklist v0.4", "work", "sky", false, 12000, "- [ ] Bump version in Cargo.toml\n- [ ] Build .deb and .rpm packages\n- [ ] Publish the Flatpak\n- [ ] Update the changelog"),
  note("Reading list", "personal", "rose", false, 11000, "Pages 41, 88 and 132: the parts about attention and deep work. Revisit before the weekend."),
  note("Weekend", "personal", "yellow", false, 14000, "Visit Nani on Saturday, fix the balcony light, back up the phone photos."),
];

const comments: Comment[] = [
  { id: "c1", task_id: rel.id, body_md: "Draft is in `docs/release/v0.4.md`. Still need **screenshots** for the notes page.", created_at: todayAt(10, 12), updated_at: todayAt(10, 12) },
  { id: "c2", task_id: rel.id, body_md: "Flatpak build passed on **Fedora** and **Ubuntu**. Run `cargo test --release` once more before tagging.", created_at: todayAt(12, 40), updated_at: todayAt(12, 40) },
];

const daysAgo = (d: number, h: number, m: number) => {
  const x = new Date();
  x.setDate(x.getDate() - d);
  x.setHours(h, m, 0, 0);
  return toIso(x);
};

const mkShot = (title: string, kind: string, d: number, h: number, m: number, app: string, tag: string | null, res: [number, number], kb: number, ocr: string, i: number, task?: Task) => ({
  id: "s" + (i + 1),
  title,
  file: "/x/" + (i + 1) + ".png",
  thumb: art(kind, i),
  taken_at: daysAgo(d, h, m),
  app,
  tag,
  width: res[0],
  height: res[1],
  bytes: kb * 1024,
  ocr_text: ocr,
  task: task ? { id: task.id, label: "TASK-" + task.seq + " \u00b7 " + task.title } : null,
  note: null as { id: string; label: string } | null,
});

const shots = [
  mkShot("Sync bug in store.rs", "code", 0, 14, 2, "Code", "bug", [1037, 648], 412, "fn sync_store(&mut self) -> Result<()> { let tx = self.conn.transaction()?; ... }", 0, rel),
  mkShot("Flathub app page", "web", 0, 12, 40, "Firefox", "design", [1920, 1080], 680, "Trove, Daily tasks and notes. Install on Flathub.", 1),
  mkShot("cargo test output", "terminal", 0, 10, 15, "Terminal", "bug", [1280, 720], 210, "test result: FAILED. 41 passed; 1 failed; finished in 3.42s", 2),
  mkShot("Usage dashboard", "chart", 0, 9, 31, "Firefox", null, [1920, 1080], 540, "Weekly active users, Sessions, Avg. focus time", 3),
  mkShot("Note card variants", "design", 1, 18, 20, "Figma", "design", [1600, 1000], 388, "Sprint ideas, Groceries, Design sync", 4),
  mkShot("Electricity bill receipt", "receipt", 1, 16, 5, "Document Viewer", "receipt", [1240, 1754], 296, "Account 4471-09 Units 214 Total due 2,340 BDT", 5),
  mkShot("Keyring error dialog", "code", 1, 11, 47, "Code", "bug", [1037, 648], 402, "Error: NoStorageAccess(PlatformFailure)", 6),
  mkShot("Tauri docs, windows", "web", 3, 21, 10, "Firefox", null, [1920, 1080], 612, "WebviewWindowBuilder::new(app, label, url)", 7),
  mkShot("Logo explorations", "design", 3, 15, 0, "Figma", "design", [1600, 1000], 355, "Trove logo v3 gradient", 8),
  mkShot("Domain renewal", "receipt", 36, 19, 44, "Firefox", "receipt", [1240, 1754], 240, "trove.app 1 year Paid", 9),
];

let settings: Record<string, string> = {};
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const KW = /\b(use|pub|fn|let|mut|const|return|if|else|for|while|struct|impl|enum|match)\b/g;
const hl = (line: string) =>
  esc(line)
    .replace(/(&quot;|")(?:(?!\1).)*\1/g, (m) => `<span class="tok-s">${m}</span>`)
    .replace(KW, '<span class="tok-k">$1</span>')
    .replace(/\b(Path|str|Result|Ok)\b/g, '<span class="tok-t">$1</span>')
    .replace(/\b(bump_version|read_to_string|replacen|write)\b/g, '<span class="tok-f">$1</span>');

function inline(t: string): string {
  return esc(t)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
}

function renderMd(md: string): string {
  const out: string[] = [];
  const lines = md.split("\n");
  let i = 0;
  let check = 0;
  while (i < lines.length) {
    const l = lines[i];
    const fence = /^```(\w*)\s*(?:title="([^"]*)")?/.exec(l);
    if (fence) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) body.push(lines[i++]);
      i++;
      const nums = body.map((_, n) => `<div>${n + 1}</div>`).join("");
      const code = body.map((b) => `<div>${hl(b)}</div>`).join("");
      out.push(
        `<figure class="md-code"><figcaption class="md-code-head"><span class="md-code-meta"><span class="md-code-lang">${fence[1]}</span>${fence[2] ?? ""}</span><button type="button" class="md-code-copy" data-copy="1">Copy</button></figcaption><div class="md-code-body"><div class="md-code-nums">${nums}</div><code class="md-code-text">${code}</code></div></figure>`,
      );
      continue;
    }
    if (/^\s*[-*+]\s/.test(l)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*+]\s/.test(lines[i])) {
        const m = /^\s*[-*+]\s+(?:\[([ xX])\]\s+)?(.*)$/.exec(lines[i]) as RegExpExecArray;
        if (m[1] !== undefined) {
          const on = m[1] !== " ";
          items.push(`<li><button type="button" class="md-check${on ? " is-on" : ""}" data-check="${check++}" aria-pressed="${on}"></button>${inline(m[2])}</li>`);
        } else items.push(`<li>${inline(m[2])}</li>`);
        i++;
      }
      out.push(`<ul>${items.join("")}</ul>`);
      continue;
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(l);
    if (h) out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`);
    else if (l.trim()) out.push(`<p>${inline(l)}</p>`);
    i++;
  }
  return out.join("");
}

function dayRange(day: string) {
  const [y, m, d] = day.split("-").map(Number);
  return [new Date(y, m - 1, d).getTime(), new Date(y, m - 1, d + 1).getTime()];
}

const sample = {
  task: {
    title: "Write release notes for v0.4",
    project: "Trove App",
    priority: "high",
    due_at: todayAt(18, 0),
    target_minutes: 120,
    tags: ["dev", "release"],
    markdown:
      "Draft and publish the **v0.4** release notes before the evening build.\n\n### Highlights\n\n- Offline-first sync with a local **SQLite** store\n- Keyboard-only mode: open anything with `Ctrl K`\n\n### Steps\n\n- [ ] Collect merged pull requests since v0.3.2\n- [ ] Write highlights and add screenshots\n- [ ] Publish to GitHub Releases",
  },
  note: { title: "Design sync, 29 Oct", folder: "work", color: "peach", tags: ["design"], markdown: "### Decisions\n\n- Keep the glass cards across every screen\n- Ship the light theme first\n\n### Follow-ups\n\n- [ ] Make the week strip scroll back" },
};

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function mockCall(cmd: string, a: Args): Promise<unknown> {
  const args = (a ?? {}) as Record<string, any>;
  switch (cmd) {
    case "get_settings":
      return settings;
    case "has_api_key":
      return true;
    case "set_setting":
      settings = { ...settings, [args.key]: args.value };
      return null;
    case "list_projects":
      return projects;
    case "list_tags":
      return ["dev", "work", "home", "health", "personal", "release"];
    case "list_tasks": {
      const [s, e] = dayRange(args.day);
      return tasks.filter((t) => t.due_at && Date.parse(t.due_at) >= s && Date.parse(t.due_at) < e).sort((x, y) => (x.due_at as string).localeCompare(y.due_at as string));
    }
    case "list_upcoming": {
      const [s] = dayRange(args.from);
      const e = s + Number(args.days) * 86400000;
      return tasks.filter((t) => t.due_at && Date.parse(t.due_at) >= s && Date.parse(t.due_at) < e).sort((x, y) => (x.due_at as string).localeCompare(y.due_at as string));
    }
    case "list_week_counts": {
      const [y, m, d] = (args.weekStart as string).split("-").map(Number);
      return Array.from({ length: 7 }, (_, i) => {
        const dt = new Date(y, m - 1, d + i);
        const key = `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
        const [s, e] = dayRange(key);
        return { day: key, count: tasks.filter((t) => t.due_at && Date.parse(t.due_at) >= s && Date.parse(t.due_at) < e).length };
      });
    }
    case "get_task":
      return tasks.find((t) => t.id === args.id) ?? tasks[2];
    case "set_task_status": {
      const t = tasks.find((x) => x.id === args.id);
      if (t) {
        t.status = args.status;
        if (args.status === "done") t.timer_started_at = null;
      }
      emit("tasks");
      return t;
    }
    case "update_task": {
      const t = tasks.find((x) => x.id === args.id);
      if (t) Object.assign(t, args.patch);
      emit("tasks");
      return t;
    }
    case "timer_start": {
      const t = tasks.find((x) => x.id === args.id);
      if (t) t.timer_started_at = toIso(new Date());
      emit("tasks");
      return t;
    }
    case "timer_pause": {
      const t = tasks.find((x) => x.id === args.id);
      if (t?.timer_started_at) {
        t.tracked_seconds += Math.floor((Date.now() - Date.parse(t.timer_started_at)) / 1000);
        t.timer_started_at = null;
      }
      emit("tasks");
      return t;
    }
    case "timer_reset": {
      const t = tasks.find((x) => x.id === args.id);
      if (t) (t.tracked_seconds = 0), (t.timer_started_at = null);
      emit("tasks");
      return t;
    }
    case "create_task": {
      const t = mk(args.input.title, 0, 0, "x", args.input.priority ?? "med", args.input.project_id ?? "p1");
      Object.assign(t, { due_at: args.input.due_at, tags: args.input.tags ?? [], description_md: args.input.description_md ?? "" });
      tasks.push(t);
      emit("tasks");
      return t;
    }
    case "create_from_quick_add": {
      if (args.kind === "note") {
        const n = note(String(args.text).split("\n")[0], "personal", "violet", false, 0, "");
        notes.unshift(n);
        emit("notes");
        return { kind: "note", id: n.id };
      }
      const t = mk(String(args.text).replace(/[#!]\S+/g, "").trim() || "Task", 0, 0, "work", "med", "p1");
      const [s] = dayRange(args.day);
      t.due_at = toIso(new Date(s));
      tasks.push(t);
      emit("tasks");
      return { kind: "task", id: t.id };
    }
    case "move_task_to_tomorrow":
    case "delete_task": {
      const i = tasks.findIndex((x) => x.id === args.id);
      if (i >= 0) {
        if (cmd === "delete_task") tasks.splice(i, 1);
        else tasks[i].due_at = toIso(new Date(Date.parse(tasks[i].due_at as string) + 86400000));
      }
      emit("tasks");
      return null;
    }
    case "search_tasks":
      return tasks.filter((t) => t.title.toLowerCase().includes(String(args.queryText).toLowerCase())).slice(0, 10);
    case "list_notes": {
      const q = String(args.query ?? "").toLowerCase();
      return notes
        .filter((n) => (args.filter === "all" ? true : args.filter === "pinned" ? n.pinned : n.folder === args.filter))
        .filter((n) => !q || n.title.toLowerCase().includes(q) || n.body_md.toLowerCase().includes(q))
        .sort((x, y) => y.updated_at.localeCompare(x.updated_at));
    }
    case "note_counts":
      return { all: notes.length, pinned: notes.filter((n) => n.pinned).length, work: notes.filter((n) => n.folder === "work").length, personal: notes.filter((n) => n.folder === "personal").length, ideas: notes.filter((n) => n.folder === "ideas").length };
    case "update_note": {
      const n = notes.find((x) => x.id === args.id);
      if (n) {
        Object.assign(n, args.patch);
        if (!("pinned" in args.patch) || Object.keys(args.patch).length > 1) n.updated_at = toIso(new Date());
      }
      emit("notes");
      return n;
    }
    case "create_note": {
      const n = note(args.input.title, args.input.folder ?? "personal", args.input.color ?? "violet", !!args.input.pinned, 0, args.input.body_md ?? "");
      notes.unshift(n);
      emit("notes");
      return n;
    }
    case "delete_note":
      notes.splice(notes.findIndex((n) => n.id === args.id), 1);
      emit("notes");
      return null;
    case "note_open_items_to_today":
      return [];
    case "list_comments":
      return comments.filter((c) => c.task_id === args.taskId);
    case "add_comment": {
      comments.push({ id: id(), task_id: args.taskId, body_md: args.bodyMd, created_at: toIso(new Date()), updated_at: toIso(new Date()) });
      emit("comments");
      return null;
    }
    case "update_comment":
    case "delete_comment":
      emit("comments");
      return null;
    case "render_markdown":
      return renderMd(String(args.md));
    case "ai_generate":
      await wait(1400);
      return sample[args.kind as "task" | "note"];
    case "ai_refine":
      await wait(900);
      return sample[args.kind as "task" | "note"];
    case "ai_improve_markdown":
      await wait(900);
      return "### Improved\n\n- [ ] first item\n- [ ] second item";
    case "ai_test_connection":
      await wait(800);
      return null;
    case "list_shots": {
      const q = String(args.query ?? "").toLowerCase();
      return shots.filter((x) => !q || (x.title + " " + x.ocr_text + " " + x.app + " " + (x.tag ?? "")).toLowerCase().includes(q)).sort((a, b) => b.taken_at.localeCompare(a.taken_at));
    }
    case "get_shot":
      return shots.find((x) => x.id === args.id) ?? shots[0];
    case "update_shot": {
      const x = shots.find((y) => y.id === args.id);
      if (x) {
        const p = args.patch as Record<string, any>;
        if ("title" in p) x.title = p.title;
        if ("tag" in p) x.tag = p.tag;
        if ("task_id" in p) {
          const t = tasks.find((z) => z.id === p.task_id);
          x.task = t ? { id: t.id, label: "TASK-" + t.seq + " \u00b7 " + t.title } : null;
        }
        if ("note_id" in p) {
          const n = notes.find((z) => z.id === p.note_id);
          x.note = n ? { id: n.id, label: n.title } : null;
          if (n) x.task = null;
        }
      }
      emit("shots");
      return x;
    }
    case "delete_shot":
      shots.splice(shots.findIndex((x) => x.id === args.id), 1);
      emit("shots");
      return null;
    case "read_shot_bytes": {
      const x = shots.find((y) => y.id === args.id) ?? shots[0];
      const img = new Image();
      img.src = x.thumb;
      await img.decode();
      const cv = document.createElement("canvas");
      cv.width = 1600;
      cv.height = 1000;
      cv.getContext("2d")?.drawImage(img, 0, 0, 1600, 1000);
      const blob: Blob = await new Promise((res) => cv.toBlob((b) => res(b as Blob), "image/png"));
      return blob.arrayBuffer();
    }
    case "capture_info":
      return { width: 4480, height: 1800, mode: "area", src: art("desktop", 0), monitor: { x: 1920, y: 0, w: 2560, h: 1440 }, index: 1, count: 2, primary: 1, remembered: null };
    case "save_shot_image":
    case "copy_png_bytes":
    case "copy_shot_image":
    case "reveal_shot":
    case "request_attach":
    case "focus_main_window":
    case "overlay_ready":
    case "open_capture_settings":
    case "finish_capture":
    case "cancel_capture":
    case "start_capture":
      return null;
    case "open_shot_editor":
      window.open(`/?view=shot&id=${args.id}`, "_blank");
      return null;
    case "open_task_window":
      window.open(`/?view=task&id=${args.id}`, "_blank");
      return null;
    default:
      return null;
  }
}
