import { emit } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useCallback, useEffect, useRef, useState } from "react";
import { assetUrl, call, errorMessage, inTauri, onEvent } from "../lib/ipc";
import type { CaptureInfo, CaptureMode } from "../lib/types";

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

type DragKind = "new" | "move" | "tl" | "tr" | "bl" | "br";

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

const MIN = 8;

export function CaptureOverlay({ index }: { index: number }) {
  const [info, setInfo] = useState<CaptureInfo | null>(null);
  const [mode, setMode] = useState<CaptureMode>("area");
  const [active, setActive] = useState(false);
  const [sel, setSel] = useState<Box | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [, setTick] = useState(0);
  const drag = useRef<{ kind: DragKind; sx: number; sy: number; orig: Box } | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const activeRef = useRef(false);

  const W = window.innerWidth;
  const H = window.innerHeight;
  const toPx = (b: Box): Box => ({ x: b.x * W, y: b.y * H, w: b.w * W, h: b.h * H });
  const toFrac = (b: Box): Box => ({ x: b.x / W, y: b.y / H, w: b.w / W, h: b.h / H });
  const box = sel ? toPx(sel) : null;

  useEffect(() => {
    let alive = true;
    const fetchInfo = () => {
      call<CaptureInfo>("capture_info", { index })
        .then((i) => {
          if (!alive) return;
          setInfo(i);
          const first = i.index === i.primary;
          activeRef.current = first;
          setActive(first);
          if (first && i.remembered) setSel(i.remembered);
          if (i.mode === "screen") setMode("screen");
        })
        .catch(() => undefined);
    };
    const offReady = onEvent("capture-ready", fetchInfo);
    const offActive = onEvent<number>("cap-active", (i) => {
      const mine = i === index;
      if (!mine && activeRef.current) setSel(null);
      activeRef.current = mine;
      setActive(mine);
    });
    const offMode = onEvent<CaptureMode>("cap-mode", (m) => setMode(m));
    const onResize = () => setTick((t) => t + 1);
    window.addEventListener("resize", onResize);
    fetchInfo();
    return () => {
      alive = false;
      offReady();
      offActive();
      offMode();
      window.removeEventListener("resize", onResize);
    };
  }, [index]);

  const activate = useCallback(() => {
    if (activeRef.current) return;
    activeRef.current = true;
    setActive(true);
    setSel(null);
    if (inTauri) {
      void emit("cap-active", index);
      void getCurrentWindow().setFocus();
    }
  }, [index]);

  const changeMode = (m: CaptureMode) => {
    setMode(m);
    setSel(null);
    if (inTauri) void emit("cap-mode", m);
  };

  const cancel = useCallback(() => void call("cancel_capture"), []);

  const scale = info ? { x: info.monitor.w / W, y: info.monitor.h / H } : { x: 1, y: 1 };

  const capture = useCallback(async () => {
    if (!info || busy || !activeRef.current) return;
    setError("");
    try {
      if (mode === "window") {
        setBusy(true);
        await call("switch_to_window_capture");
        return;
      }
      let rect: { x: number; y: number; w: number; h: number } | null = null;
      if (mode === "area" && sel) {
        const b = toPx(sel);
        if (b.w < MIN || b.h < MIN) {
          setError("Select a larger area.");
          return;
        }
        rect = { x: b.x * scale.x, y: b.y * scale.y, w: b.w * scale.x, h: b.h * scale.y };
      }
      setBusy(true);
      await call("finish_capture", { req: { mode, monitor: index, rect } });
    } catch (e) {
      setBusy(false);
      setError(errorMessage(e));
    }
  }, [info, busy, mode, sel, scale.x, scale.y, index, W, H]);

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
    activate();
    if (mode !== "area" || busy || (e.target as HTMLElement).closest("[role=toolbar]")) return;
    setError("");
    begin(e, "new");
    setSel(toFrac({ x: e.clientX, y: e.clientY, w: 0, h: 0 }));
  };

  const onMove = (e: React.PointerEvent) => {
    if (!activeRef.current) activate();
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.sx;
    const dy = e.clientY - d.sy;
    const o = d.orig;
    const clampX = (v: number) => Math.max(0, Math.min(W, v));
    const clampY = (v: number) => Math.max(0, Math.min(H, v));
    let next: Box;
    if (d.kind === "new") next = norm({ x: d.sx, y: d.sy }, { x: clampX(e.clientX), y: clampY(e.clientY) });
    else if (d.kind === "move") next = { ...o, x: Math.max(0, Math.min(W - o.w, o.x + dx)), y: Math.max(0, Math.min(H - o.h, o.y + dy)) };
    else {
      const left = d.kind === "tl" || d.kind === "bl";
      const top = d.kind === "tl" || d.kind === "tr";
      next = norm({ x: left ? o.x + o.w : o.x, y: top ? o.y + o.h : o.y }, { x: clampX(left ? o.x + dx : o.x + o.w + dx), y: clampY(top ? o.y + dy : o.y + o.h + dy) });
    }
    setSel(toFrac(next));
  };

  const onUp = () => {
    drag.current = null;
    setSel((b) => (b && (b.w * W < 4 || b.h * H < 4) ? null : b));
  };

  const full: Box = { x: 0, y: 0, w: W, h: H };
  const shown: Box | null = !active || mode === "window" ? null : mode === "screen" ? full : (box ?? full);
  const isFull = shown === full || (shown && shown.w >= W - 1 && shown.h >= H - 1);
  const label = info && shown ? `${Math.round(shown.w * scale.x)} × ${Math.round(shown.h * scale.y)}` : "";

  return (
    <div ref={root} className="cap-root" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp}>
      {info && (
        <img
          className="cap-img"
          src={assetUrl(info.src)}
          alt=""
          draggable={false}
          style={{ left: -info.monitor.x / scale.x, top: -info.monitor.y / scale.y, width: info.width / scale.x, height: info.height / scale.y }}
          onLoad={() => void call("overlay_ready", { index })}
        />
      )}
      {(!active || !shown) && <div className="cap-dim" />}
      {active && mode === "window" && <div className="cap-hint">Your desktop will show a window picker. Choose the window to capture.</div>}
      {active && mode === "area" && !box && <div className="cap-hint">Drag to select an area, or press Enter to capture this screen</div>}

      {shown && (
        <div
          className={`cap-box${isFull ? " is-full" : ""}`}
          style={{ left: shown.x, top: shown.y, width: shown.w, height: shown.h }}
          onPointerDown={(e) => box && begin(e, "move")}
          onDoubleClick={() => void capture()}
        >
          <div className="cap-label">
            <span className="cap-size">{label}</span>
          </div>
          {mode === "area" && (
            <>
              {(["tl", "tr", "bl", "br"] as const).map((k) => (
                <span key={k} className={`cap-handle ${k}`} onPointerDown={(e) => box && begin(e, k)} />
              ))}
              <span className="cap-grid v1" />
              <span className="cap-grid v2" />
              <span className="cap-grid h1" />
              <span className="cap-grid h2" />
            </>
          )}
        </div>
      )}

      {active && (
        <div role="toolbar" aria-label="Screenshot" className="cap-bar">
          <div role="group" aria-label="Capture mode" className="cap-seg">
            {(["area", "window", "screen"] as const).map((m) => (
              <button key={m} type="button" className={mode === m ? "is-on" : ""} aria-pressed={mode === m} onClick={() => changeMode(m)}>
                <ModeIcon mode={m} />
                {m === "area" ? "Area" : m === "window" ? "Window" : "Screen"}
              </button>
            ))}
          </div>
          <div className="cap-div" aria-hidden="true" />
          <button type="button" className="cap-opt" aria-label="Screenshot settings" onClick={() => void call("open_capture_settings")}>
            <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" style={{ fill: "none", stroke: "currentColor", strokeWidth: 1.9, strokeLinecap: "round", strokeLinejoin: "round" }}>
              <circle cx="12" cy="12" r="3" />
              <path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1" />
            </svg>
            Settings
          </button>
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
      )}
      {active && error && <div className="cap-error">{error}</div>}
    </div>
  );
}
