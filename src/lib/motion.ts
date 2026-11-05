export const spring = { type: "spring", stiffness: 420, damping: 34, mass: 0.8 } as const;

export const reveal = (i: number) => ({
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.32, ease: [0.22, 1, 0.36, 1] as const, delay: Math.min(i, 14) * 0.035 },
});

export const press = { whileTap: { scale: 0.97 }, whileHover: { y: -1 } } as const;
