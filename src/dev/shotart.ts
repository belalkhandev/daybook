export function art(kind: string, seed: number): string {
  const W = 1600;
  const H = 1000;
  const out: string[] = [];
  const r = (x: number, y: number, w: number, h: number, f: string, rx = 0, o = 1, s?: string) =>
    out.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" fill="${f}" opacity="${o}"${s ? ` stroke="${s}" stroke-width="2"` : ""}/>`);
  const c = (x: number, y: number, rr: number, f: string) => out.push(`<circle cx="${x}" cy="${y}" r="${rr}" fill="${f}"/>`);
  const widths = [520, 760, 430, 880, 610, 340, 700, 560, 820, 480, 650, 390, 720, 300, 590, 680, 450, 770];
  const w = (i: number) => widths[(i + seed * 5) % widths.length];
  const dots = (y: number) => {
    c(36, y, 9, "#FF5F57");
    c(66, y, 9, "#FEBC2E");
    c(96, y, 9, "#28C840");
  };
  if (kind === "code") {
    r(0, 0, W, H, "#1E1E2A");
    r(0, 0, W, 64, "#2A2A38");
    dots(32);
    r(0, 64, 260, H - 64, "#232330");
    for (let i = 0; i < 14; i++) r(36, 110 + i * 56, 120 + ((i * 37) % 110), 14, "#4A4A5E", 7);
    const cols = ["#C4B5FD", "#E6E6EE", "#86EFAC", "#7DD3FC", "#FDBA74", "#9CA3AF"];
    const ind = [0, 1, 1, 2, 2, 1, 0, 1, 2, 3, 2, 1, 0, 1, 1, 0, 0];
    for (let i = 0; i < 17; i++) {
      r(300, 108 + i * 50, 30, 14, "#4A4A5E", 4);
      r(360 + ind[i] * 48, 106 + i * 50, Math.round(w(i) * 0.8), 18, cols[(i + seed) % cols.length], 9, 0.85);
    }
  } else if (kind === "web") {
    r(0, 0, W, H, "#FFFFFF");
    r(0, 0, W, 72, "#F3F4F6");
    dots(36);
    r(420, 18, 760, 36, "#FFFFFF", 18);
    r(160, 120, 1280, 300, ["#EEF0FF", "#FFF1E8", "#EAF3F0"][seed % 3], 24);
    r(220, 190, 620, 44, "#16161D", 10, 0.85);
    r(220, 256, 460, 22, "#5A5A6B", 11, 0.5);
    r(220, 330, 180, 52, "#4F46E5", 14);
    for (let i = 0; i < 3; i++) {
      r(160 + i * 440, 470, 400, 300, "#F8F8FB", 20, 1, "#E5E7EB");
      r(200 + i * 440, 510, 220, 22, "#16161D", 11, 0.7);
      r(200 + i * 440, 550, 300, 14, "#9CA3AF", 7);
      r(200 + i * 440, 576, 260, 14, "#9CA3AF", 7);
    }
  } else if (kind === "terminal") {
    r(0, 0, W, H, "#0F1115");
    r(0, 0, W, 56, "#1A1D24");
    dots(28);
    for (let i = 0; i < 18; i++) {
      r(40, 96 + i * 48, 24, 16, "#86EFAC", 4);
      r(80, 96 + i * 48, Math.round(w(i) * 0.9), 16, i % 5 === 4 ? "#F87171" : i % 3 === 0 ? "#86EFAC" : "#9CA3AF", 8, 0.8);
    }
  } else if (kind === "design") {
    r(0, 0, W, H, "#E9E9EE");
    r(0, 0, W, 56, "#FFFFFF");
    r(0, 56, 220, H - 56, "#F7F7F9");
    for (let i = 0; i < 10; i++) r(30, 90 + i * 40, 150, 14, "#C9C9D3", 7);
    for (let i = 0; i < 3; i++) {
      const x = 300 + i * 430;
      r(x, 120, 380, 780, "#FFFFFF", 18, 1, "#DADAE3");
      c(x + 190, 300, 90, ["#C4B5FD", "#FDBA74", "#6EE7B7"][(i + seed) % 3]);
      r(x + 40, 440, 300, 26, "#16161D", 13, 0.8);
      r(x + 40, 490, 240, 16, "#9CA3AF", 8);
      r(x + 40, 520, 280, 16, "#9CA3AF", 8);
      r(x + 40, 820, 140, 48, "#4F46E5", 14);
    }
  } else if (kind === "chart") {
    r(0, 0, W, H, "#FFFFFF");
    r(0, 0, W, 72, "#F3F4F6");
    dots(36);
    r(120, 110, 420, 40, "#16161D", 12, 0.85);
    r(120, 168, 260, 20, "#9CA3AF", 10);
    for (let i = 0; i < 3; i++) {
      r(120 + i * 460, 220, 420, 130, "#F8F8FB", 18, 1, "#E5E7EB");
      r(150 + i * 460, 250, 140, 16, "#9CA3AF", 8);
      r(150 + i * 460, 285, 200, 36, "#16161D", 10, 0.8);
    }
    const hs = [180, 260, 220, 340, 300, 420, 380, 460, 400, 500, 470, 520];
    r(120, 900, 1360, 3, "#E5E7EB");
    for (let i = 0; i < 12; i++) r(150 + i * 110, 900 - hs[i], 70, hs[i], i % 2 ? "#A78BFA" : "#6366F1", 10);
  } else if (kind === "desktop") {
    r(0, 0, W, H, "#5B1B4F");
    r(150, 120, 880, 550, "#1E1E2A", 12);
    r(150, 120, 880, 40, "#2A2A38", 12);
    for (let i = 0; i < 9; i++) r(190, 190 + i * 46, 300 + ((i * 97) % 380), 16, ["#C4B5FD", "#86EFAC", "#E6E6EE"][i % 3], 8, 0.8);
    r(740, 300, 740, 460, "#FFFFFF", 12);
    r(740, 300, 740, 36, "#F3F4F6", 12);
    r(780, 380, 400, 40, "#16161D", 10, 0.8);
  } else {
    r(0, 0, W, H, "#ECECF1");
    r(560, 50, 480, 900, "#FFFFFF", 12);
    c(800, 130, 34, "#10B981");
    r(680, 190, 240, 22, "#16161D", 11, 0.8);
    r(720, 226, 160, 14, "#9CA3AF", 7);
    for (let i = 0; i < 9; i++) {
      r(620, 300 + i * 52, 200 + ((i * 53) % 120), 14, "#9CA3AF", 7);
      r(900, 300 + i * 52, 80, 14, "#6B6B7B", 7);
    }
    r(620, 790, 360, 2, "#E5E7EB");
    r(620, 820, 140, 24, "#16161D", 12);
    r(860, 814, 120, 32, "#16161D", 12);
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">${out.join("")}</svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}
