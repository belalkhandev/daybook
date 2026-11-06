export type Status = "todo" | "progress" | "done";
export type Priority = "low" | "med" | "high";
export type Folder = "work" | "personal" | "ideas";
export type NoteColor = "violet" | "mint" | "peach" | "sky" | "rose" | "yellow";
export type ItemKind = "task" | "note";

export interface Project {
  id: string;
  name: string;
  color: string;
  sort: number;
}

export interface Task {
  id: string;
  seq: number;
  title: string;
  description_md: string;
  status: Status;
  priority: Priority;
  project_id: string | null;
  project: Project | null;
  due_at: string | null;
  remind_before_min: number | null;
  target_minutes: number | null;
  tracked_seconds: number;
  timer_started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
  tags: string[];
}

export interface TaskInput {
  title: string;
  description_md?: string;
  priority?: Priority;
  project_id?: string | null;
  due_at?: string | null;
  remind_before_min?: number | null;
  target_minutes?: number | null;
  tags?: string[];
}

export type TaskPatch = Partial<Omit<TaskInput, "title">> & { title?: string };

export interface Note {
  id: string;
  title: string;
  body_md: string;
  folder: Folder;
  color: NoteColor;
  pinned: boolean;
  created_at: string;
  updated_at: string;
}

export interface NoteInput {
  title: string;
  body_md?: string;
  folder?: Folder;
  color?: NoteColor;
  pinned?: boolean;
}

export interface NotePatch {
  title?: string;
  body_md?: string;
  folder?: Folder;
  color?: NoteColor;
  pinned?: boolean;
}

export interface NoteCounts {
  all: number;
  pinned: number;
  work: number;
  personal: number;
  ideas: number;
}

export interface Comment {
  id: string;
  task_id: string;
  body_md: string;
  created_at: string;
  updated_at: string;
}

export interface DayCount {
  day: string;
  count: number;
}

export interface TaskDraft {
  title: string;
  project: string | null;
  priority: Priority;
  due_at: string | null;
  target_minutes: number | null;
  tags: string[];
  markdown: string;
}

export interface NoteDraft {
  title: string;
  folder: Folder;
  color: NoteColor;
  tags: string[];
  markdown: string;
}

export type Settings = Record<string, string>;

export interface AppError {
  code: string;
  message: string;
}

export interface QuickAddResult {
  kind: ItemKind;
  id: string;
}

export interface ShotLink {
  id: string;
  label: string;
}

export interface Shot {
  id: string;
  title: string;
  file: string;
  thumb: string;
  taken_at: string;
  app: string;
  tag: string | null;
  width: number;
  height: number;
  bytes: number;
  ocr_text: string;
  task: ShotLink | null;
  note: ShotLink | null;
}

export interface ShotPatch {
  title?: string;
  tag?: string | null;
  task_id?: string | null;
  note_id?: string | null;
}

export interface CaptureRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface CaptureInfo {
  width: number;
  height: number;
  mode: string;
  src: string;
  monitor: CaptureRect;
  index: number;
  count: number;
  primary: number;
  remembered: CaptureRect | null;
}

export type CaptureMode = "area" | "window" | "screen";
