import { useEffect, type ReactNode } from "react";

interface Props {
  onClose: () => void;
  top: number;
  maxWidth: number;
  labelledBy: string;
  children: ReactNode;
  onKeyDown?: (e: React.KeyboardEvent) => void;
}

export function Modal({ onClose, top, maxWidth, labelledBy, children, onKeyDown }: Props) {
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);
  return (
    <div
      className="modal-backdrop"
      style={{ padding: `${top}px 20px 48px` }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <section role="dialog" aria-modal="true" aria-labelledby={labelledBy} className="modal glass-modal" style={{ maxWidth }} onKeyDown={onKeyDown}>
        {children}
      </section>
    </div>
  );
}
