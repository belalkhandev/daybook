import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { Icon } from "./Icon";

export interface Option {
  value: string;
  label: string;
  color?: string;
  round?: boolean;
}

interface Props {
  id?: string;
  label: string;
  value: string;
  options: Option[];
  onChange: (value: string) => void;
  variant?: "pill" | "field" | "wide";
}

export function Select({ id, label, value, options, onChange, variant = "field" }: Props) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const current = options.find((o) => o.value === value) ?? options[0];
  const index = Math.max(0, options.findIndex((o) => o.value === value));

  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", down);
    return () => document.removeEventListener("mousedown", down);
  }, [open]);

  const show = () => {
    setActive(index);
    setOpen(true);
  };

  const pick = (o: Option) => {
    setOpen(false);
    if (o.value !== value) onChange(o.value);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape" && open) {
      e.stopPropagation();
      setOpen(false);
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) return show();
      setActive((a) => (a + (e.key === "ArrowDown" ? 1 : -1) + options.length) % options.length);
    } else if ((e.key === "Enter" || e.key === " ") && open) {
      e.preventDefault();
      e.stopPropagation();
      pick(options[active]);
    }
  };

  return (
    <div ref={root} className={`csel csel-${variant}`} onKeyDown={onKeyDown}>
      <button
        id={id}
        type="button"
        className="csel-trigger"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => (open ? setOpen(false) : show())}
      >
        {current.color && <span aria-hidden="true" className={`csel-dot${current.round ? " is-round" : ""}`} style={{ background: current.color }} />}
        <span className="csel-value">{current.label}</span>
        <motion.span className="csel-chev" animate={{ rotate: open ? 180 : 0 }} transition={{ duration: 0.18 }}>
          <Icon name="chevron" size={14} />
        </motion.span>
      </button>
      <AnimatePresence>
        {open && (
          <motion.ul
            role="listbox"
            aria-label={label}
            className="csel-menu"
            initial={{ opacity: 0, y: -6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98 }}
            transition={{ duration: 0.14 }}
          >
            {options.map((o, i) => (
              <li
                key={o.value}
                role="option"
                aria-selected={o.value === value}
                className={`csel-opt${i === active ? " is-active" : ""}${o.value === value ? " is-sel" : ""}`}
                onMouseEnter={() => setActive(i)}
                onClick={() => pick(o)}
              >
                {o.color && <span aria-hidden="true" className={`csel-dot${o.round ? " is-round" : ""}`} style={{ background: o.color }} />}
                <span className="csel-value">{o.label}</span>
                {o.value === value && <Icon name="check" size={14} sw={2.4} />}
              </li>
            ))}
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  );
}
