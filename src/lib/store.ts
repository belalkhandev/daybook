import { create } from "zustand";
import { call } from "./ipc";
import type { ItemKind, Project, Settings } from "./types";
import { dayKey, hexToRgb } from "./util";

export type View = "today" | "upcoming" | "notes" | "calendar" | "settings";
export type SettingsTab = "general" | "ai" | "sync" | "shortcuts";
export type Modal =
  | null
  | { type: "quick"; kind: ItemKind }
  | { type: "ai"; kind: ItemKind }
  | { type: "search" };

interface UI {
  view: View;
  prevView: View;
  day: string;
  selectedNoteId: string | null;
  settingsTab: SettingsTab;
  modal: Modal;
  settings: Settings;
  projects: Project[];
  hasKey: boolean;
  lastSaved: Date;
  go: (v: View) => void;
  openSettings: (tab?: SettingsTab) => void;
  closeSettings: () => void;
  setDay: (d: string) => void;
  selectNote: (id: string | null) => void;
  setModal: (m: Modal) => void;
  touch: () => void;
  loadSettings: () => Promise<void>;
  loadProjects: () => Promise<void>;
  setSetting: (key: string, value: string) => Promise<void>;
}

export const useUI = create<UI>((set, get) => ({
  view: "today",
  prevView: "today",
  day: dayKey(new Date()),
  selectedNoteId: null,
  settingsTab: "general",
  modal: null,
  settings: {},
  projects: [],
  hasKey: false,
  lastSaved: new Date(),
  go: (view) => set({ view, modal: null }),
  openSettings: (tab) => {
    const cur = get().view;
    set({
      prevView: cur === "settings" ? get().prevView : cur,
      view: "settings",
      settingsTab: tab ?? get().settingsTab,
      modal: null,
    });
  },
  closeSettings: () => set({ view: get().prevView }),
  setDay: (day) => set({ day }),
  selectNote: (selectedNoteId) => set({ selectedNoteId }),
  setModal: (modal) => set({ modal }),
  touch: () => set({ lastSaved: new Date() }),
  loadSettings: async () => {
    const [settings, hasKey] = await Promise.all([
      call<Settings>("get_settings"),
      call<boolean>("has_api_key").catch(() => false),
    ]);
    set({ settings, hasKey });
  },
  loadProjects: async () => set({ projects: await call<Project[]>("list_projects") }),
  setSetting: async (key, value) => {
    set({ settings: { ...get().settings, [key]: value } });
    await call("set_setting", { key, value });
  },
}));

export const ACCENTS = ["#4F46E5", "#0F766E", "#C2410C", "#16161D"];

const ACCENT_INK: Record<string, string> = {
  "#4F46E5": "#4338CA",
  "#0F766E": "#0B5A54",
  "#C2410C": "#9A3412",
  "#16161D": "#16161D",
};

const ACCENT_HOVER: Record<string, string> = {
  "#4F46E5": "#312E81",
  "#0F766E": "#064E48",
  "#C2410C": "#7C2D12",
  "#16161D": "#000000",
};

export function applyAppearance(settings: Settings) {
  const root = document.documentElement;
  const accent = (settings.accent || ACCENTS[0]).toUpperCase();
  const [r, g, b] = hexToRgb(accent);
  root.style.setProperty("--accent", accent);
  root.style.setProperty("--accent-rgb", `${r}, ${g}, ${b}`);
  root.style.setProperty("--accent-tint", `rgba(${r}, ${g}, ${b}, 0.1)`);
  root.style.setProperty("--accent-ink", ACCENT_INK[accent] ?? accent);
  root.style.setProperty("--link", ACCENT_INK[accent] ?? accent);
  root.style.setProperty("--link-hover", ACCENT_HOVER[accent] ?? accent);
  root.classList.toggle("reduce-glass", settings.reduce_transparency === "1");
}
