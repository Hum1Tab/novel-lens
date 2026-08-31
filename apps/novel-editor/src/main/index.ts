import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, realpath, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, resolve } from "node:path";

import { ProjectStore, type ProjectSettings } from "@novel-lens/project-store";
import { app, BrowserWindow, dialog, ipcMain, Menu, session, type MenuItemConstructorOptions } from "electron";

import { runLens } from "./lens.js";
import type { ChapterDocument, LensRunInput, ProjectSummary } from "../shared/types.js";

// The editor does not use GPU-heavy features. Software rendering avoids startup
// failures on Windows systems whose graphics runtime is incomplete or blocked.
app.disableHardwareAcceleration();

const allowedRoots = new Set<string>();
let mainWindow: BrowserWindow | null = null;
let closeApproved = false;
let closeFallback: ReturnType<typeof setTimeout> | null = null;

function safeMessage(error: unknown): string {
  if (!(error instanceof Error)) return "処理を完了できませんでした。";
  const message = error.message.replace(/[\r\n\u0000]+/gu, " ").slice(0, 500);
  const translations: Record<string, string> = {
    "chapter not found": "章が見つかりません。",
    "invalid project manifest": "Novel Lens projectとして読み込めません。",
    "managed path boundary violation": "project外のファイル操作を拒否しました。",
    "invalid snapshot id": "保存点を確認できません。"
  };
  return translations[message] ?? message;
}

function handle(channel: string, listener: (...args: any[]) => unknown | Promise<unknown>): void {
  ipcMain.handle(channel, async (_event, ...args: unknown[]) => {
    try { return await listener(...args); }
    catch (error) { throw new Error(safeMessage(error)); }
  });
}

async function registerRoot(root: string): Promise<string> {
  const canonical = await realpath(root);
  allowedRoots.add(canonical);
  return canonical;
}

async function storeFor(requestedRoot: unknown): Promise<ProjectStore> {
  if (typeof requestedRoot !== "string") throw new Error("project pathが不正です。");
  const canonical = await realpath(requestedRoot);
  if (!allowedRoots.has(canonical)) throw new Error("この起動中に開いたprojectではありません。");
  return new ProjectStore(canonical);
}

async function summary(store: ProjectStore): Promise<ProjectSummary> {
  return { root: store.root, manifest: await store.manifest() };
}

async function chooseNewProject(title: unknown): Promise<ProjectSummary | null> {
  if (typeof title !== "string" || title.trim().length === 0 || title.length > 200) throw new Error("作品名は1〜200文字で入力してください。");
  const selected = await dialog.showSaveDialog(mainWindow!, {
    title: "新しいNovel Lens projectを作成",
    defaultPath: title.trim(),
    buttonLabel: "この場所に作成",
    properties: ["createDirectory", "showOverwriteConfirmation"]
  });
  if (selected.canceled || selected.filePath.length === 0) return null;
  const root = resolve(selected.filePath);
  if (existsSync(root)) {
    const entries = await readdir(root);
    if (entries.length > 0) throw new Error("空ではないフォルダーには新規projectを作成できません。");
  } else {
    await mkdir(root, { recursive: true });
  }
  const store = await ProjectStore.create(root, title.trim());
  await store.createChapter("第一章", "");
  await registerRoot(root);
  await store.checkpoint("最初の保存点");
  return summary(store);
}

async function chooseExistingProject(): Promise<ProjectSummary | null> {
  const selected = await dialog.showOpenDialog(mainWindow!, {
    title: "Novel Lens projectを開く",
    buttonLabel: "開く",
    properties: ["openDirectory"]
  });
  const selectedPath = selected.filePaths[0];
  if (selected.canceled || selectedPath === undefined) return null;
  const root = await registerRoot(selectedPath);
  const store = new ProjectStore(root);
  await store.open();
  return summary(store);
}

function registerIpc(): void {
  handle("app:info", () => ({ name: app.getName(), version: app.getVersion(), platform: process.platform }));
  handle("project:create", chooseNewProject);
  handle("project:open", chooseExistingProject);
  handle("project:refresh", async (root) => summary(await storeFor(root)));
  handle("chapter:read", async (root, chapterId): Promise<ChapterDocument> => {
    if (typeof chapterId !== "string") throw new Error("章IDが不正です。");
    const store = await storeFor(root);
    const manifest = await store.manifest();
    const chapter = manifest.chapters.find((item) => item.id === chapterId);
    if (chapter === undefined) throw new Error("chapter not found");
    return { chapter, text: await store.readChapter(chapterId) };
  });
  handle("chapter:save", async (root, chapterId, text) => {
    if (typeof chapterId !== "string" || typeof text !== "string" || text.length > 10_000_000) throw new Error("保存する本文を確認してください。");
    await (await storeFor(root)).saveChapter(chapterId, text);
  });
  handle("chapter:create", async (root, title) => {
    if (typeof title !== "string" || title.trim().length === 0 || title.length > 200) throw new Error("章タイトルを確認してください。");
    return (await storeFor(root)).createChapter(title);
  });
  handle("chapter:import", async (root) => {
    const store = await storeFor(root);
    const selected = await dialog.showOpenDialog(mainWindow!, {
      title: "TXT / Markdownを章・場面として取り込む",
      buttonLabel: "取り込む",
      properties: ["openFile", "multiSelections"],
      filters: [{ name: "Text / Markdown", extensions: ["txt", "md", "markdown"] }]
    });
    if (selected.canceled || selected.filePaths.length === 0) return null;
    const buffers = await Promise.all(selected.filePaths.map((path) => readFile(path)));
    if (buffers.reduce((sum, value) => sum + value.byteLength, 0) > 50_000_000) throw new Error("取り込むファイルの合計が50MBを超えています。");
    const decoder = new TextDecoder("utf-8", { fatal: true });
    const importedChapterIds: string[] = [];
    for (let index = 0; index < selected.filePaths.length; index += 1) {
      const path = selected.filePaths[index]!;
      const buffer = buffers[index]!;
      let text: string;
      try { text = decoder.decode(buffer); }
      catch { throw new Error(`${basename(path)} はUTF-8として読み込めません。`); }
      const extension = extname(path);
      const created = await store.createChapter(basename(path, extension), text.replace(/^\uFEFF/u, ""));
      importedChapterIds.push(created.id);
    }
    return { project: await summary(store), importedChapterIds };
  });
  handle("chapter:rename", async (root, chapterId, title) => {
    if (typeof chapterId !== "string" || typeof title !== "string" || title.trim().length === 0 || title.length > 200) throw new Error("章タイトルを確認してください。");
    await (await storeFor(root)).renameChapter(chapterId, title);
  });
  handle("chapter:reorder", async (root, chapterIds) => {
    if (!Array.isArray(chapterIds) || chapterIds.some((id) => typeof id !== "string")) throw new Error("章順を確認できません。");
    const store = await storeFor(root);
    await store.reorderChapters(chapterIds as string[]);
    return summary(store);
  });
  handle("project:rename", async (root, title) => {
    if (typeof title !== "string") throw new Error("作品名を確認してください。");
    const store = await storeFor(root);
    await store.renameProject(title);
    return summary(store);
  });
  handle("chapter:delete", async (root, chapterId) => {
    if (typeof chapterId !== "string") throw new Error("章IDが不正です。");
    await (await storeFor(root)).deleteChapter(chapterId);
  });
  handle("project:settings", async (root, settings) => {
    if (typeof settings !== "object" || settings === null) throw new Error("設定を確認してください。");
    const source = settings as Record<string, unknown>;
    const safeSettings: ProjectSettings = {};
    if (source["writingMode"] === "horizontal" || source["writingMode"] === "vertical-rl") safeSettings.writingMode = source["writingMode"];
    if (typeof source["font"] === "string" && source["font"].length <= 200) safeSettings.font = source["font"];
    if (typeof source["width"] === "number" && source["width"] >= 480 && source["width"] <= 1600) safeSettings.width = source["width"];
    if (typeof source["lineHeight"] === "number" && source["lineHeight"] >= 1.2 && source["lineHeight"] <= 3) safeSettings.lineHeight = source["lineHeight"];
    if (typeof source["fontSize"] === "number" && source["fontSize"] >= 12 && source["fontSize"] <= 36) safeSettings["fontSize"] = source["fontSize"];
    if (source["theme"] === "paper" || source["theme"] === "dark" || source["theme"] === "sepia") safeSettings["theme"] = source["theme"];
    const store = await storeFor(root);
    await store.updateSettings(safeSettings);
    return summary(store);
  });
  handle("project:search", async (root, query) => {
    if (typeof query !== "string" || query.trim().length === 0 || query.length > 500) return [];
    return (await (await storeFor(root)).search(query)).map(({ chapterId, title, start, end, excerpt }) => ({ chapterId, title, start, end, excerpt }));
  });
  handle("history:checkpoint", async (root, subject) => {
    if (typeof subject !== "string" || subject.trim().length === 0 || subject.length > 200) throw new Error("保存点の名前を確認してください。");
    return (await storeFor(root)).checkpoint(subject.trim());
  });
  handle("history:list", async (root) => {
    const store = await storeFor(root);
    return store.history(100);
  });
  handle("history:restore", async (root, commit) => {
    if (typeof commit !== "string") throw new Error("保存点を確認できません。");
    const store = await storeFor(root);
    await store.restore(commit);
    return summary(store);
  });
  handle("project:variation", async (root) => {
    const store = await storeFor(root);
    const selected = await dialog.showSaveDialog(mainWindow!, {
      title: "別案を新しいフォルダーへ作成",
      defaultPath: `${basename(store.root)}-別案`,
      buttonLabel: "別案を作成",
      properties: ["createDirectory", "showOverwriteConfirmation"]
    });
    if (selected.canceled || selected.filePath.length === 0) return null;
    await store.createVariation(selected.filePath);
    return selected.filePath;
  });
  handle("project:export", async (root) => {
    const store = await storeFor(root);
    const selected = await dialog.showSaveDialog(mainWindow!, {
      title: "作品を結合Markdownとして書き出す",
      defaultPath: join(dirname(store.root), `${basename(store.root)}.md`),
      buttonLabel: "書き出す",
      filters: [{ name: "Markdown", extensions: ["md"] }]
    });
    if (selected.canceled || selected.filePath.length === 0) return null;
    await writeFile(selected.filePath, await store.exportMarkdown(), "utf8");
    return selected.filePath;
  });
  handle("lens:run", async (input) => runLens(input as LensRunInput));
  ipcMain.on("app:close-ready", (event) => {
    if (mainWindow === null || event.sender !== mainWindow.webContents) return;
    closeApproved = true;
    if (closeFallback !== null) { clearTimeout(closeFallback); closeFallback = null; }
    mainWindow.close();
  });
}

function sendMenuAction(action: "new" | "open" | "save" | "checkpoint" | "export"): void {
  mainWindow?.webContents.send("menu:action", action);
}

function installMenu(): void {
  const template: MenuItemConstructorOptions[] = [
    {
      label: "ファイル",
      submenu: [
        { label: "新しい作品", accelerator: "CmdOrCtrl+N", click: () => sendMenuAction("new") },
        { label: "作品を開く", accelerator: "CmdOrCtrl+O", click: () => sendMenuAction("open") },
        { type: "separator" },
        { label: "保存", accelerator: "CmdOrCtrl+S", click: () => sendMenuAction("save") },
        { label: "保存点を作る", accelerator: "CmdOrCtrl+Shift+S", click: () => sendMenuAction("checkpoint") },
        { label: "Markdownを書き出す", click: () => sendMenuAction("export") },
        { type: "separator" },
        { role: process.platform === "darwin" ? "close" : "quit" }
      ]
    },
    { label: "編集", submenu: [{ role: "undo" }, { role: "redo" }, { type: "separator" }, { role: "cut" }, { role: "copy" }, { role: "paste" }, { role: "selectAll" }] },
    { label: "表示", submenu: [{ role: "reload" }, { role: "togglefullscreen" }, { type: "separator" }, { role: "resetZoom" }, { role: "zoomIn" }, { role: "zoomOut" }] }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function createWindow(): Promise<void> {
  closeApproved = false;
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 980,
    minHeight: 680,
    backgroundColor: "#f3efe7",
    title: "Novel Lens",
    show: false,
    webPreferences: {
      preload: join(__dirname, "../dist-preload/index.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false
    }
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.webContents.on("will-navigate", (event) => event.preventDefault());
  mainWindow.on("close", (event) => {
    if (closeApproved) return;
    event.preventDefault();
    mainWindow?.webContents.send("app:before-close");
    if (closeFallback === null) {
      closeFallback = setTimeout(() => {
        closeApproved = true;
        closeFallback = null;
        mainWindow?.close();
      }, 4000);
    }
  });
  mainWindow.once("ready-to-show", () => mainWindow?.show());
  await mainWindow.loadFile(join(__dirname, "../dist/index.html"));
  mainWindow.on("closed", () => { mainWindow = null; });
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on("second-instance", () => { if (mainWindow !== null) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.focus(); } });
  app.whenReady().then(async () => {
    app.setAppUserModelId("org.novellens.desktop");
    session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
    session.defaultSession.setPermissionCheckHandler(() => false);
    registerIpc();
    installMenu();
    await createWindow();
    app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) void createWindow(); });
  });
  app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
}
