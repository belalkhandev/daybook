import { useRef, useState } from "react";
import { Icon } from "../components/Icon";
import { Markdown } from "../components/Markdown";
import { Modal } from "../components/Modal";
import { call, errorCode, errorMessage } from "../lib/ipc";
import { useUI } from "../lib/store";
import type { ItemKind, Note, NoteDraft, Task, TaskDraft } from "../lib/types";
import { FOLDER_LABEL, NOTE_DOT, PRIORITY, dueLabel, fmtTarget, localIso, toIso } from "../lib/util";

type Format = "brief" | "checklist" | "detailed";
type Phase = "compose" | "loading" | "result";
type Draft = TaskDraft | NoteDraft;

const FORMATS: { key: Format; label: string }[] = [
  { key: "brief", label: "Brief" },
  { key: "checklist", label: "Checklist" },
  { key: "detailed", label: "Detailed" },
];

const REFINES: { key: Format; label: string; instruction: string }[] = [
  { key: "brief", label: "Shorter", instruction: "Make it shorter. Keep only the essentials." },
  { key: "checklist", label: "As checklist", instruction: "Rewrite the markdown as a summary sentence followed by a checklist of steps." },
  { key: "detailed", label: "More detail", instruction: "Add more detail, context and notes while keeping every existing fact." },
];

const DEFAULT_FORMAT: Record<string, Format> = { brief: "brief", balanced: "checklist", detailed: "detailed" };
const PROVIDER_LABEL: Record<string, string> = { openai: "OpenAI", compatible: "OpenAI-compatible", local: "Ollama" };
const GRAY = "#9CA3AF";

function toDueIso(raw: string | null): string | null {
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return localIso(raw, null);
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : toIso(d);
}

export function AiModal({ initial }: { initial: ItemKind }) {
  const settings = useUI((s) => s.settings);
  const hasKey = useUI((s) => s.hasKey);
  const projects = useUI((s) => s.projects);
  const setModal = useUI((s) => s.setModal);
  const openSettings = useUI((s) => s.openSettings);
  const selectNote = useUI((s) => s.selectNote);
  const [kind, setKind] = useState<ItemKind>(initial);
  const [format, setFormat] = useState<Format>(DEFAULT_FORMAT[settings["ai.length"] || "balanced"] ?? "checklist");
  const [prompts, setPrompts] = useState<Record<ItemKind, string>>({ task: "", note: "" });
  const [phase, setPhase] = useState<Phase>("compose");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState("");
  const req = useRef<string | null>(null);
  const isTask = kind === "task";
  const provider = settings["ai.provider"] || "openai";
  const connected = provider === "local" || hasKey;
  const prompt = prompts[kind];

  const fail = (e: unknown) => {
    const code = errorCode(e);
    if (code === "cancelled") {
      setPhase("compose");
      return;
    }
    if (code === "missing_key") {
      openSettings("ai");
      return;
    }
    setError(errorMessage(e));
    setPhase("compose");
  };

  const run = async (fmt: Format, instruction?: string) => {
    if (!prompt.trim() && !instruction) {
      setError("Write a few words first.");
      return;
    }
    setError("");
    setPhase("loading");
    const id = crypto.randomUUID();
    req.current = id;
    try {
      const out = instruction
        ? await call<Draft>("ai_refine", { kind, draftJson: draft, instruction, requestId: id })
        : await call<Draft>("ai_generate", { kind, prompt, format: fmt, requestId: id });
      if (req.current !== id) return;
      setFormat(fmt);
      setDraft(out);
      setPhase("result");
    } catch (e) {
      if (req.current === id) fail(e);
    }
  };

  const cancel = () => {
    const id = req.current;
    req.current = null;
    if (id) void call("ai_cancel", { requestId: id });
    setPhase("compose");
  };

  const close = () => setModal(null);

  const save = async () => {
    if (!draft) return;
    try {
      if (isTask) {
        const d = draft as TaskDraft;
        await call<Task>("create_task", {
          input: {
            title: d.title.trim() || "Untitled task",
            description_md: d.markdown,
            priority: d.priority,
            project_id: projects.find((p) => p.name === d.project)?.id ?? null,
            due_at: toDueIso(d.due_at),
            target_minutes: d.target_minutes,
            tags: d.tags,
          },
        });
      } else {
        const d = draft as NoteDraft;
        const n = await call<Note>("create_note", {
          input: { title: d.title.trim() || "Untitled", body_md: d.markdown, folder: d.folder, color: d.color },
        });
        selectNote(n.id);
      }
      close();
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      if (phase === "loading") cancel();
      else close();
    } else if (e.key === "Enter" && e.ctrlKey && phase !== "loading") {
      e.preventDefault();
      if (phase === "compose") void run(format);
    }
  };

  const pills = (): { label: string; value: string; dot: string }[] => {
    if (!draft) return [];
    if (isTask) {
      const d = draft as TaskDraft;
      const proj = projects.find((p) => p.name === d.project);
      return [
        { label: "Project", value: d.project ?? "None", dot: proj?.color ?? GRAY },
        { label: "Priority", value: PRIORITY[d.priority].label, dot: PRIORITY[d.priority].dot },
        { label: "Due", value: dueLabel(toDueIso(d.due_at)), dot: GRAY },
        { label: "Target", value: d.target_minutes ? fmtTarget(d.target_minutes) : "None", dot: GRAY },
        { label: "Tags", value: d.tags.length ? d.tags.map((t) => `#${t}`).join(" ") : "None", dot: GRAY },
      ];
    }
    const d = draft as NoteDraft;
    return [
      { label: "Folder", value: FOLDER_LABEL[d.folder], dot: NOTE_DOT[d.color] },
      { label: "Color", value: d.color[0].toUpperCase() + d.color.slice(1), dot: NOTE_DOT[d.color] },
      { label: "Tags", value: d.tags.length ? d.tags.map((t) => `#${t}`).join(" ") : "None", dot: GRAY },
    ];
  };

  const sparkle = <Icon name="sparkles" size={16} />;

  return (
    <Modal onClose={phase === "loading" ? cancel : close} top={72} maxWidth={780} labelledBy="ai-title" onKeyDown={onKeyDown}>
      <div className="ai-head">
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div className="ai-mark" aria-hidden="true">
            <Icon name="sparkles" size={18} />
          </div>
          <h2 id="ai-title" style={{ fontSize: 17, fontWeight: 600, letterSpacing: "-0.01em" }}>
            Write with AI
          </h2>
          <div role="group" aria-label="Item type" className="seg">
            {(["task", "note"] as const).map((k) => (
              <button
                key={k}
                type="button"
                className={`seg-btn${kind === k ? " is-on" : ""}`}
                style={{ minHeight: 32, fontWeight: 600 }}
                aria-pressed={kind === k}
                onClick={() => {
                  setKind(k);
                  setPhase("compose");
                  setDraft(null);
                  setError("");
                }}
              >
                {k === "task" ? "Task" : "Note"}
              </button>
            ))}
          </div>
        </div>
        <button type="button" className="close-btn" aria-label="Close" onClick={phase === "loading" ? cancel : close}>
          <Icon name="close" size={16} />
        </button>
      </div>

      {phase === "compose" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16, padding: "20px 24px 22px" }}>
          <label htmlFor="ai-prompt" style={{ fontSize: 14, color: "var(--text-3)" }}>
            {isTask ? "Describe the task in your own words. AI fills in the details." : "Paste rough notes. AI turns them into a clean, formatted note."}
          </label>
          <textarea
            id="ai-prompt"
            className="ai-prompt"
            rows={4}
            autoFocus
            value={prompt}
            placeholder={isTask ? "e.g. call Rafi about the invoice tomorrow, high priority" : "e.g. meeting notes, ideas, a messy list..."}
            onChange={(e) => setPrompts({ ...prompts, [kind]: e.target.value })}
          />
          {error && <div className="error-banner">{error}</div>}
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: 13, color: "var(--text-3b)" }}>Format</span>
              <div role="group" aria-label="Output format" style={{ display: "flex", gap: 6 }}>
                {FORMATS.map((f) => (
                  <button key={f.key} type="button" className={`fmt-chip${format === f.key ? " is-on" : ""}`} aria-pressed={format === f.key} onClick={() => setFormat(f.key)}>
                    {f.label}
                  </button>
                ))}
              </div>
            </div>
            <button type="button" className="ai-gen" onClick={() => void run(format)}>
              {sparkle}
              Generate
              <kbd className="kbd-dark">Ctrl {"↵"}</kbd>
            </button>
          </div>
        </div>
      )}

      {phase === "loading" && (
        <div aria-live="polite" style={{ display: "flex", flexDirection: "column", gap: 16, padding: "22px 24px 26px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 14, color: "var(--text-3)" }}>
            <span aria-hidden="true" style={{ width: 10, height: 10, borderRadius: "50%", background: "var(--accent)", animation: "dbPulse 1s ease-in-out infinite" }} />
            Writing your {isTask ? "task" : "note"}...
          </div>
          <p style={{ padding: "12px 14px", borderRadius: 12, background: "rgba(22,22,29,0.035)", fontSize: 13, lineHeight: 1.5, color: "var(--muted)" }}>
            {"“"}
            {prompt || "Refining the draft"}
            {"”"}
          </p>
          <div aria-hidden="true" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div className="skel" style={{ height: 26, width: "58%", borderRadius: 8 }} />
            <div style={{ display: "flex", gap: 8 }}>
              {[120, 90, 110].map((w) => (
                <div key={w} className="skel" style={{ height: 30, width: w, borderRadius: 999 }} />
              ))}
            </div>
            {["92%", "80%", "66%"].map((w) => (
              <div key={w} className="skel" style={{ height: 14, width: w, borderRadius: 6 }} />
            ))}
          </div>
        </div>
      )}

      {phase === "result" && draft && (
        <div aria-live="polite" style={{ display: "flex", flexDirection: "column", gap: 16, padding: "20px 24px 22px" }}>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
            <span className="ai-badge">
              <Icon name="sparkles" size={13} sw={2} />
              AI draft · review before saving
            </span>
            <button type="button" className="btn-link-quiet" onClick={() => setPhase("compose")}>
              <Icon name="pencil" size={14} />
              Edit prompt
            </button>
          </div>
          <label htmlFor="ai-out-title" className="sr">
            Title
          </label>
          <input id="ai-out-title" className="ai-title-input" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {pills().map((p) => (
              <span key={p.label} className="prop-pill">
                <span className="k">{p.label}</span>
                <span className="dot" aria-hidden="true" style={{ background: p.dot }} />
                {p.value}
              </span>
            ))}
          </div>
          <div className="ai-out">
            <Markdown md={draft.markdown} className="md-compact" />
          </div>
          {error && <div className="error-banner">{error}</div>}
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              <button type="button" className="refine-btn" onClick={() => void run(format)}>
                <Icon name="refresh" size={14} />
                Regenerate
              </button>
              {REFINES.filter((r) => r.key !== format).map((r) => (
                <button key={r.key} type="button" className="refine-btn" onClick={() => void run(r.key, r.instruction)}>
                  {r.label}
                </button>
              ))}
            </div>
            <span style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--muted)" }}>Markdown · editable after saving</span>
          </div>
        </div>
      )}

      <div className="modal-foot">
        <button type="button" className="status-link" onClick={() => openSettings("ai")}>
          <span aria-hidden="true" style={{ width: 7, height: 7, borderRadius: "50%", background: connected ? "var(--st-done)" : GRAY }} />
          <span style={{ fontFamily: "var(--mono)" }}>{connected ? `${PROVIDER_LABEL[provider] ?? "AI"} connected` : "No key yet"}</span>
          <span style={{ color: "var(--accent-ink)" }}>· Settings</span>
        </button>
        <div style={{ display: "flex", gap: 8 }}>
          <button type="button" className="btn-ghost" onClick={() => setModal({ type: "quick", kind })}>
            Write manually
          </button>
          {phase === "result" && (
            <button type="button" className="btn-dark" onClick={() => void save()}>
              {isTask ? "Add task" : "Save note"}
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}
