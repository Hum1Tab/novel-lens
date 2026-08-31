import type { RoleId } from "@novel-lens/editor-core";
import type { Chapter, ProjectManifest, ProjectSettings } from "@novel-lens/project-store";

export type { Chapter, ProjectManifest, ProjectSettings, RoleId };

export interface ProjectSummary {
  root: string;
  manifest: ProjectManifest;
}

export interface ImportedDocumentSummary {
  project: ProjectSummary;
  importedChapterIds: string[];
}

export interface ChapterDocument {
  chapter: Chapter;
  text: string;
}

export interface SearchHit {
  chapterId: string;
  title: string;
  start: number;
  end: number;
  excerpt: string;
}

export interface CheckpointEntry {
  commit: string;
  authoredAt: string;
  subject: string;
}

export type LensProviderId = "mock" | "openai";

export interface LensMessage {
  sender: "author" | "lens";
  text: string;
  createdAt: string;
}

export interface LensChapterInput {
  id: string;
  title: string;
  order: number;
  text: string;
}

export interface LensRunInput {
  role: RoleId;
  query: string;
  chapters: LensChapterInput[];
  provider: LensProviderId;
  modelId: string;
  apiKey?: string;
  conversation: LensMessage[];
}

export interface LensFinding {
  id: string;
  title: string;
  observation: string;
  readerEffect: string;
  quote: string;
  chapterId: string | null;
  chapterTitle: string | null;
  anchorStatus: "attached" | "ambiguous" | "missing";
  startUtf16: number | null;
  endUtf16: number | null;
  priority: "high" | "medium" | "low";
}

export interface LensRunResult {
  role: RoleId;
  summary: string;
  findings: LensFinding[];
  coverage: { chapterCount: number; characterCount: number; chapterTitles: string[] };
  provider: LensProviderId;
  modelId: string;
}

export interface AppInfo {
  name: string;
  version: string;
  platform: string;
}

export interface NovelLensApi {
  appInfo(): Promise<AppInfo>;
  createProject(title: string): Promise<ProjectSummary | null>;
  openProject(): Promise<ProjectSummary | null>;
  refreshProject(root: string): Promise<ProjectSummary>;
  readChapter(root: string, chapterId: string): Promise<ChapterDocument>;
  saveChapter(root: string, chapterId: string, text: string): Promise<void>;
  createChapter(root: string, title: string): Promise<Chapter>;
  importDocuments(root: string): Promise<ImportedDocumentSummary | null>;
  renameChapter(root: string, chapterId: string, title: string): Promise<void>;
  reorderChapters(root: string, chapterIds: string[]): Promise<ProjectSummary>;
  renameProject(root: string, title: string): Promise<ProjectSummary>;
  deleteChapter(root: string, chapterId: string): Promise<void>;
  updateSettings(root: string, settings: ProjectSettings): Promise<ProjectSummary>;
  search(root: string, query: string): Promise<SearchHit[]>;
  createCheckpoint(root: string, subject: string): Promise<{ created: boolean; commit: string | null }>;
  listCheckpoints(root: string): Promise<CheckpointEntry[]>;
  restoreCheckpoint(root: string, commit: string): Promise<ProjectSummary>;
  createVariation(root: string): Promise<string | null>;
  exportMarkdown(root: string): Promise<string | null>;
  runLens(input: LensRunInput): Promise<LensRunResult>;
  onMenuAction(listener: (action: "new" | "open" | "save" | "checkpoint" | "export") => void): () => void;
  onBeforeClose(listener: () => void | Promise<void>): () => void;
}

declare global {
  interface Window {
    novelLens: NovelLensApi;
  }
}
