import type { CSSProperties } from "react";

export type BlobVariant = "today" | "notes" | "settings" | "task";

const radial = (rgb: string, a: number) => `radial-gradient(closest-side, rgba(${rgb},${a}), rgba(${rgb},0))`;
const ribbon = (c1: string, a1: number, c2: string, a2: number) =>
  `linear-gradient(90deg, rgba(${c1},0), rgba(${c1},${a1}), rgba(${c2},${a2}), rgba(${c2},0))`;

const VIOLET = "167,139,250";
const PEACH = "253,186,116";
const MINT = "110,231,183";
const ROSE = "244,114,182";
const SKY = "147,197,253";
const LAV = "196,181,253";

const circle = (style: CSSProperties, size: number, bg: string): CSSProperties => ({
  ...style,
  width: size,
  height: size,
  borderRadius: "50%",
  background: bg,
});

const VARIANTS: Record<BlobVariant, CSSProperties[]> = {
  today: [
    circle({ top: -220, left: -160 }, 680, radial(VIOLET, 0.3)),
    circle({ top: -160, right: -120 }, 640, radial(PEACH, 0.26)),
    {
      top: "36%",
      left: "26%",
      width: 960,
      height: 300,
      borderRadius: "50%",
      transform: "rotate(-14deg)",
      background: ribbon(SKY, 0.24, LAV, 0.22),
      filter: "blur(30px)",
    },
    circle({ bottom: -220, left: "6%" }, 580, radial(MINT, 0.22)),
    circle({ bottom: -180, right: "4%" }, 540, radial(ROSE, 0.14)),
  ],
  notes: [
    circle({ top: -200, right: -140 }, 700, radial(VIOLET, 0.28)),
    circle({ top: -120, left: -160 }, 600, radial(SKY, 0.26)),
    {
      top: "44%",
      left: "10%",
      width: 1000,
      height: 280,
      borderRadius: "50%",
      transform: "rotate(10deg)",
      background: ribbon(PEACH, 0.22, ROSE, 0.16),
      filter: "blur(32px)",
    },
    circle({ bottom: -220, right: "12%" }, 600, radial(MINT, 0.2)),
  ],
  settings: [
    {
      top: -200,
      left: "18%",
      width: 820,
      height: 520,
      borderRadius: "50%",
      background: radial(VIOLET, 0.28),
    },
    circle({ top: "30%", right: -180 }, 620, radial(PEACH, 0.24)),
    circle({ top: "55%", left: -180 }, 640, radial(MINT, 0.22)),
    {
      bottom: -160,
      left: "40%",
      width: 900,
      height: 260,
      borderRadius: "50%",
      transform: "rotate(-8deg)",
      background: ribbon(SKY, 0.24, ROSE, 0.14),
      filter: "blur(30px)",
    },
  ],
  task: [
    {
      top: -260,
      left: "20%",
      width: 900,
      height: 520,
      borderRadius: "50%",
      background: radial(VIOLET, 0.3),
    },
    circle({ top: "18%", right: -200 }, 640, radial(PEACH, 0.24)),
    {
      top: "48%",
      left: "-8%",
      width: 1100,
      height: 300,
      borderRadius: "50%",
      transform: "rotate(-8deg)",
      background: ribbon(MINT, 0.2, SKY, 0.24),
      filter: "blur(32px)",
    },
    circle({ bottom: -200, right: "20%" }, 600, radial(ROSE, 0.14)),
  ],
};

export function Blobs({ variant }: { variant: BlobVariant }) {
  return (
    <div className="blobs" aria-hidden="true">
      {VARIANTS[variant].map((s, i) => (
        <div key={i} className="blob" style={s} />
      ))}
    </div>
  );
}
