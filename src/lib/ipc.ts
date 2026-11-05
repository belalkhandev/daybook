import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { AppError } from "./types";

export const inTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (!inTauri && import.meta.env.DEV) {
    const { mockCall } = await import("../dev/mock");
    return (await mockCall(cmd, args)) as T;
  }
  return invoke<T>(cmd, args);
}

export function assetUrl(path: string): string {
  return inTauri ? convertFileSrc(path) : path;
}

export async function callBytes(cmd: string, args?: Record<string, unknown>): Promise<ArrayBuffer> {
  if (!inTauri && import.meta.env.DEV) {
    const { mockCall } = await import("../dev/mock");
    return (await mockCall(cmd, args)) as ArrayBuffer;
  }
  return invoke<ArrayBuffer>(cmd, args);
}

export async function callRaw<T>(cmd: string, bytes: Uint8Array, headers: Record<string, string>): Promise<T> {
  if (!inTauri && import.meta.env.DEV) {
    const { mockCall } = await import("../dev/mock");
    return (await mockCall(cmd, { bytes, headers })) as T;
  }
  return invoke<T>(cmd, bytes, { headers });
}

export function onEvent<T>(name: string, cb: (payload: T) => void): () => void {
  if (!inTauri) return () => undefined;
  let off: (() => void) | undefined;
  let dead = false;
  void listen<T>(name, (e) => cb(e.payload)).then((u) => {
    if (dead) u();
    else off = u;
  });
  return () => {
    dead = true;
    off?.();
  };
}

type Listener = (kind: string) => void;
const listeners = new Set<Listener>();
let attached = false;

function attach() {
  if (attached) return;
  attached = true;
  if (inTauri) {
    void listen<string>("data-changed", (e) => listeners.forEach((l) => l(e.payload)));
  } else if (import.meta.env.DEV) {
    void import("../dev/mock").then(({ mockSubscribe }) => mockSubscribe((k) => listeners.forEach((l) => l(k))));
  }
}

export function onDataChanged(cb: Listener): () => void {
  attach();
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function errorMessage(e: unknown): string {
  if (e && typeof e === "object" && "message" in e) return String((e as AppError).message);
  return typeof e === "string" ? e : "Something went wrong";
}

export function errorCode(e: unknown): string {
  return e && typeof e === "object" && "code" in e ? String((e as AppError).code) : "other";
}

export const win = {
  minimize: () => (inTauri ? getCurrentWindow().minimize() : Promise.resolve()),
  toggleMaximize: () => (inTauri ? getCurrentWindow().toggleMaximize() : Promise.resolve()),
  close: () => (inTauri ? getCurrentWindow().close() : Promise.resolve()),
};

export function openExternal(url: string) {
  if (!/^https?:\/\//i.test(url)) return;
  if (inTauri) void openUrl(url);
  else window.open(url, "_blank", "noopener");
}
