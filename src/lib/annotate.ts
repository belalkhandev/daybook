export type Tool = "select" | "crop" | "resize" | "pen" | "highlight" | "arrow" | "rect" | "text" | "blur";

export interface Mark {
  id: number;
  t: "pen" | "highlight" | "arrow" | "rect" | "text" | "blur";
  color: string;
  size: number;
  x: number;
  y: number;
  w: number;
  h: number;
  x2: number;
  y2: number;
  pts: number[][];
  text: string;
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Snapshot {
  base: HTMLCanvasElement;
  marks: Mark[];
}

const STROKES = [3, 6, 11, 18];
const FONTS = [20, 28, 40, 56];

export const strokeWidth = (size: number, iw: number) => Math.max(2, STROKES[size] * (iw / 1600));
export const fontSize = (size: number, iw: number) => Math.max(12, Math.round(FONTS[size] * (iw / 1600)));

function isLight(hex: string) {
  const n = parseInt(hex.replace("#", ""), 16);
  const lum = 0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255);
  return lum > 170;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

export function norm(m: Box): Box {
  return { x: m.w < 0 ? m.x + m.w : m.x, y: m.h < 0 ? m.y + m.h : m.y, w: Math.abs(m.w), h: Math.abs(m.h) };
}

function pixelate(ctx: CanvasRenderingContext2D, base: HTMLCanvasElement, b: Box) {
  const block = Math.max(8, Math.round(base.width / 120));
  const tw = Math.max(1, Math.round(b.w / block));
  const th = Math.max(1, Math.round(b.h / block));
  const tmp = document.createElement("canvas");
  tmp.width = tw;
  tmp.height = th;
  const tctx = tmp.getContext("2d");
  if (!tctx) return;
  tctx.drawImage(base, b.x, b.y, b.w, b.h, 0, 0, tw, th);
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(tmp, 0, 0, tw, th, b.x, b.y, b.w, b.h);
  ctx.restore();
}

export function drawMark(ctx: CanvasRenderingContext2D, m: Mark, base: HTMLCanvasElement) {
  const iw = base.width;
  const f = iw / 1600;
  const sw = strokeWidth(m.size, iw);
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  if (m.t === "rect") {
    const b = norm(m);
    ctx.strokeStyle = m.color;
    ctx.lineWidth = sw;
    roundRect(ctx, b.x, b.y, b.w, b.h, 12 * f);
    ctx.stroke();
  } else if (m.t === "blur") {
    const b = norm(m);
    if (b.w > 1 && b.h > 1) pixelate(ctx, base, b);
  } else if (m.t === "arrow") {
    ctx.strokeStyle = m.color;
    ctx.lineWidth = sw;
    const ang = Math.atan2(m.y2 - m.y, m.x2 - m.x);
    const head = sw * 3.4;
    ctx.beginPath();
    ctx.moveTo(m.x, m.y);
    ctx.lineTo(m.x2, m.y2);
    ctx.moveTo(m.x2, m.y2);
    ctx.lineTo(m.x2 - head * Math.cos(ang - 0.45), m.y2 - head * Math.sin(ang - 0.45));
    ctx.moveTo(m.x2, m.y2);
    ctx.lineTo(m.x2 - head * Math.cos(ang + 0.45), m.y2 - head * Math.sin(ang + 0.45));
    ctx.stroke();
  } else if (m.t === "pen" || m.t === "highlight") {
    if (m.pts.length > 1) {
      const marker = m.t === "highlight";
      ctx.strokeStyle = m.color;
      ctx.globalAlpha = marker ? 0.42 : 1;
      ctx.lineWidth = marker ? sw * 3.4 : sw;
      ctx.beginPath();
      ctx.moveTo(m.pts[0][0], m.pts[0][1]);
      for (const p of m.pts.slice(1)) ctx.lineTo(p[0], p[1]);
      ctx.stroke();
    }
  } else if (m.t === "text" && m.text) {
    const fs = fontSize(m.size, iw);
    ctx.font = `600 ${fs}px Geist, ui-sans-serif, system-ui, sans-serif`;
    ctx.textBaseline = "top";
    const tw = ctx.measureText(m.text).width;
    const padX = fs * 0.8;
    const padY = fs * 0.4;
    ctx.fillStyle = m.color;
    roundRect(ctx, m.x, m.y, tw + padX * 2, fs + padY * 2, fs * 0.5);
    ctx.fill();
    ctx.fillStyle = isLight(m.color) ? "#16161D" : "#FFFFFF";
    ctx.fillText(m.text, m.x + padX, m.y + padY);
  }
  ctx.restore();
}

export function render(ctx: CanvasRenderingContext2D, snap: Snapshot, extra: Mark[] = []) {
  const { base, marks } = snap;
  ctx.clearRect(0, 0, base.width, base.height);
  ctx.drawImage(base, 0, 0);
  for (const m of marks) drawMark(ctx, m, base);
  for (const m of extra) drawMark(ctx, m, base);
}

const viewCache = new WeakMap<HTMLCanvasElement, { w: number; c: HTMLCanvasElement }>();

export function scaledBase(base: HTMLCanvasElement, targetW: number): HTMLCanvasElement {
  if (targetW >= base.width * 0.75) return base;
  const hit = viewCache.get(base);
  if (hit && hit.w === targetW) return hit.c;
  let cur = base;
  while (cur.width / 2 >= targetW) {
    const next = document.createElement("canvas");
    next.width = Math.max(1, Math.round(cur.width / 2));
    next.height = Math.max(1, Math.round(cur.height / 2));
    const ctx = next.getContext("2d");
    if (!ctx) break;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(cur, 0, 0, next.width, next.height);
    cur = next;
  }
  viewCache.set(base, { w: targetW, c: cur });
  return cur;
}

export function renderView(ctx: CanvasRenderingContext2D, snap: Snapshot, extra: Mark[], k: number) {
  const { base, marks } = snap;
  const cw = ctx.canvas.width;
  const ch = ctx.canvas.height;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, cw, ch);
  ctx.imageSmoothingEnabled = k < 2;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(scaledBase(base, cw), 0, 0, cw, ch);
  ctx.setTransform(k, 0, 0, k, 0, 0);
  for (const m of marks) drawMark(ctx, m, base);
  for (const m of extra) drawMark(ctx, m, base);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}

export function resizeCrop(o: Box, corner: string, dx: number, dy: number, ratio: number | null, iw: number, ih: number): Box {
  const MIN = 8;
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
  if (corner === "move") return { ...o, x: clamp(o.x + dx, 0, iw - o.w), y: clamp(o.y + dy, 0, ih - o.h) };
  const L = corner.includes("l");
  const R = corner.includes("r");
  const T = corner.includes("t");
  const B = corner.includes("b");
  let x1 = o.x;
  let y1 = o.y;
  let x2 = o.x + o.w;
  let y2 = o.y + o.h;
  if (L) x1 = clamp(o.x + dx, 0, x2 - MIN);
  if (R) x2 = clamp(o.x + o.w + dx, x1 + MIN, iw);
  if (T) y1 = clamp(o.y + dy, 0, y2 - MIN);
  if (B) y2 = clamp(o.y + o.h + dy, y1 + MIN, ih);
  if (ratio) {
    const horiz = L || R;
    const vert = T || B;
    if (horiz && vert) {
      let w = x2 - x1;
      let h = w / ratio;
      const hMax = T ? y2 : ih - y1;
      if (h > hMax) {
        h = hMax;
        w = h * ratio;
      }
      if (L) x1 = x2 - w;
      else x2 = x1 + w;
      if (T) y1 = y2 - h;
      else y2 = y1 + h;
    } else if (horiz) {
      let w = x2 - x1;
      let h = w / ratio;
      if (h > ih) {
        h = ih;
        w = h * ratio;
        if (L) x1 = x2 - w;
        else x2 = x1 + w;
      }
      const cy = o.y + o.h / 2;
      y1 = clamp(cy - h / 2, 0, ih - h);
      y2 = y1 + h;
    } else {
      let h = y2 - y1;
      let w = h * ratio;
      if (w > iw) {
        w = iw;
        h = w / ratio;
        if (T) y1 = y2 - h;
        else y2 = y1 + h;
      }
      const cx = o.x + o.w / 2;
      x1 = clamp(cx - w / 2, 0, iw - w);
      x2 = x1 + w;
    }
  }
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

export function newCrop(sx: number, sy: number, px: number, py: number, ratio: number | null, iw: number, ih: number): Box {
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
  let cx = clamp(px, 0, iw);
  let cy = clamp(py, 0, ih);
  if (ratio) {
    let w = Math.abs(cx - sx);
    let h = w / ratio;
    const dirY = cy >= sy ? 1 : -1;
    const room = dirY > 0 ? ih - sy : sy;
    if (h > room) {
      h = room;
      w = h * ratio;
    }
    cx = sx + (cx >= sx ? w : -w);
    cy = sy + dirY * h;
  }
  return { x: Math.min(sx, cx), y: Math.min(sy, cy), w: Math.abs(cx - sx), h: Math.abs(cy - sy) };
}

let measureCtx: CanvasRenderingContext2D | null = null;

export function bounds(m: Mark, iw: number): Box {
  if (m.t === "arrow") return norm({ x: m.x, y: m.y, w: m.x2 - m.x, h: m.y2 - m.y });
  if (m.t === "pen" || m.t === "highlight") {
    const xs = m.pts.map((p) => p[0]);
    const ys = m.pts.map((p) => p[1]);
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
  }
  if (m.t === "text") {
    const fs = fontSize(m.size, iw);
    measureCtx = measureCtx ?? document.createElement("canvas").getContext("2d");
    if (measureCtx) measureCtx.font = `600 ${fs}px Geist, ui-sans-serif, system-ui, sans-serif`;
    const tw = measureCtx ? measureCtx.measureText(m.text).width : fs * m.text.length * 0.6;
    return { x: m.x, y: m.y, w: tw + fs * 1.6, h: fs * 1.8 };
  }
  return norm(m);
}

function distToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax;
  const dy = by - ay;
  const len = dx * dx + dy * dy;
  const t = len === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

export function hit(m: Mark, x: number, y: number, tol: number, iw: number): boolean {
  if (m.t === "arrow") return distToSegment(x, y, m.x, m.y, m.x2, m.y2) <= tol + strokeWidth(m.size, iw);
  if (m.t === "pen" || m.t === "highlight") {
    for (let i = 1; i < m.pts.length; i++) {
      if (distToSegment(x, y, m.pts[i - 1][0], m.pts[i - 1][1], m.pts[i][0], m.pts[i][1]) <= tol + strokeWidth(m.size, iw)) return true;
    }
    return false;
  }
  const b = bounds(m, iw);
  if (m.t === "rect") {
    const inside = x >= b.x - tol && x <= b.x + b.w + tol && y >= b.y - tol && y <= b.y + b.h + tol;
    const deep = x > b.x + tol && x < b.x + b.w - tol && y > b.y + tol && y < b.y + b.h - tol;
    return inside && !deep;
  }
  return x >= b.x - tol && x <= b.x + b.w + tol && y >= b.y - tol && y <= b.y + b.h + tol;
}

export function translate(m: Mark, dx: number, dy: number): Mark {
  return { ...m, x: m.x + dx, y: m.y + dy, x2: m.x2 + dx, y2: m.y2 + dy, pts: m.pts.map((p) => [p[0] + dx, p[1] + dy]) };
}

export function scaleMark(m: Mark, sx: number, sy: number): Mark {
  return { ...m, x: m.x * sx, y: m.y * sy, w: m.w * sx, h: m.h * sy, x2: m.x2 * sx, y2: m.y2 * sy, pts: m.pts.map((p) => [p[0] * sx, p[1] * sy]) };
}

export function cropBase(base: HTMLCanvasElement, b: Box): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(b.w));
  c.height = Math.max(1, Math.round(b.h));
  c.getContext("2d")?.drawImage(base, Math.round(b.x), Math.round(b.y), c.width, c.height, 0, 0, c.width, c.height);
  return c;
}

export function resizeBase(base: HTMLCanvasElement, w: number, h: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  const ctx = c.getContext("2d");
  if (ctx) {
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(base, 0, 0, c.width, c.height);
  }
  return c;
}

export function cropPreset(aspect: string, iw: number, ih: number): Box {
  if (aspect === "free") return { x: iw * 0.08, y: ih * 0.06, w: iw * 0.8, h: ih * 0.84 };
  const [a, b] = aspect.split(":").map(Number);
  const r = a / b;
  let w = iw * 0.8;
  let h = w / r;
  if (h > ih * 0.9) {
    h = ih * 0.9;
    w = h * r;
  }
  return { x: (iw - w) / 2, y: (ih - h) / 2, w, h };
}
