import { AnimatePresence } from "framer-motion";
import { useRef, useState } from "react";
import { Popup } from "./Picker";

interface Hsv {
  h: number;
  s: number;
  v: number;
}

function hexToHsv(hex: string): Hsv {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  const n = m ? parseInt(m[1], 16) : 0xea580c;
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: max ? d / max : 0, v: max };
}

function hsvToHex({ h, s, v }: Hsv): string {
  const f = (n: number) => {
    const k = (n + h / 60) % 6;
    return v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
  };
  const to = (x: number) => Math.round(x * 255).toString(16).padStart(2, "0");
  return `#${to(f(5))}${to(f(3))}${to(f(1))}`.toUpperCase();
}

interface Props {
  value: string;
  active: boolean;
  onChange: (hex: string) => void;
}

export function ColorPicker({ value, active, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [hsv, setHsv] = useState<Hsv>(() => hexToHsv(value));
  const [text, setText] = useState(value);
  const btn = useRef<HTMLButtonElement>(null);
  const field = useRef<HTMLDivElement>(null);
  const hue = useRef<HTMLDivElement>(null);

  const apply = (next: Hsv) => {
    setHsv(next);
    const hex = hsvToHex(next);
    setText(hex);
    onChange(hex);
  };

  const drag = (el: HTMLDivElement | null, move: (x: number, y: number) => void) => (e: React.PointerEvent) => {
    if (!el) return;
    el.setPointerCapture(e.pointerId);
    const run = (ev: { clientX: number; clientY: number }) => {
      const r = el.getBoundingClientRect();
      move(Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (ev.clientY - r.top) / r.height)));
    };
    run(e);
    const mv = (ev: PointerEvent) => run(ev);
    const up = () => {
      el.removeEventListener("pointermove", mv);
      el.removeEventListener("pointerup", up);
    };
    el.addEventListener("pointermove", mv);
    el.addEventListener("pointerup", up);
  };

  const toggle = () => {
    if (!open) {
      setHsv(hexToHsv(value));
      setText(value);
    }
    setOpen(!open);
  };

  const hex = hsvToHex(hsv);

  return (
    <div className="pk">
      <button
        ref={btn}
        type="button"
        aria-label="Custom colour"
        aria-pressed={active}
        aria-expanded={open}
        title="Custom colour"
        className="color-dot color-custom"
        style={active ? { boxShadow: "0 0 0 2px #16161D", background: value } : undefined}
        onClick={toggle}
      />
      <AnimatePresence>
        {open && (
          <Popup anchor={btn} onClose={() => setOpen(false)}>
            <div className="cp" role="dialog" aria-label="Choose a colour">
              <div
                ref={field}
                className="cp-field"
                style={{ background: `hsl(${hsv.h}, 100%, 50%)` }}
                onPointerDown={drag(field.current, (x, y) => apply({ ...hsv, s: x, v: 1 - y }))}
              >
                <span className="cp-white" />
                <span className="cp-black" />
                <span className="cp-knob" style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%`, background: hex }} />
              </div>
              <div ref={hue} className="cp-hue" onPointerDown={drag(hue.current, (x) => apply({ ...hsv, h: x * 360 }))}>
                <span className="cp-knob cp-hue-knob" style={{ left: `${(hsv.h / 360) * 100}%`, background: `hsl(${hsv.h}, 100%, 50%)` }} />
              </div>
              <div className="cp-row">
                <span className="cp-swatch" style={{ background: hex }} />
                <input
                  className="input-sm cp-hex"
                  aria-label="Hex colour"
                  value={text}
                  maxLength={7}
                  onChange={(e) => {
                    const v = e.target.value;
                    setText(v);
                    if (/^#[0-9a-f]{6}$/i.test(v)) {
                      setHsv(hexToHsv(v));
                      onChange(v.toUpperCase());
                    }
                  }}
                />
                <button type="button" className="pk-link" onClick={() => setOpen(false)}>
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
