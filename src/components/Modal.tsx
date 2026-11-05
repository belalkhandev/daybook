import { motion } from "framer-motion";
import { useEffect, type ReactNode } from "react";
import { spring } from "../lib/motion";

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
    <motion.div
      className="modal-backdrop"
      style={{ padding: `${top}px 20px 48px` }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18 }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <motion.section
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        className="modal glass-modal"
        style={{ maxWidth }}
        initial={{ opacity: 0, y: 24, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 12, scale: 0.98 }}
        transition={spring}
        onKeyDown={onKeyDown}
      >
        {children}
      </motion.section>
    </motion.div>
  );
}
