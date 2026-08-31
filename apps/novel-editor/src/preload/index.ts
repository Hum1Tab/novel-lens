import { contextBridge, ipcRenderer } from "electron";
import type { NovelLensApi } from "../shared/types.js";

const invoke = <T>(channel: string, ...args: unknown[]): Promise<T> => ipcRenderer.invoke(channel, ...args) as Promise<T>;

const api: NovelLensApi = {
  appInfo: () => invoke("app:info"),
  createProject: (title) => invoke("project:create", title),
  openProject: () => invoke("project:open"),
  refreshProject: (root) => invoke("project:refresh", root),
  readChapter: (root, chapterId) => invoke("chapter:read", root, chapterId),
  saveChapter: (root, chapterId, text) => invoke("chapter:save", root, chapterId, text),
  createChapter: (root, title) => invoke("chapter:create", root, title),
  importDocuments: (root) => invoke("chapter:import", root),
  renameChapter: (root, chapterId, title) => invoke("chapter:rename", root, chapterId, title),
  reorderChapters: (root, chapterIds) => invoke("chapter:reorder", root, chapterIds),
  renameProject: (root, title) => invoke("project:rename", root, title),
  deleteChapter: (root, chapterId) => invoke("chapter:delete", root, chapterId),
  updateSettings: (root, settings) => invoke("project:settings", root, settings),
  search: (root, query) => invoke("project:search", root, query),
  createCheckpoint: (root, subject) => invoke("history:checkpoint", root, subject),
  listCheckpoints: (root) => invoke("history:list", root),
  restoreCheckpoint: (root, commit) => invoke("history:restore", root, commit),
  createVariation: (root) => invoke("project:variation", root),
  exportMarkdown: (root) => invoke("project:export", root),
  runLens: (input) => invoke("lens:run", input),
  onMenuAction: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, action: "new" | "open" | "save" | "checkpoint" | "export") => listener(action);
    ipcRenderer.on("menu:action", handler);
    return () => ipcRenderer.removeListener("menu:action", handler);
  },
  onBeforeClose: (listener) => {
    const handler = () => { void Promise.resolve(listener()).catch(() => undefined).finally(() => ipcRenderer.send("app:close-ready")); };
    ipcRenderer.on("app:before-close", handler);
    return () => ipcRenderer.removeListener("app:before-close", handler);
  }
};

contextBridge.exposeInMainWorld("novelLens", Object.freeze(api));
