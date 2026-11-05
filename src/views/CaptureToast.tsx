import { useEffect, useRef, useState } from "react";
import { assetUrl, call, win } from "../lib/ipc";
import { applyAppearance, useUI } from "../lib/store";
import type { Shot } from "../lib/types";

interface Props {
  id: string;
  ocr: boolean;
  copied: boolean;
}

export function CaptureToast({ id, ocr, copied }: Props) {
  const [shot, setShot] = useState<Shot | null>(null);
  const [note, setNote] = useState("");
  const hover = useRef(false);

  useEffect(() => {
    void useUI.getState().loadSettings().then(() => applyAppearance(useUI.getState().settings));
    void call<Shot>("get_shot", { id }).then(setShot);
    const t = setInterval(() => {
      if (!hover.current) void win.close();
    }, 12000);
    const key = (e: KeyboardEvent) => e.key === "Escape" && void win.close();
    window.addEventListener("keydown", key);
    return () => {
      clearInterval(t);
      window.removeEventListener("keydown", key);
    };
  }, [id]);

  if (!shot) return <div className="toast-root" />;

  const status = `${copied ? "Copied to clipboard" : "Saved"} · ${ocr ? "text found" : "no text found"}`;

  const copyText = async () => {
    try {
      await navigator.clipboard.writeText(shot.ocr_text);
      setNote("Text copied");
    } catch {
      setNote("Couldn't reach the clipboard");
    }
  };

  return (
    <div className="toast-root" onMouseEnter={() => (hover.current = true)} onMouseLeave={() => (hover.current = false)}>
      <div role="status" className="toast-card">
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <div className="toast-thumb">
            <img src={assetUrl(shot.thumb)} alt="New screenshot" />
          </div>
          <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: 15, fontWeight: 600 }}>Saved to Shots</span>
            <span style={{ fontSize: 13, color: "var(--text-3b)" }}>{note || status}</span>
            <span style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--muted)" }}>
              {shot.app} · {shot.width} {"×"} {shot.height}
            </span>
          </div>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          <button
            type="button"
            className="toast-primary"
            onClick={() => {
              void call("open_shot_editor", { id });
              void win.close();
            }}
          >
            Edit
          </button>
          <button type="button" className="toast-btn" disabled={!shot.ocr_text} onClick={() => void copyText()}>
            Copy text
          </button>
          <button
            type="button"
            className="toast-btn"
            onClick={() => {
              void call("request_attach", { id });
              void win.close();
            }}
          >
            Add to task
          </button>
          <button
            type="button"
            className="toast-link"
            onClick={() => {
              void win.close();
              void call("start_capture", { mode: "area" });
            }}
          >
            Take another
          </button>
        </div>
      </div>
    </div>
  );
}
