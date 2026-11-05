import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { assetUrl, call, errorMessage } from "../lib/ipc";
import type { CaptureInfo, CaptureMode } from "../lib/types";

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

type DragKind = "new" | "move" | "tl" | "tr" | "bl" | "br";

const DELAYS = [0, 3, 5];

function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function save(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    return;
  }
}

const norm = (a: { x: number; y: number }, b: { x: number; y: number }): Box => ({
  x: Math.min(a.x, b.x),
  y: Math.min(a.y, b.y),
  w: Math.abs(a.x - b.x),
  h: Math.abs(a.y - b.y),
});

function ModeIcon({ mode }: { mode: CaptureMode }) {
  const common = { viewBox: "0 0 24 24", width: 16, height: 16, "aria-hidden": true, style: { fill: "none", stroke: "currentColor", strokeWidth: 1.9, strokeLinecap: "round", strokeLinejoin: "round" } as const };
  if (mode === "area")
    return (
      <svg {...common}>
        <path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3" />
      </svg>
    );
  if (mode === "window")
    return (
      <svg {...common}>
        <rect x="3" y="5" width="18" height="14" rx="2" />
        <path d="M3 9h18" />
      </svg>
    );
  return (
    <svg {...common}>
      <rect x="3" y="4" width="18" height="12" rx="2" />
      <path d="M8 20h8M12 16v4" />
    </svg>
  );
}

export function CaptureOverlay() {
  const [info, setInfo] = useState<CaptureInfo | null>(null);
  const [mode, setMode] = useState<CaptureMode>(() => load<CaptureMode>("cap.mode", "area"));
  const [delay, setDelay] = useState<number>(() => load("cap.delay", 0));
  const [opts, setOpts] = useState<{ ocr: boolean; edit: boolean; remember: boolean }>(() => ({ remember: false, ...load("cap.opts", { ocr: true, edit: false }) }));
  const [box, setBox] = useState<Box | null>(() => {
    const o = { remember: false, ...load<{ remember?: boolean }>("cap.opts", {}) };
    const f = o.remember ? load<Box | null>("cap.area", null) : null;
    if (!f) return null;
    return { x: f.x * window.innerWidth, y: f.y * window.innerHeight, w: f.w * window.innerWidth, h: f.h * window.innerHeight };
  });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const drag = useRef<{ kind: DragKind; sx: number; sy: number; orig: Box } | null>(null);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void call<CaptureInfo>("capture_info")
      .then((i) => {
        setInfo(i);
        if (i.mode === "window") setMode("window");
      })
      .catch((e) => setError(errorMessage(e)));
  }, []);

  useEffect(() => save("cap.mode", mode), [mode]);
  useEffect(() => save("cap.delay", delay), [delay]);
  useEffect(() => save("cap.opts", opts), [opts]);
  useEffect(() => {
    if (!opts.remember) save("cap.area", null);
  }, [opts.remember]);

  const size = () => ({ w: window.innerWidth, h: window.innerHeight });
  const scale = useMemo(() => (info ? { x: info.width / window.innerWidth, y: info.height / window.innerHeight } : { x: 1, y: 1 }), [info]);

  const cancel = useCallback(() => void call("cancel_capture"), []);

  const capture = useCallback(async () => {
    if (!info || busy) return;
    setError("");
    try {
      if (mode === "window") {
        setBusy(true);
        await call("switch_to_window_capture");
        return;
      }
      if (mode === "area" && (!box || box.w < 8 || box.h < 8)) {
        setError("Drag to select an area first.");
        return;
      }
      if (opts.remember && mode === "area" && box) {
        const { w: W, h: H } = size();
        save("cap.area", { x: box.x / W, y: box.y / H, w: box.w / W, h: box.h / H });
      }
      setBusy(true);
      const rect = mode === "area" && box ? { x: box.x * scale.x, y: box.y * scale.y, w: box.w * scale.x, h: box.h * scale.y } : null;
      await call("finish_capture", { req: { mode, rect, delay, ocr: opts.ocr, edit: opts.edit } });
    } catch (e) {
      setBusy(false);
      setError(errorMessage(e));
    }
  }, [info, busy, mode, box, scale, delay, opts]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        cancel();
      } else if (e.key === "Enter") {
        e.preventDefault();
        void capture();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [cancel, capture]);

  const begin = (e: React.PointerEvent, kind: DragKind) => {
    if (mode !== "area" || busy) return;
    e.stopPropagation();
    (root.current as HTMLDivElement).setPointerCapture(e.pointerId);
    drag.current = { kind, sx: e.clientX, sy: e.clientY, orig: box ?? { x: e.clientX, y: e.clientY, w: 0, h: 0 } };
  };

  const onDown = (e: React.PointerEvent) => {
    if (mode !== "area" || busy || (e.target as HTMLElement).closest("[role=toolbar]")) return;
    setError("");
    begin(e, "new");
    setBox({ x: e.clientX, y: e.clientY, w: 0, h: 0 });
  };

  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const { w: W, h: H } = size();
    const dx = e.clientX - d.sx;
    const dy = e.clientY - d.sy;
    const o = d.orig;
    if (d.kind === "new") setBox(norm({ x: d.sx, y: d.sy }, { x: Math.max(0, Math.min(W, e.clientX)), y: Math.max(0, Math.min(H, e.clientY)) }));
    else if (d.kind === "move") setBox({ ...o, x: Math.max(0, Math.min(W - o.w, o.x + dx)), y: Math.max(0, Math.min(H - o.h, o.y + dy)) });
    else {
      const fx = d.kind === "tl" || d.kind === "bl" ? o.x + o.w : o.x;
      const fy = d.kind === "tl" || d.kind === "tr" ? o.y + o.h : o.y;
      const cx = d.kind === "tl" || d.kind === "bl" ? o.x + dx : o.x + o.w + dx;
      const cy = d.kind === "tl" || d.kind === "tr" ? o.y + dy : o.y + o.h + dy;
      setBox(norm({ x: fx, y: fy }, { x: Math.max(0, Math.min(W, cx)), y: Math.max(0, Math.min(H, cy)) }));
    }
  };

  const onUp = () => {
    drag.current = null;
    setBox((b) => (b && (b.w < 4 || b.h < 4) ? null : b));
  };

  const shown: Box | null = mode === "screen" ? { x: 3, y: 3, w: window.innerWidth - 6, h: window.innerHeight - 6 } : mode === "area" ? box : null;
  const label = !info
    ? ""
    : mode === "screen"
      ? `${info.width} × ${info.height}`
      : shown
        ? `${Math.round(shown.w * scale.x)} × ${Math.round(shown.h * scale.y)}`
        : "";

  return (
    <div ref={root} className="cap-root" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp}>
      {info && <img className="cap-img" src={assetUrl(info.src)} alt="" draggable={false} />}
      {!shown && <div className="cap-dim" />}
      {mode === "window" && (
        <div className="cap-hint">Your desktop will show a window picker. Choose the window to capture.</div>
      )}
      {mode === "area" && !box && <div className="cap-hint">Drag to select an area</div>}

      {shown && (
        <div className="cap-box" style={{ left: shown.x, top: shown.y, width: shown.w, height: shown.h }} onPointerDown={(e) => begin(e, "move")}>
          <div className="cap-label">
            <span className="cap-size">{label}</span>
          </div>
          {mode === "area" && (
            <>
              {(["tl", "tr", "bl", "br"] as const).map((k) => (
                <span
                  key={k}
                  className={`cap-handle ${k}`}
                  onPointerDown={(e) => begin(e, k)}
                />
              ))}
              <span className="cap-grid v1" />
              <span className="cap-grid v2" />
              <span className="cap-grid h1" />
              <span className="cap-grid h2" />
            </>
          )}
        </div>
      )}

      <div role="toolbar" aria-label="Screenshot" className="cap-bar">
        <div role="group" aria-label="Capture mode" className="cap-seg">
          {(["area", "window", "screen"] as const).map((m) => (
            <button key={m} type="button" className={mode === m ? "is-on" : ""} aria-pressed={mode === m} onClick={() => setMode(m)}>
              <ModeIcon mode={m} />
              {m === "area" ? "Area" : m === "window" ? "Window" : "Screen"}
            </button>
          ))}
        </div>
        <div className="cap-div" aria-hidden="true" />
        <button type="button" className="cap-opt" onClick={() => setDelay(DELAYS[(DELAYS.indexOf(delay) + 1) % DELAYS.length])}>
          <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" style={{ fill: "none", stroke: "currentColor", strokeWidth: 1.9, strokeLinecap: "round" }}>
            <circle cx="12" cy="13" r="8" />
            <path d="M12 9v4l2.5 2M9 2h6" />
          </svg>
          {delay ? `Delay ${delay}s` : "No delay"}
        </button>
        {(
          [
            ["ocr", "Read text (OCR)"],
            ["edit", "Open editor after"],
            ["remember", "Remember area"],
          ] as const
        ).map(([k, label]) => (
          <button key={k} type="button" className={`cap-opt${opts[k] ? " is-on" : ""}`} aria-pressed={opts[k]} onClick={() => setOpts({ ...opts, [k]: !opts[k] })}>
            <span className="cap-box16" aria-hidden="true">
              {opts[k] && (
                <svg viewBox="0 0 24 24" width="11" height="11" style={{ fill: "none", stroke: "#fff", strokeWidth: 3.2, strokeLinecap: "round", strokeLinejoin: "round" }}>
                  <path d="M5 12.5l4.5 4.5L19 7.5" />
                </svg>
              )}
            </span>
            {label}
          </button>
        ))}
        <div className="cap-div" aria-hidden="true" />
        <button type="button" className="cap-cancel" onClick={cancel}>
          Cancel
          <kbd>Esc</kbd>
        </button>
        <button type="button" className="cap-go" disabled={busy} onClick={() => void capture()}>
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" style={{ fill: "none", stroke: "currentColor", strokeWidth: 1.9, strokeLinejoin: "round" }}>
            <path d="M4 8h3l2-3h6l2 3h3v11H4z" />
            <circle cx="12" cy="13" r="3.5" />
          </svg>
          {busy ? "Saving..." : "Capture"}
          <kbd>{"↵"}</kbd>
        </button>
      </div>
      {error && <div className="cap-error">{error}</div>}
    </div>
  );
}
