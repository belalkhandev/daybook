import { useEffect, useRef, useState } from "react";
import { onDataChanged } from "./ipc";

export function useDataChanged(kinds: string[], cb: () => void) {
  const ref = useRef(cb);
  ref.current = cb;
  const key = kinds.join("|");
  useEffect(() => {
    return onDataChanged((k) => {
      if (key.split("|").includes(k)) ref.current();
    });
  }, [key]);
}

export function useOutside(ref: React.RefObject<HTMLElement | null>, onClose: () => void, active = true) {
  const cb = useRef(onClose);
  cb.current = onClose;
  useEffect(() => {
    if (!active) return;
    const down = (e: MouseEvent) => {
      const t = e.target as Element;
      if (t.closest?.("[data-picker-popup]")) return;
      if (ref.current && !ref.current.contains(t)) cb.current();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") cb.current();
    };
    document.addEventListener("mousedown", down);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("mousedown", down);
      document.removeEventListener("keydown", key);
    };
  }, [ref, active]);
}

export function useNow(intervalMs: number, active = true): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs, active]);
  return now;
}
