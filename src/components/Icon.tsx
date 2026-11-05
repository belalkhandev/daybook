import type { ReactNode } from "react";

interface Def {
  d?: string[];
  extra?: ReactNode;
  sw?: number;
  fill?: boolean;
}

const SPARK = [
  "M12 3l1.8 4.7 4.7 1.8-4.7 1.8L12 16l-1.8-4.7-4.7-1.8 4.7-1.8z",
  "M18.5 14.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z",
];

const DEFS: Record<string, Def> = {
  plus: { d: ["M12 5v14M5 12h14"], sw: 2 },
  search: { d: ["M20 20l-3.5-3.5"], extra: <circle cx="11" cy="11" r="7" /> },
  minimize: { d: ["M7 12h10"], sw: 2 },
  maximize: { extra: <rect x="7" y="7" width="10" height="10" rx="1.5" />, sw: 2 },
  close: { d: ["M8 8l8 8M16 8l-8 8"], sw: 2 },
  check: { d: ["M5 12.5l4.5 4.5L19 7.5"], sw: 2.6 },
  clock: { d: ["M12 8v4l2.5 2"], extra: <circle cx="12" cy="12" r="8" />, sw: 2 },
  more: {
    fill: true,
    extra: (
      <>
        <circle cx="5" cy="12" r="1.6" />
        <circle cx="12" cy="12" r="1.6" />
        <circle cx="19" cy="12" r="1.6" />
      </>
    ),
  },
  arrowRight: { d: ["M5 12h14M13 6l6 6-6 6"], sw: 2 },
  arrowLeft: { d: ["M19 12H5M11 6l-6 6 6 6"], sw: 2 },
  sparkles: { d: SPARK },
  gear: {
    d: [
      "M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z",
    ],
    extra: <circle cx="12" cy="12" r="3" />,
  },
  bold: { d: ["M7 5h6a3.5 3.5 0 0 1 0 7H7zM7 12h7a3.5 3.5 0 0 1 0 7H7z"], sw: 2.2 },
  italic: { d: ["M10 5h8M6 19h8M14 5l-4 14"], sw: 2 },
  checklist: { d: ["M4 7l2 2 3-3M4 16l2 2 3-3M13 8h7M13 17h7"], sw: 2 },
  bullets: { d: ["M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01"], sw: 2 },
  link: {
    d: ["M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"],
    sw: 2,
  },
  pin: { d: ["M9 4h6l-1 6 3 3H7l3-3-1-6zM12 13v7"] },
  trash: { d: ["M5 7h14M10 11v6M14 11v6M7 7l1 12h8l1-12M9 7V4h6v3"] },
  code: { d: ["M9 7l-5 5 5 5M15 7l5 5-5 5"], sw: 2 },
  codeblock: {
    d: ["M8 10l-2 2 2 2M16 10l2 2-2 2M13 9l-2 6"],
    extra: <rect x="3" y="4" width="18" height="16" rx="3" />,
  },
  copy: {
    d: ["M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"],
    extra: <rect x="8" y="8" width="12" height="12" rx="2" />,
    sw: 2,
  },
  refresh: { d: ["M20 11a8 8 0 1 0-2.3 5.7M20 5v6h-6"], sw: 2 },
  pencil: { d: ["M4 20h4L19 9l-4-4L4 16z"], sw: 2 },
  eye: {
    d: ["M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"],
    extra: <circle cx="12" cy="12" r="3" />,
  },
  chevron: { d: ["M6 9l6 6 6-6"], sw: 2 },
  lock: { d: ["M8 11V8a4 4 0 0 1 8 0v3"], extra: <rect x="5" y="11" width="14" height="10" rx="2" /> },
  shield: { d: ["M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"] },
  play: {
    fill: true,
    d: ["M8 5.5v13a1 1 0 0 0 1.5.9l10-6.5a1 1 0 0 0 0-1.7l-10-6.5A1 1 0 0 0 8 5.5z"],
  },
  pause: {
    fill: true,
    extra: (
      <>
        <rect x="6" y="5" width="4" height="14" rx="1" />
        <rect x="14" y="5" width="4" height="14" rx="1" />
      </>
    ),
  },
  markdown: {
    d: ["M6 15V9l2.5 3L11 9v6M15.5 9v6M13.5 13l2 2 2-2"],
    extra: <rect x="2.5" y="6" width="19" height="12" rx="2" />,
  },
};

interface Props {
  name: keyof typeof DEFS | string;
  size?: number;
  sw?: number;
  className?: string;
  label?: string;
}

export function Icon({ name, size = 16, sw, className, label }: Props) {
  const def = DEFS[name];
  if (!def) return null;
  const common = def.fill
    ? { fill: "currentColor", stroke: "none" }
    : {
        fill: "none",
        stroke: "currentColor",
        strokeWidth: sw ?? def.sw ?? 1.8,
        strokeLinecap: "round" as const,
        strokeLinejoin: "round" as const,
      };
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={className}
      aria-hidden={label ? undefined : true}
      aria-label={label}
      role={label ? "img" : undefined}
      style={{ flex: "none" }}
      {...common}
    >
      {def.extra}
      {def.d?.map((p, i) => <path key={i} d={p} />)}
    </svg>
  );
}
