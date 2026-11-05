import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Blobs } from "../components/Blobs";
import { Icon } from "../components/Icon";
import {
  bounds,
  cropBase,
  cropPreset,
  hit,
  render,
  resizeBase,
  scaleMark,
  translate,
  type Box,
  type Mark,
  type Snapshot,
  type Tool,
} from "../lib/annotate";
import { callBytes, call, callRaw, errorMessage, win } from "../lib/ipc";
import { applyAppearance, useUI } from "../lib/store";
import type { Shot } from "../lib/types";

const TOOLS: { key: Tool; label: string; k: string; d: string; gap?: boolean }[] = [
  { key: "select", label: "Select", k: "V", d: "M5 3l14 8-6 2-2 6z" },
  { key: "crop", label: "Crop", k: "C", d: "M6 2v14a2 2 0 0 0 2 2h14M2 6h14a2 2 0 0 1 2 2v14" },
  { key: "resize", label: "Resize", k: "R", d: "M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" },
  { key: "pen", label: "Pen", k: "P", d: "M4 20h4L19 9l-4-4L4 16z", gap: true },
  { key: "highlight", label: "Highlighter", k: "H", d: "M9 11l-6 6v3h9l3-3M22 12l-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4" },
  { key: "arrow", label: "Arrow", k: "A", d: "M5 19L19 5M9 5h10v10" },
  { key: "rect", label: "Rectangle", k: "B", d: "M6 5h12a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z" },
  { key: "text", label: "Text", k: "T", d: "M5 6V4h14v2M12 4v16M9 20h6" },
  { key: "blur", label: "Blur", k: "X", d: "M4 4h4v4H4zM10 10h4v4h-4zM16 4h4v4h-4zM4 16h4v4H4zM16 16h4v4h-4z" },
];

const DRAW: Tool[] = ["pen", "highlight", "arrow", "rect", "text", "blur"];
const COLORS = [
  { name: "Orange", hex: "#EA580C" },
  { name: "Indigo", hex: "#6366F1" },
  { name: "Green", hex: "#10B981" },
  { name: "Yellow", hex: "#FCD34D" },
  { name: "Black", hex: "#16161D" },
  { name: "White", hex: "#FFFFFF" },
];
const SIZES = [
  { name: "Thin", dot: 6 },
  { name: "Medium", dot: 10 },
  { name: "Thick", dot: 15 },
];
const ASPECTS = ["free", "16:9", "4:3", "1:1"];
const SCALES = [25, 50, 75, 100];

type Drag =
  | { k: "draw"; mark: Mark }
  | { k: "move"; id: number; sx: number; sy: number; orig: Mark[] }
  | { k: "handle"; id: number; corner: string; orig: Mark }
  | { k: "crop"; corner: string; orig: Box; sx: number; sy: number };

let nextId = 1;

const blankMark = (t: Mark["t"], color: string, size: number, x: number, y: number): Mark => ({
  id: nextId++,
  t,
  color,
  size,
  x,
  y,
  w: 0,
  h: 0,
  x2: x,
  y2: y,
  pts: [[x, y]],
  text: "",
});

async function loadBase(id: string): Promise<HTMLCanvasElement> {
  const buf = await callBytes("read_shot_bytes", { id });
  const bmp = await createImageBitmap(new Blob([buf], { type: "image/png" }));
  const c = document.createElement("canvas");
  c.width = bmp.width;
  c.height = bmp.height;
  c.getContext("2d")?.drawImage(bmp, 0, 0);
  return c;
}

const toBlob = (c: HTMLCanvasElement) => new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("Couldn't encode the image"))), "image/png"));

export function ShotEditor({ id }: { id: string }) {
  const settings = useUI((s) => s.settings);
  const [shot, setShot] = useState<Shot | null>(null);
  const [stack, setStack] = useState<Snapshot[]>([]);
  const [idx, setIdx] = useState(0);
  const [tool, setTool] = useState<Tool>("arrow");
  const [color, setColor] = useState("#EA580C");
  const [size, setSize] = useState(1);
  const [zoom, setZoom] = useState(100);
  const [aspect, setAspect] = useState("free");
  const [crop, setCrop] = useState<Box | null>(null);
  const [rw, setRw] = useState("");
  const [rh, setRh] = useState("");
  const [keep, setKeep] = useState(true);
  const [sel, setSel] = useState<number | null>(null);
  const [live, setLive] = useState<Mark[] | null>(null);
  const [draft, setDraft] = useState<Mark | null>(null);
  const [textAt, setTextAt] = useState<{ x: number; y: number } | null>(null);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const canvas = useRef<HTMLCanvasElement>(null);
  const surface = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const edited = useRef(false);

  useEffect(() => {
    void useUI.getState().loadSettings();
    void call<Shot>("get_shot", { id }).then(setShot);
    void loadBase(id)
      .then((base) => setStack([{ base, marks: [] }]))
      .catch((e) => setError(errorMessage(e)));
  }, [id]);
  useEffect(() => applyAppearance(settings), [settings]);

  const cur = stack[idx];
  const marks = live ?? cur?.marks ?? [];
  const iw = cur?.base.width ?? 1;
  const ih = cur?.base.height ?? 1;

  const commit = useCallback(
    (snap: Snapshot) => {
      setStack((s) => [...s.slice(0, idx + 1), snap]);
      setIdx((i) => i + 1);
      edited.current = true;
    },
    [idx],
  );

  const commitMarks = useCallback((next: Mark[]) => cur && commit({ base: cur.base, marks: next }), [cur, commit]);

  useEffect(() => {
    const c = canvas.current;
    if (!c || !cur) return;
    c.width = cur.base.width;
    c.height = cur.base.height;
    const ctx = c.getContext("2d");
    if (ctx) render(ctx, { base: cur.base, marks }, draft ? [draft] : []);
  }, [cur, marks, draft]);

  useEffect(() => {
    if (tool === "crop" && cur) setCrop(cropPreset(aspect, cur.base.width, cur.base.height));
    if (tool === "resize" && cur) {
      setRw(String(cur.base.width));
      setRh(String(cur.base.height));
    }
    if (tool !== "select") setSel(null);
    setTextAt(null);
  }, [tool, aspect, cur]);

  const undo = useCallback(() => {
    setIdx((i) => Math.max(0, i - 1));
    setSel(null);
  }, []);
  const redo = useCallback(() => {
    setIdx((i) => Math.min(stack.length - 1, i + 1));
    setSel(null);
  }, [stack.length]);

  const point = (e: React.PointerEvent) => {
    const r = (canvas.current as HTMLCanvasElement).getBoundingClientRect();
    return { x: ((e.clientX - r.left) * iw) / r.width, y: ((e.clientY - r.top) * ih) / r.height, k: iw / r.width };
  };

  const onDown = (e: React.PointerEvent) => {
    if (!cur || textAt) return;
    const p = point(e);
    (surface.current as HTMLDivElement).setPointerCapture(e.pointerId);
    if (tool === "select") {
      const found = [...cur.marks].reverse().find((m) => hit(m, p.x, p.y, 10 * p.k, iw));
      setSel(found?.id ?? null);
      if (found) {
        drag.current = { k: "move", id: found.id, sx: p.x, sy: p.y, orig: cur.marks };
        setLive(cur.marks);
      }
    } else if (tool === "text") {
      setTextAt({ x: p.x, y: p.y });
    } else if (DRAW.includes(tool)) {
      const m = blankMark(tool as Mark["t"], color, size, p.x, p.y);
      drag.current = { k: "draw", mark: m };
      setDraft(m);
    }
  };

  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || !cur) return;
    const p = point(e);
    if (d.k === "draw") {
      const m = { ...d.mark };
      if (m.t === "pen") m.pts = [...m.pts, [p.x, p.y]];
      else {
        m.w = p.x - m.x;
        m.h = p.y - m.y;
        m.x2 = p.x;
        m.y2 = p.y;
      }
      d.mark = m;
      setDraft(m);
    } else if (d.k === "move") {
      setLive(d.orig.map((m) => (m.id === d.id ? translate(m, p.x - d.sx, p.y - d.sy) : m)));
    } else if (d.k === "handle") {
      const o = d.orig;
      const next: Mark = { ...o };
      if (o.t === "arrow") {
        if (d.corner === "a") {
          next.x = p.x;
          next.y = p.y;
        } else {
          next.x2 = p.x;
          next.y2 = p.y;
        }
      } else {
        const b = bounds(o, iw);
        const left = d.corner.includes("l");
        const top = d.corner.includes("t");
        const fx = left ? b.x + b.w : b.x;
        const fy = top ? b.y + b.h : b.y;
        next.x = fx;
        next.y = fy;
        next.w = p.x - fx;
        next.h = p.y - fy;
      }
      setLive(cur.marks.map((m) => (m.id === d.id ? next : m)));
    } else if (d.k === "crop") {
      const o = d.orig;
      const dx = p.x - d.sx;
      const dy = p.y - d.sy;
      let b: Box;
      if (d.corner === "move") b = { ...o, x: Math.max(0, Math.min(iw - o.w, o.x + dx)), y: Math.max(0, Math.min(ih - o.h, o.y + dy)) };
      else {
        const left = d.corner.includes("l");
        const top = d.corner.includes("t");
        const fx = left ? o.x + o.w : o.x;
        const fy = top ? o.y + o.h : o.y;
        let cx = Math.max(0, Math.min(iw, left ? o.x + dx : o.x + o.w + dx));
        let cy = Math.max(0, Math.min(ih, top ? o.y + dy : o.y + o.h + dy));
        if (aspect !== "free") {
          const [a, bb] = aspect.split(":").map(Number);
          const r = a / bb;
          const w = Math.abs(cx - fx);
          const h = w / r;
          cy = top ? fy - h : fy + h;
          if (cy < 0 || cy > ih) {
            cy = Math.max(0, Math.min(ih, cy));
            cx = left ? fx - Math.abs(cy - fy) * r : fx + Math.abs(cy - fy) * r;
          }
        }
        b = { x: Math.min(fx, cx), y: Math.min(fy, cy), w: Math.abs(cx - fx), h: Math.abs(cy - fy) };
      }
      setCrop(b);
    }
  };

  const onUp = () => {
    const d = drag.current;
    drag.current = null;
    if (!d || !cur) return;
    if (d.k === "draw") {
      const m = d.mark;
      const big = m.t === "pen" ? m.pts.length > 1 : Math.hypot(m.x2 - m.x, m.y2 - m.y) > 6;
      setDraft(null);
      if (big) {
        commitMarks([...cur.marks, m]);
        if (m.t !== "pen") setSel(null);
      }
    } else if ((d.k === "move" || d.k === "handle") && live) {
      commitMarks(live);
      setLive(null);
    }
  };

  const startHandle = (e: React.PointerEvent, corner: string) => {
    if (!cur || sel === null) return;
    e.stopPropagation();
    const m = cur.marks.find((x) => x.id === sel);
    if (!m) return;
    (surface.current as HTMLDivElement).setPointerCapture(e.pointerId);
    drag.current = { k: "handle", id: sel, corner, orig: m };
    setLive(cur.marks);
  };

  const startCrop = (e: React.PointerEvent, corner: string) => {
    if (!crop) return;
    e.stopPropagation();
    const p = point(e);
    (surface.current as HTMLDivElement).setPointerCapture(e.pointerId);
    drag.current = { k: "crop", corner, orig: crop, sx: p.x, sy: p.y };
  };

  const commitText = (value: string) => {
    const at = textAt;
    setTextAt(null);
    const v = value.trim();
    if (!at || !v || !cur) return;
    const m = { ...blankMark("text", color, size, at.x, at.y), text: v };
    commitMarks([...cur.marks, m]);
  };

  const applyCrop = () => {
    if (!cur || !crop || crop.w < 4 || crop.h < 4) return;
    const base = cropBase(cur.base, crop);
    commit({ base, marks: cur.marks.map((m) => translate(m, -Math.round(crop.x), -Math.round(crop.y))) });
    setTool("select");
  };

  const applyResize = () => {
    if (!cur) return;
    const w = parseInt(rw, 10);
    const h = parseInt(rh, 10);
    if (!(w > 0 && h > 0)) return;
    commit({ base: resizeBase(cur.base, w, h), marks: cur.marks.map((m) => scaleMark(m, w / cur.base.width, h / cur.base.height)) });
    setTool("select");
  };

  const flatten = useCallback(async () => {
    if (!cur) throw new Error("Nothing to save");
    const c = document.createElement("canvas");
    c.width = cur.base.width;
    c.height = cur.base.height;
    const ctx = c.getContext("2d");
    if (ctx) render(ctx, cur);
    return toBlob(c);
  }, [cur]);

  const flash = (t: string) => {
    setStatus(t);
    setTimeout(() => setStatus(""), 2000);
  };

  const save = async (asCopy: boolean) => {
    try {
      const blob = await flatten();
      const bytes = new Uint8Array(await blob.arrayBuffer());
      await callRaw("save_shot_image", bytes, { "x-shot-id": id, "x-as-copy": asCopy ? "1" : "0" });
      if (!asCopy) edited.current = false;
      flash(asCopy ? "Saved as a copy" : "Saved");
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const copy = async () => {
    try {
      const blob = await flatten();
      try {
        await callRaw("copy_png_bytes", new Uint8Array(await blob.arrayBuffer()), {});
      } catch {
        await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      }
      flash("Copied");
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.closest?.("input, textarea, select")) return;
      const k = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && k === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if ((e.ctrlKey || e.metaKey) && k === "y") {
        e.preventDefault();
        redo();
      } else if ((e.ctrlKey || e.metaKey) && k === "s") {
        e.preventDefault();
        void save(false);
      } else if ((k === "delete" || k === "backspace") && sel !== null && cur) {
        e.preventDefault();
        commitMarks(cur.marks.filter((m) => m.id !== sel));
        setSel(null);
      } else if (k === "escape") {
        setSel(null);
        setTextAt(null);
        if (tool === "crop" || tool === "resize") setTool("select");
      } else if (!e.ctrlKey && !e.metaKey && !e.altKey) {
        const t = TOOLS.find((x) => x.k.toLowerCase() === k);
        if (t) setTool(t.key);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const selMark = useMemo(() => (cur && sel !== null ? marks.find((m) => m.id === sel) ?? null : null), [cur, sel, marks]);
  const pct = (v: number, total: number) => `${(v / total) * 100}%`;
  const boxStyle = (b: Box) => ({ left: pct(b.x, iw), top: pct(b.y, ih), width: pct(b.w, iw), height: pct(b.h, ih) });
  const dims = cur ? `${cur.base.width} × ${cur.base.height}` : "";
  const toolName = TOOLS.find((t) => t.key === tool)?.label ?? "";
  const pill = (on: boolean) => (on ? "opt-pill is-on" : "opt-pill");
  const handleBox = selMark && selMark.t !== "pen" && selMark.t !== "text" ? bounds(selMark, iw) : null;

  return (
    <div className="app" style={{ minHeight: "100vh" }}>
      <Blobs variant="editor" />
      <div className="page editor-page">
        <header className="glass ed-head" data-tauri-drag-region>
          <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }} data-tauri-drag-region>
            <button type="button" className="back-btn" onClick={() => void call("focus_main_window", { view: "shots" })}>
              <Icon name="arrowLeft" size={15} sw={2} />
              Shots
            </button>
            <div style={{ minWidth: 0, display: "flex", flexDirection: "column" }} data-tauri-drag-region>
              <span style={{ fontSize: 14, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} data-tauri-drag-region>
                {shot?.title ?? ""}
              </span>
              <span style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--muted)" }} data-tauri-drag-region>
                {status || `${dims} · PNG · ${idx > 0 ? "edited" : "original"}`}
              </span>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }} data-tauri-drag-region>
            <div className="ed-group">
              <button type="button" aria-label="Undo" title="Undo (Ctrl Z)" disabled={idx === 0} onClick={undo}>
                <Icon name="undo" size={16} sw={2} />
              </button>
              <button type="button" aria-label="Redo" title="Redo (Ctrl Shift Z)" disabled={idx >= stack.length - 1} onClick={redo}>
                <Icon name="redo" size={16} sw={2} />
              </button>
            </div>
            <div className="ed-group">
              <button type="button" aria-label="Zoom out" style={{ fontSize: 18 }} onClick={() => setZoom((z) => Math.max(50, z - 10))}>
                {"−"}
              </button>
              <span className="zoom-label">{zoom}%</span>
              <button type="button" aria-label="Zoom in" style={{ fontSize: 18 }} onClick={() => setZoom((z) => Math.min(150, z + 10))}>
                +
              </button>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }} data-tauri-drag-region>
            <button type="button" className="ed-outline" onClick={() => void copy()}>
              Copy
            </button>
            <button type="button" className="ed-outline" onClick={() => void save(true)}>
              Save as copy
            </button>
            <button type="button" className="ed-save" onClick={() => void save(false)}>
              Save
            </button>
            <div className="divider-v" aria-hidden="true" style={{ margin: "0 2px" }} data-tauri-drag-region />
            <button type="button" className="win-btn" aria-label="Close window" onClick={() => void win.close()}>
              <Icon name="close" size={14} />
            </button>
          </div>
        </header>

        {error && <div className="error-banner">{error}</div>}

        <div className="ed-stage">
          <div className="ed-canvas-wrap" style={{ width: `${Math.round((1000 * zoom) / 100)}px`, aspectRatio: `${iw} / ${ih}` }}>
            <canvas ref={canvas} role="img" aria-label="Screenshot being edited" style={{ display: "block", width: "100%", height: "100%" }} />
            <div
              ref={surface}
              className={`ed-surface tool-${tool}`}
              onPointerDown={onDown}
              onPointerMove={onMove}
              onPointerUp={onUp}
            >
              {handleBox && selMark && (
                <div className="sel-box" style={boxStyle(handleBox)}>
                  {selMark.t === "arrow" ? (
                    <>
                      <span className="sel-h" style={{ left: pct(selMark.x - handleBox.x, handleBox.w || 1), top: pct(selMark.y - handleBox.y, handleBox.h || 1) }} onPointerDown={(e) => startHandle(e, "a")} />
                      <span className="sel-h" style={{ left: pct(selMark.x2 - handleBox.x, handleBox.w || 1), top: pct(selMark.y2 - handleBox.y, handleBox.h || 1) }} onPointerDown={(e) => startHandle(e, "b")} />
                    </>
                  ) : (
                    (["tl", "tr", "bl", "br"] as const).map((c) => <span key={c} className={`sel-h ${c}`} onPointerDown={(e) => startHandle(e, c)} />)
                  )}
                </div>
              )}
              {selMark && (selMark.t === "pen" || selMark.t === "text") && <div className="sel-box" style={boxStyle(bounds(selMark, iw))} />}
              {tool === "crop" && crop && (
                <div className="crop-box" style={boxStyle(crop)} onPointerDown={(e) => startCrop(e, "move")}>
                  <span className="g v1" />
                  <span className="g v2" />
                  <span className="g h1" />
                  <span className="g h2" />
                  {(["tl", "tr", "bl", "br"] as const).map((c) => (
                    <span key={c} className={`crop-c ${c}`} onPointerDown={(e) => startCrop(e, c)} />
                  ))}
                </div>
              )}
              {textAt && (
                <input
                  autoFocus
                  className="text-input"
                  placeholder="Type, then Enter"
                  style={{ left: pct(textAt.x, iw), top: pct(textAt.y, ih), borderColor: color }}
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === "Enter") commitText((e.target as HTMLInputElement).value);
                    if (e.key === "Escape") setTextAt(null);
                  }}
                  onBlur={(e) => commitText(e.target.value)}
                />
              )}
            </div>
          </div>
        </div>

        <div className="ed-tools-col">
          <div className="glass-strong ed-options">
            <span style={{ fontSize: 13, fontWeight: 600 }}>{toolName}</span>
            <div className="opt-div" aria-hidden="true" />
            {tool === "crop" && crop && (
              <>
                <div role="group" aria-label="Aspect ratio" style={{ display: "flex", gap: 4 }}>
                  {ASPECTS.map((a) => (
                    <button key={a} type="button" className={pill(aspect === a)} aria-pressed={aspect === a} onClick={() => setAspect(a)}>
                      {a === "free" ? "Free" : a}
                    </button>
                  ))}
                </div>
                <span style={{ fontFamily: "var(--mono)", fontSize: 12, color: "var(--text-3b)" }}>
                  {Math.round(crop.w)} {"×"} {Math.round(crop.h)}
                </span>
                <button type="button" className="opt-plain" onClick={() => setTool("select")}>
                  Cancel
                </button>
                <button type="button" className="opt-apply" onClick={applyCrop}>
                  Apply crop
                </button>
              </>
            )}
            {tool === "resize" && cur && (
              <>
                <label className="dim-field">
                  W
                  <input
                    type="text"
                    value={rw}
                    onChange={(e) => {
                      setRw(e.target.value);
                      const v = parseInt(e.target.value, 10);
                      if (keep && v > 0) setRh(String(Math.round((v * cur.base.height) / cur.base.width)));
                    }}
                  />
                </label>
                <button type="button" aria-label="Keep aspect ratio" aria-pressed={keep} className={`keep-btn${keep ? " is-on" : ""}`} onClick={() => setKeep(!keep)}>
                  <Icon name="link" size={15} sw={2} />
                </button>
                <label className="dim-field">
                  H
                  <input
                    type="text"
                    value={rh}
                    onChange={(e) => {
                      setRh(e.target.value);
                      const v = parseInt(e.target.value, 10);
                      if (keep && v > 0) setRw(String(Math.round((v * cur.base.width) / cur.base.height)));
                    }}
                  />
                </label>
                <div role="group" aria-label="Scale" style={{ display: "flex", gap: 4 }}>
                  {SCALES.map((p) => (
                    <button
                      key={p}
                      type="button"
                      className={pill(rw === String(Math.round((cur.base.width * p) / 100)))}
                      onClick={() => {
                        setRw(String(Math.round((cur.base.width * p) / 100)));
                        setRh(String(Math.round((cur.base.height * p) / 100)));
                      }}
                    >
                      {p}%
                    </button>
                  ))}
                </div>
                <button type="button" className="opt-apply" onClick={applyResize}>
                  Apply
                </button>
              </>
            )}
            {DRAW.includes(tool) && (
              <>
                <div role="group" aria-label="Colour" style={{ display: "flex", gap: 6 }}>
                  {COLORS.map((c) => (
                    <button
                      key={c.hex}
                      type="button"
                      aria-label={c.name}
                      aria-pressed={color === c.hex}
                      className="color-dot"
                      style={{ background: c.hex, boxShadow: color === c.hex ? "0 0 0 2px #16161D" : "0 0 0 1px rgba(22,22,29,0.18)" }}
                      onClick={() => setColor(c.hex)}
                    />
                  ))}
                </div>
                <div className="opt-div" aria-hidden="true" />
                <div role="group" aria-label="Size" style={{ display: "flex", gap: 4 }}>
                  {SIZES.map((z, i) => (
                    <button key={z.name} type="button" aria-label={z.name} aria-pressed={size === i} className={`size-btn${size === i ? " is-on" : ""}`} onClick={() => setSize(i)}>
                      <span aria-hidden="true" style={{ borderRadius: "50%", background: "currentColor", width: z.dot, height: z.dot }} />
                    </button>
                  ))}
                </div>
              </>
            )}
            {tool === "select" && <span style={{ fontSize: 13, color: "var(--text-3b)" }}>Click a mark to move, resize or delete it</span>}
          </div>

          <div role="toolbar" aria-label="Editing tools" className="glass-strong ed-toolbar">
            {TOOLS.map((t) => (
              <span key={t.key} style={{ display: "contents" }}>
                {t.gap && <span aria-hidden="true" className="tool-gap" />}
                <button type="button" aria-label={t.label} title={`${t.label} (${t.k})`} aria-pressed={tool === t.key} className={`tool-btn${tool === t.key ? " is-on" : ""}`} onClick={() => setTool(t.key)}>
                  <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" style={{ fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round" }}>
                    <path d={t.d} />
                  </svg>
                </button>
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
