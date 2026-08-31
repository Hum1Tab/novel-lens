import { getRole, ROLE_REGISTRY, textStats } from "@novel-lens/editor-core";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";

import { defaultUserSettings, type UserSettingsPatch } from "../shared/settings.js";
import type {
  AppInfo,
  ChapterDocument,
  CheckpointEntry,
  ConnectionStatus,
  LensFinding,
  LensMessage,
  LensProviderId,
  LensRunResult,
  ProjectSettings,
  ProjectSummary,
  RoleId,
  SearchHit,
  UpdateStatus
} from "../shared/types.js";
import { SettingsView, type SettingsCategory } from "./SettingsView.js";

type InspectorTab = "lens" | "search" | "history";
type SaveState = "saved" | "dirty" | "saving" | "error";
type ScopeMode = "current" | "through-current" | "all";

interface TextPromptRequest {
  id: number;
  title: string;
  label: string;
  initialValue: string;
  confirmLabel: string;
}

type TextPromptOptions = Omit<TextPromptRequest, "id">;

const ROLE_IDS = Object.keys(ROLE_REGISTRY) as RoleId[];
const DEFAULT_QUERY = "この範囲で、作者が見直す価値のある箇所を根拠付きで教えてください。";
const EMPTY_THREADS = (): Record<RoleId, LensMessage[]> => ({ "first-reader": [], editor: [], critic: [], consistency: [], setting: [] });
const DEFAULT_CONNECTIONS: ConnectionStatus = {
  openai: { connected: false, state: "disconnected", storage: "none", message: "OpenAI APIは未接続です。", verifiedAt: null },
  github: { cliInstalled: false, connected: false, state: "unavailable", message: "GitHub CLIの状態をまだ確認していません。" }
};

function errorText(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  return raw.replace(/^Error invoking remote method '[^']+': Error:\s*/u, "").slice(0, 500);
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : new Intl.DateTimeFormat("ja-JP", { dateStyle: "short", timeStyle: "short" }).format(date);
}

function settingNumber(settings: ProjectSettings, key: string, fallback: number): number {
  const value = settings[key];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function App(): ReactNode {
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
  const [userSettings, setUserSettings] = useState(defaultUserSettings);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsCategory, setSettingsCategory] = useState<SettingsCategory>("general");
  const [connections, setConnections] = useState<ConnectionStatus>(DEFAULT_CONNECTIONS);
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null);
  const [project, setProject] = useState<ProjectSummary | null>(null);
  const [activeChapterId, setActiveChapterId] = useState<string | null>(null);
  const [chapter, setChapter] = useState<ChapterDocument | null>(null);
  const [text, setText] = useState("");
  const [savedText, setSavedText] = useState("");
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [isComposing, setIsComposing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>("lens");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchHits, setSearchHits] = useState<SearchHit[]>([]);
  const [checkpoints, setCheckpoints] = useState<CheckpointEntry[]>([]);
  const [role, setRole] = useState<RoleId>("first-reader");
  const [provider, setProvider] = useState<LensProviderId>("mock");
  const [modelId, setModelId] = useState("gpt-5-mini");
  const [lensQuery, setLensQuery] = useState(DEFAULT_QUERY);
  const [scopeMode, setScopeMode] = useState<ScopeMode>("through-current");
  const [scopeApproved, setScopeApproved] = useState(false);
  const [threads, setThreads] = useState<Record<RoleId, LensMessage[]>>(EMPTY_THREADS);
  const [lensResult, setLensResult] = useState<LensRunResult | null>(null);
  const [lensBusy, setLensBusy] = useState(false);
  const [textPrompt, setTextPrompt] = useState<TextPromptRequest | null>(null);
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const promptResolverRef = useRef<((value: string | null) => void) | null>(null);
  const promptSequenceRef = useRef(0);

  const requestText = useCallback((options: TextPromptOptions): Promise<string | null> => {
    promptResolverRef.current?.(null);
    promptSequenceRef.current += 1;
    setTextPrompt({ id: promptSequenceRef.current, ...options });
    return new Promise((resolve) => { promptResolverRef.current = resolve; });
  }, []);

  const finishTextPrompt = useCallback((value: string | null): void => {
    const resolvePrompt = promptResolverRef.current;
    promptResolverRef.current = null;
    setTextPrompt(null);
    resolvePrompt?.(value);
  }, []);

  useEffect(() => () => {
    promptResolverRef.current?.(null);
    promptResolverRef.current = null;
  }, []);

  useEffect(() => {
    void window.novelLens.appInfo().then(setAppInfo).catch(() => undefined);
    void window.novelLens.getUserSettings().then((loaded) => {
      setUserSettings(loaded);
      setProvider(loaded.ai.defaultProvider);
      setModelId(loaded.ai.openaiModel);
    }).catch(() => undefined);
    const removeUpdateListener = window.novelLens.onUpdateStatus(setUpdateStatus);
    const removeConnectionListener = window.novelLens.onConnectionStatus(setConnections);
    return () => { removeUpdateListener(); removeConnectionListener(); };
  }, []);

  const manifestChapters = useMemo(() => [...(project?.manifest.chapters ?? [])].sort((a, b) => a.order - b.order), [project]);
  const activeIndex = manifestChapters.findIndex((item) => item.id === activeChapterId);
  const settings = project?.manifest.settings ?? {};
  const writingMode = settings.writingMode ?? userSettings.editor.writingMode;
  const editorFont = settings.font ?? userSettings.editor.font;
  const editorWidth = settingNumber(settings, "width", userSettings.editor.width);
  const editorLineHeight = settingNumber(settings, "lineHeight", userSettings.editor.lineHeight);
  const editorFontSize = settingNumber(settings, "fontSize", userSettings.editor.fontSize);
  const theme = settings["theme"] === "dark" || settings["theme"] === "sepia" || settings["theme"] === "paper" ? settings["theme"] : userSettings.editor.theme;
  const stats = useMemo(() => textStats(text), [text]);

  const scopeChapters = useMemo(() => {
    if (activeIndex < 0) return [];
    if (scopeMode === "current") return [manifestChapters[activeIndex]!];
    if (scopeMode === "through-current") return manifestChapters.slice(0, activeIndex + 1);
    return manifestChapters;
  }, [activeIndex, manifestChapters, scopeMode]);

  useEffect(() => { setScopeApproved(false); }, [role, scopeMode, activeChapterId, project?.root]);

  const clearMessages = useCallback(() => { setError(null); setNotice(null); }, []);

  const saveNow = useCallback(async (): Promise<void> => {
    if (project === null || activeChapterId === null || text === savedText) return;
    setSaveState("saving");
    try {
      await window.novelLens.saveChapter(project.root, activeChapterId, text);
      setSavedText(text);
      setSaveState("saved");
    } catch (cause) {
      setSaveState("error");
      setError(errorText(cause));
      throw cause;
    }
  }, [activeChapterId, project, savedText, text]);

  useEffect(() => {
    if (text === savedText) { if (saveState !== "saving") setSaveState("saved"); return; }
    setSaveState("dirty");
    if (isComposing || project === null || activeChapterId === null) return;
    const timer = window.setTimeout(() => { void saveNow(); }, userSettings.general.autoSaveDelayMs);
    return () => window.clearTimeout(timer);
  }, [activeChapterId, isComposing, project, saveNow, saveState, savedText, text, userSettings.general.autoSaveDelayMs]);

  const focusRange = useCallback((start: number, end: number): void => {
    window.setTimeout(() => {
      const editor = editorRef.current;
      if (editor === null) return;
      editor.focus();
      editor.setSelectionRange(start, end);
    }, 60);
  }, []);

  const loadChapter = useCallback(async (chapterId: string, range?: { start: number; end: number }): Promise<void> => {
    if (project === null) return;
    await saveNow();
    clearMessages();
    setBusy(true);
    try {
      const next = await window.novelLens.readChapter(project.root, chapterId);
      setActiveChapterId(chapterId);
      setChapter(next);
      setText(next.text);
      setSavedText(next.text);
      setSaveState("saved");
      if (range !== undefined) focusRange(range.start, range.end);
    } catch (cause) { setError(errorText(cause)); }
    finally { setBusy(false); }
  }, [clearMessages, focusRange, project, saveNow]);

  const adoptProject = useCallback(async (next: ProjectSummary | null): Promise<void> => {
    if (next === null) return;
    setProject(next);
    setThreads(EMPTY_THREADS());
    setLensResult(null);
    setSearchHits([]);
    setCheckpoints([]);
    setError(null);
    setNotice(`「${next.manifest.title}」を開きました。`);
    const first = [...next.manifest.chapters].sort((a, b) => a.order - b.order)[0];
    if (first === undefined) {
      setActiveChapterId(null); setChapter(null); setText(""); setSavedText("");
      return;
    }
    const loaded = await window.novelLens.readChapter(next.root, first.id);
    setActiveChapterId(first.id); setChapter(loaded); setText(loaded.text); setSavedText(loaded.text); setSaveState("saved");
  }, []);

  const createProject = useCallback(async (): Promise<void> => {
    const title = await requestText({
      title: "新しい作品を作る",
      label: "作品名",
      initialValue: "新しい小説",
      confirmLabel: "保存場所を選ぶ"
    });
    if (title === null || title.trim().length === 0) return;
    await saveNow(); clearMessages(); setBusy(true);
    try { await adoptProject(await window.novelLens.createProject(title.trim())); }
    catch (cause) { setError(errorText(cause)); }
    finally { setBusy(false); }
  }, [adoptProject, clearMessages, requestText, saveNow]);

  const openProject = useCallback(async (): Promise<void> => {
    await saveNow(); clearMessages(); setBusy(true);
    try { await adoptProject(await window.novelLens.openProject()); }
    catch (cause) { setError(errorText(cause)); }
    finally { setBusy(false); }
  }, [adoptProject, clearMessages, saveNow]);

  const exportProject = useCallback(async (): Promise<void> => {
    if (project === null) return;
    try { await saveNow(); const path = await window.novelLens.exportMarkdown(project.root); if (path !== null) setNotice(`Markdownを書き出しました: ${path}`); }
    catch (cause) { setError(errorText(cause)); }
  }, [project, saveNow]);

  const refreshProject = useCallback(async (): Promise<ProjectSummary | null> => {
    if (project === null) return null;
    const refreshed = await window.novelLens.refreshProject(project.root);
    setProject(refreshed);
    return refreshed;
  }, [project]);

  const addChapter = useCallback(async (): Promise<void> => {
    if (project === null) return;
    const title = await requestText({
      title: "章・場面を追加",
      label: "タイトル",
      initialValue: `第${manifestChapters.length + 1}章`,
      confirmLabel: "追加する"
    });
    if (title === null || title.trim().length === 0) return;
    try { await saveNow(); const created = await window.novelLens.createChapter(project.root, title.trim()); await refreshProject(); await loadChapter(created.id); }
    catch (cause) { setError(errorText(cause)); }
  }, [loadChapter, manifestChapters.length, project, refreshProject, requestText, saveNow]);

  const importDocuments = useCallback(async (): Promise<void> => {
    if (project === null) return;
    try {
      await saveNow();
      const imported = await window.novelLens.importDocuments(project.root);
      if (imported === null) return;
      setProject(imported.project);
      const firstId = imported.importedChapterIds[0];
      if (firstId !== undefined) await loadChapter(firstId);
      setNotice(`${imported.importedChapterIds.length}件のファイルを取り込みました。`);
    } catch (cause) { setError(errorText(cause)); }
  }, [loadChapter, project, saveNow]);

  const moveChapter = useCallback(async (delta: -1 | 1): Promise<void> => {
    if (project === null || activeIndex < 0) return;
    const destination = activeIndex + delta;
    if (destination < 0 || destination >= manifestChapters.length) return;
    const ids = manifestChapters.map((item) => item.id);
    const current = ids[activeIndex]!;
    ids[activeIndex] = ids[destination]!;
    ids[destination] = current;
    try { setProject(await window.novelLens.reorderChapters(project.root, ids)); }
    catch (cause) { setError(errorText(cause)); }
  }, [activeIndex, manifestChapters, project]);

  const renameProject = useCallback(async (): Promise<void> => {
    if (project === null) return;
    const title = await requestText({
      title: "作品名を変更",
      label: "作品名",
      initialValue: project.manifest.title,
      confirmLabel: "変更する"
    });
    if (title === null || title.trim().length === 0 || title.trim() === project.manifest.title) return;
    try { setProject(await window.novelLens.renameProject(project.root, title.trim())); }
    catch (cause) { setError(errorText(cause)); }
  }, [project, requestText]);

  const renameChapter = useCallback(async (): Promise<void> => {
    if (project === null || chapter === null) return;
    const title = await requestText({
      title: "章・場面の名前を変更",
      label: "タイトル",
      initialValue: chapter.chapter.title,
      confirmLabel: "変更する"
    });
    if (title === null || title.trim().length === 0 || title.trim() === chapter.chapter.title) return;
    try { await window.novelLens.renameChapter(project.root, chapter.chapter.id, title.trim()); const refreshed = await refreshProject(); const found = refreshed?.manifest.chapters.find((item) => item.id === chapter.chapter.id); if (found !== undefined) setChapter({ ...chapter, chapter: found }); }
    catch (cause) { setError(errorText(cause)); }
  }, [chapter, project, refreshProject, requestText]);

  const deleteChapter = useCallback(async (): Promise<void> => {
    if (project === null || chapter === null) return;
    if (manifestChapters.length <= 1) { setError("作品には少なくとも1つの章・場面が必要です。"); return; }
    if (!window.confirm(`「${chapter.chapter.title}」を削除します。直前に保存点を作成します。よろしいですか？`)) return;
    try {
      await saveNow();
      await window.novelLens.createCheckpoint(project.root, `「${chapter.chapter.title}」削除前`);
      const oldIndex = activeIndex;
      await window.novelLens.deleteChapter(project.root, chapter.chapter.id);
      const refreshed = await refreshProject();
      const next = refreshed?.manifest.chapters[Math.max(0, Math.min(oldIndex, (refreshed?.manifest.chapters.length ?? 1) - 1))];
      if (next !== undefined) await loadChapter(next.id);
    } catch (cause) { setError(errorText(cause)); }
  }, [activeIndex, chapter, loadChapter, manifestChapters.length, project, refreshProject, saveNow]);

  const runSearch = useCallback(async (): Promise<void> => {
    if (project === null || searchQuery.trim().length === 0) { setSearchHits([]); return; }
    try { await saveNow(); setSearchHits(await window.novelLens.search(project.root, searchQuery.trim())); }
    catch (cause) { setError(errorText(cause)); }
  }, [project, saveNow, searchQuery]);

  const loadCheckpoints = useCallback(async (): Promise<void> => {
    if (project === null) return;
    try { setCheckpoints(await window.novelLens.listCheckpoints(project.root)); }
    catch (cause) { setError(errorText(cause)); }
  }, [project]);

  useEffect(() => { if (inspectorTab === "history") void loadCheckpoints(); }, [inspectorTab, loadCheckpoints]);

  const createCheckpoint = useCallback(async (): Promise<void> => {
    if (project === null) return;
    const subject = await requestText({
      title: "保存点を作る",
      label: "保存点の名前",
      initialValue: "ここまでの改稿",
      confirmLabel: "保存点を作る"
    });
    if (subject === null || subject.trim().length === 0) return;
    try { await saveNow(); await window.novelLens.createCheckpoint(project.root, subject.trim()); await loadCheckpoints(); setNotice("保存点を作成しました。"); }
    catch (cause) { setError(errorText(cause)); }
  }, [loadCheckpoints, project, requestText, saveNow]);

  const restoreCheckpoint = useCallback(async (entry: CheckpointEntry): Promise<void> => {
    if (project === null || !window.confirm(`保存点「${entry.subject}」へ戻します。現在の状態は復元前の保存点として残します。`)) return;
    try {
      await saveNow();
      const restored = await window.novelLens.restoreCheckpoint(project.root, entry.commit);
      setProject(restored);
      const desired = restored.manifest.chapters.find((item) => item.id === activeChapterId) ?? restored.manifest.chapters[0];
      if (desired !== undefined) {
        const loaded = await window.novelLens.readChapter(restored.root, desired.id);
        setActiveChapterId(desired.id); setChapter(loaded); setText(loaded.text); setSavedText(loaded.text); setSaveState("saved");
      }
      await loadCheckpoints();
      setNotice("保存点から復元しました。");
    } catch (cause) { setError(errorText(cause)); }
  }, [activeChapterId, loadCheckpoints, project, saveNow]);

  const createVariation = useCallback(async (): Promise<void> => {
    if (project === null) return;
    try { await saveNow(); const path = await window.novelLens.createVariation(project.root); if (path !== null) setNotice(`別案を作成しました: ${path}`); }
    catch (cause) { setError(errorText(cause)); }
  }, [project, saveNow]);

  const updateProjectSettings = useCallback(async (patch: ProjectSettings): Promise<void> => {
    if (project === null) return;
    try { setProject(await window.novelLens.updateSettings(project.root, patch)); }
    catch (cause) { setError(errorText(cause)); }
  }, [project]);

  const resetProjectSetting = useCallback(async (key: "writingMode" | "theme" | "font" | "fontSize" | "lineHeight" | "width"): Promise<void> => {
    if (project === null) return;
    try { setProject(await window.novelLens.resetProjectSetting(project.root, key)); }
    catch (cause) { setError(errorText(cause)); throw cause; }
  }, [project]);

  const updateUserSettings = useCallback(async (patch: UserSettingsPatch): Promise<void> => {
    try {
      const next = await window.novelLens.updateUserSettings(patch);
      setUserSettings(next);
      if (patch.ai?.defaultProvider !== undefined) setProvider(next.ai.defaultProvider);
      if (patch.ai?.openaiModel !== undefined) setModelId(next.ai.openaiModel);
    } catch (cause) { setError(errorText(cause)); throw cause; }
  }, []);

  const openSettings = useCallback((category: SettingsCategory = "general"): void => {
    setSettingsCategory(category);
    setSettingsOpen(true);
  }, []);

  const refreshConnections = useCallback(async (): Promise<void> => {
    try { setConnections(await window.novelLens.connectionStatus()); }
    catch (cause) { setError(errorText(cause)); }
  }, []);

  const connectOpenAI = useCallback(async (key: string): Promise<void> => {
    try { setConnections(await window.novelLens.connectOpenAI(key)); }
    catch (cause) { await refreshConnections(); throw cause; }
  }, [refreshConnections]);

  const disconnectOpenAI = useCallback(async (): Promise<void> => {
    setConnections(await window.novelLens.disconnectOpenAI());
  }, []);

  const loginGitHub = useCallback(async (): Promise<void> => {
    try { setConnections(await window.novelLens.loginGitHub()); }
    catch (cause) { await refreshConnections(); throw cause; }
  }, [refreshConnections]);

  const checkUpdates = useCallback(async (): Promise<void> => {
    setUpdateStatus(await window.novelLens.checkForUpdates());
  }, []);

  const resetKeybindings = useCallback(async (): Promise<void> => {
    setUserSettings(await window.novelLens.resetKeybindings());
  }, []);

  const openExternalPage = useCallback(async (page: "chatgpt" | "openai-api-keys" | "github-cli" | "github-applications" | "latest-release"): Promise<void> => {
    try { await window.novelLens.openExternalPage(page); }
    catch (cause) { setError(errorText(cause)); }
  }, []);

  const installUpdate = useCallback(async (): Promise<void> => {
    try {
      await saveNow();
      setUpdateStatus(await window.novelLens.installUpdate());
    }
    catch (cause) { setError(errorText(cause)); }
  }, [saveNow]);

  const openUpdatePage = useCallback(async (): Promise<void> => {
    try { await window.novelLens.openUpdatePage(); }
    catch (cause) { setError(errorText(cause)); }
  }, []);

  const invokeLens = useCallback(async (): Promise<void> => {
    if (project === null || scopeChapters.length === 0 || !scopeApproved) return;
    const query = lensQuery.trim();
    if (query.length === 0) return;
    setLensBusy(true); setError(null); setNotice(null);
    try {
      await saveNow();
      const inputs = await Promise.all(scopeChapters.map(async (item) => ({ id: item.id, title: item.title, order: item.order, text: (await window.novelLens.readChapter(project.root, item.id)).text })));
      const userMessage: LensMessage = { sender: "author", text: query, createdAt: new Date().toISOString() };
      const conversation = [...threads[role], userMessage];
      const result = await window.novelLens.runLens({ role, query, chapters: inputs, provider, modelId: provider === "mock" ? "offline-mock-v0.1" : modelId, conversation });
      setLensResult(result);
      const responseText = [result.summary, ...result.findings.map((finding) => `・${finding.title}: ${finding.observation}`)].join("\n");
      setThreads((current) => ({ ...current, [role]: [...conversation, { sender: "lens", text: responseText, createdAt: new Date().toISOString() }] }));
      setLensQuery("");
    } catch (cause) { setError(errorText(cause)); }
    finally { setLensBusy(false); }
  }, [lensQuery, modelId, project, provider, role, saveNow, scopeApproved, scopeChapters, threads]);

  const jumpToFinding = useCallback(async (finding: LensFinding): Promise<void> => {
    if (finding.chapterId === null || finding.startUtf16 === null || finding.endUtf16 === null || finding.anchorStatus !== "attached") return;
    await loadChapter(finding.chapterId, { start: finding.startUtf16, end: finding.endUtf16 });
  }, [loadChapter]);

  useEffect(() => window.novelLens.onMenuAction((action) => {
    if (action === "file.new") void createProject();
    else if (action === "file.open") void openProject();
    else if (action === "file.save") void saveNow();
    else if (action === "history.checkpoint") void createCheckpoint();
    else if (action === "file.export") void exportProject();
    else if (action === "view.settings") openSettings("general");
    else if (action === "view.settings.editor") openSettings("editor");
    else if (action === "view.settings.ai") openSettings("ai");
    else if (action === "view.settings.accounts") openSettings("accounts");
    else if (action === "view.settings.keyboard") openSettings("keyboard");
    else if (action === "view.settings.updates") openSettings("updates");
    else if (action === "view.search") { setSettingsOpen(false); setInspectorTab("search"); }
    else if (action === "view.lens") { setSettingsOpen(false); setInspectorTab("lens"); }
    else if (action === "view.history") { setSettingsOpen(false); setInspectorTab("history"); }
    else if (action === "updates.check") { openSettings("updates"); void checkUpdates(); }
  }), [checkUpdates, createCheckpoint, createProject, exportProject, openProject, openSettings, saveNow]);

  useEffect(() => window.novelLens.onBeforeClose(saveNow), [saveNow]);

  const editorStyle = {
    "--editor-font": editorFont,
    "--editor-width": `${editorWidth}px`,
    "--editor-line-height": editorLineHeight,
    "--editor-font-size": `${editorFontSize}px`
  } as CSSProperties;

  const promptDialog = textPrompt === null ? null : <TextPrompt
    key={textPrompt.id}
    request={textPrompt}
    onCancel={() => finishTextPrompt(null)}
    onSubmit={(value) => finishTextPrompt(value)}
  />;

  const settingsOverlay = settingsOpen ? <SettingsView
    category={settingsCategory}
    setCategory={setSettingsCategory}
    settings={userSettings}
    project={project}
    appInfo={appInfo}
    connections={connections}
    updateStatus={updateStatus}
    onClose={() => setSettingsOpen(false)}
    onUpdateUser={updateUserSettings}
    onUpdateProject={updateProjectSettings}
    onResetProjectSetting={resetProjectSetting}
    onRefreshConnections={refreshConnections}
    onConnectOpenAI={connectOpenAI}
    onDisconnectOpenAI={disconnectOpenAI}
    onLoginGitHub={loginGitHub}
    onResetKeybindings={resetKeybindings}
    onCheckUpdates={checkUpdates}
    onInstallUpdate={installUpdate}
    onOpenUpdatePage={openUpdatePage}
    onOpenExternal={openExternalPage}
  /> : null;

  if (project === null) return <>
    <Welcome appInfo={appInfo} busy={busy} error={error} onCreate={createProject} onOpen={openProject} onSettings={() => openSettings("general")} />
    {promptDialog}
    {settingsOverlay}
  </>;

  return <><div className={`app theme-${theme}`} style={editorStyle}>
    <header className="topbar">
      <div className="brand"><span className="brand-mark">NL</span><div><b>Novel Lens</b><button className="project-title" onClick={renameProject} title="作品名を変更">{project.manifest.title}</button></div></div>
      <div className="top-actions">
        <button className="ghost" onClick={openProject}>作品を開く</button>
        <button className="ghost" onClick={createCheckpoint}>保存点</button>
        <button className="ghost" onClick={createVariation}>別案</button>
        <button className="ghost" onClick={exportProject}>書き出し</button>
        <button className="ghost settings-trigger" onClick={() => openSettings("general")} aria-label="設定を開く" title="設定">⚙</button>
        <span className={`save-indicator ${saveState}`}>{saveState === "saved" ? "保存済み" : saveState === "saving" ? "保存中…" : saveState === "dirty" ? "未保存" : "保存エラー"}</span>
      </div>
    </header>

    {(error !== null || notice !== null) && <div className={`banner ${error !== null ? "error" : "notice"}`} role="status"><span>{error ?? notice}</span><button aria-label="閉じる" onClick={clearMessages}>×</button></div>}

    <div className="workspace">
      <aside className="outline-pane">
        <div className="pane-heading"><div><span className="eyebrow">MANUSCRIPT</span><h2>章・場面</h2></div><div className="pane-tools"><button className="icon-button import-button" title="TXT / Markdownを取り込む" onClick={importDocuments}>⇩</button><button className="icon-button" title="章・場面を追加" onClick={addChapter}>＋</button></div></div>
        <nav className="chapter-list" aria-label="章・場面">
          {manifestChapters.map((item) => <button key={item.id} className={item.id === activeChapterId ? "chapter active" : "chapter"} onClick={() => void loadChapter(item.id)} disabled={busy}>
            <span className="chapter-order">{String(item.order + 1).padStart(2, "0")}</span><span>{item.title}</span>
          </button>)}
        </nav>
        <div className="outline-footer"><code title={project.root}>{project.root}</code><span>Markdown正本</span></div>
      </aside>

      <main className={`editor-pane ${writingMode === "vertical-rl" ? "vertical" : "horizontal"}`}>
        <div className="editor-toolbar">
          <div><span className="eyebrow">{writingMode === "vertical-rl" ? "VERTICAL WRITING" : "WRITING"}</span><h1>{chapter?.chapter.title ?? "章を選択"}</h1></div>
          <div className="editor-actions"><button className="ghost compact" disabled={activeIndex <= 0} title="前へ移動" onClick={() => void moveChapter(-1)}>↑</button><button className="ghost compact" disabled={activeIndex < 0 || activeIndex >= manifestChapters.length - 1} title="後ろへ移動" onClick={() => void moveChapter(1)}>↓</button><button className="ghost compact" onClick={renameChapter}>名前変更</button><button className="ghost compact danger-text" onClick={deleteChapter}>削除</button></div>
        </div>
        <div className="editor-scroll">
          <textarea
            ref={editorRef}
            aria-label="小説本文"
            className="manuscript-editor"
            value={text}
            spellCheck={false}
            onCompositionStart={() => setIsComposing(true)}
            onCompositionEnd={() => setIsComposing(false)}
            onChange={(event) => setText(event.target.value)}
            onBlur={() => { void saveNow(); }}
            placeholder="ここから物語を書き始めます。"
          />
        </div>
        <footer className="statusbar"><span>{stats.charactersNoWhitespace.toLocaleString()}字</span><span>{stats.lines.toLocaleString()}行</span><span>{stats.words.toLocaleString()}語</span><span>{writingMode === "vertical-rl" ? "縦書き" : "横書き"}</span></footer>
      </main>

      <aside className="inspector-pane">
        <div className="tabs" role="tablist">
          {(["lens", "search", "history"] as const).map((tab) => <button key={tab} className={inspectorTab === tab ? "active" : ""} onClick={() => setInspectorTab(tab)}>{tab === "lens" ? "レンズ" : tab === "search" ? "検索" : "履歴"}</button>)}
        </div>
        {inspectorTab === "lens" && <LensPanel
          role={role} setRole={setRole} provider={provider} setProvider={setProvider} modelId={modelId} setModelId={setModelId} openAIConnected={connections.openai.connected} onOpenSettings={() => openSettings("ai")}
          query={lensQuery} setQuery={setLensQuery} scopeMode={scopeMode} setScopeMode={setScopeMode} scopeTitles={scopeChapters.map((item) => item.title)}
          approved={scopeApproved} setApproved={setScopeApproved} thread={threads[role]} result={lensResult?.role === role ? lensResult : null}
          running={lensBusy} onRun={invokeLens} onClear={() => { setThreads((current) => ({ ...current, [role]: [] })); setLensResult(null); }} onFinding={jumpToFinding}
        />}
        {inspectorTab === "search" && <SearchPanel query={searchQuery} setQuery={setSearchQuery} hits={searchHits} onSearch={runSearch} onHit={(hit) => void loadChapter(hit.chapterId, hit)} />}
        {inspectorTab === "history" && <HistoryPanel entries={checkpoints} onCreate={createCheckpoint} onRestore={restoreCheckpoint} onVariation={createVariation} />}
      </aside>
    </div>
  </div>{promptDialog}{settingsOverlay}</>;
}

function TextPrompt({ request, onCancel, onSubmit }: { request: TextPromptRequest; onCancel: () => void; onSubmit: (value: string) => void }): ReactNode {
  const [value, setValue] = useState(request.initialValue);

  return <div className="prompt-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onCancel(); }}>
    <form
      className="prompt-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby={`prompt-title-${request.id}`}
      onKeyDown={(event) => { if (event.key === "Escape") onCancel(); }}
      onSubmit={(event) => { event.preventDefault(); if (value.trim().length > 0) onSubmit(value.trim()); }}
    >
      <span className="eyebrow">NOVEL LENS</span>
      <h2 id={`prompt-title-${request.id}`}>{request.title}</h2>
      <label>{request.label}<input autoFocus maxLength={200} value={value} onFocus={(event) => event.currentTarget.select()} onChange={(event) => setValue(event.target.value)} /></label>
      <div className="prompt-actions"><button type="button" className="secondary" onClick={onCancel}>キャンセル</button><button type="submit" className="primary" disabled={value.trim().length === 0}>{request.confirmLabel}</button></div>
    </form>
  </div>;
}

function Welcome({ appInfo, busy, error, onCreate, onOpen, onSettings }: { appInfo: AppInfo | null; busy: boolean; error: string | null; onCreate: () => void; onOpen: () => void; onSettings: () => void }): ReactNode {
  return <main className="welcome">
    <div className="welcome-panel">
      <span className="welcome-mark">NL</span>
      <p className="eyebrow">LOCAL-FIRST NOVEL STUDIO</p>
      <h1>物語を書く人のための、<br />静かな仕事場。</h1>
      <p className="welcome-copy">原稿はあなたのフォルダーにMarkdownで保存されます。AIは任意で、送信する章を毎回確認できます。</p>
      {error !== null && <p className="welcome-error">{error}</p>}
      <div className="welcome-actions"><button className="primary" disabled={busy} onClick={onCreate}>新しい作品を作る</button><button className="secondary" disabled={busy} onClick={onOpen}>作品フォルダーを開く</button><button className="secondary" onClick={onSettings}>設定</button></div>
      <p className="welcome-open-help">既存作品を開くときは、作品フォルダー内の <code>novel-lens.json</code> を選びます。</p>
      <div className="welcome-features"><span>縦書き・横書き</span><span>自動保存と保存点</span><span>根拠付きAIレンズ</span></div>
      <small>Novel Lens {appInfo?.version ?? ""} · {appInfo?.platform ?? "desktop"}</small>
    </div>
  </main>;
}

interface LensPanelProps {
  role: RoleId; setRole: (role: RoleId) => void; provider: LensProviderId; setProvider: (provider: LensProviderId) => void;
  modelId: string; setModelId: (value: string) => void; openAIConnected: boolean; onOpenSettings: () => void;
  query: string; setQuery: (value: string) => void; scopeMode: ScopeMode; setScopeMode: (value: ScopeMode) => void;
  scopeTitles: string[]; approved: boolean; setApproved: (value: boolean) => void; thread: LensMessage[]; result: LensRunResult | null;
  running: boolean; onRun: () => void; onClear: () => void; onFinding: (finding: LensFinding) => void;
}

function LensPanel(props: LensPanelProps): ReactNode {
  const definition = getRole(props.role);
  return <div className="inspector-content lens-panel">
    <div className="section-head"><div><span className="eyebrow">SYNTHETIC READER</span><h2>編集レンズ</h2></div>{props.thread.length > 0 && <button className="text-button" onClick={props.onClear}>会話を消す</button>}</div>
    <div className="role-grid">{ROLE_IDS.map((id) => <button key={id} className={props.role === id ? "role active" : "role"} title={getRole(id).description} onClick={() => props.setRole(id)}>{getRole(id).label}</button>)}</div>
    <p className="role-description">{definition.description}</p>

    {props.thread.length > 0 && <div className="thread" aria-label={`${definition.label}との会話`}>{props.thread.map((message, index) => <div key={`${message.createdAt}-${index}`} className={`message ${message.sender}`}><b>{message.sender === "author" ? "あなた" : definition.label}</b><p>{message.text}</p></div>)}</div>}

    {props.result !== null && <div className="finding-list"><div className="coverage">{props.result.coverage.chapterCount}章・{props.result.coverage.characterCount.toLocaleString()}字を確認</div>{props.result.findings.map((finding) => <article className={`finding priority-${finding.priority}`} key={finding.id}>
      <div className="finding-meta"><span>{finding.priority}</span><span>{finding.anchorStatus === "attached" ? "根拠確認済み" : finding.anchorStatus === "ambiguous" ? "引用が複数" : "引用未確認"}</span></div>
      <h3>{finding.title}</h3><p>{finding.observation}</p><p className="effect">読者への影響: {finding.readerEffect}</p>
      <button className="quote" disabled={finding.anchorStatus !== "attached"} onClick={() => props.onFinding(finding)}>「{finding.quote}」<small>{finding.chapterTitle ?? "原文へ接続できません"}</small></button>
    </article>)}</div>}

    <label>質問<textarea rows={4} value={props.query} onChange={(event) => props.setQuery(event.target.value)} placeholder={DEFAULT_QUERY} /></label>
    <div className="form-row"><label>接続<select value={props.provider} onChange={(event) => props.setProvider(event.target.value as LensProviderId)}><option value="mock">Offline Mock</option><option value="openai">OpenAI API</option></select></label><label>範囲<select value={props.scopeMode} onChange={(event) => props.setScopeMode(event.target.value as ScopeMode)}><option value="current">現在の章だけ</option><option value="through-current">現在の章まで</option><option value="all">全章</option></select></label></div>
    {props.provider === "openai" && <div className="lens-connection"><label>Model ID<input value={props.modelId} onChange={(event) => props.setModelId(event.target.value)} /></label><div className="lens-connection-state"><span className={props.openAIConnected ? "connected" : "disconnected"}>{props.openAIConnected ? "OpenAI接続済み" : "OpenAI未接続"}</span><button className="text-button" onClick={props.onOpenSettings}>接続設定を開く</button></div></div>}
    <details className="scope-preview" open><summary>送信範囲: {props.scopeTitles.length}章</summary><ul>{props.scopeTitles.map((title) => <li key={title}>{title}</li>)}</ul><p>未選択章、設定画面、履歴、ファイルパスは送信しません。</p></details>
    <label className="check"><input type="checkbox" checked={props.approved} onChange={(event) => props.setApproved(event.target.checked)} /> 表示された章だけを送信することを確認しました</label>
    <button className="primary full" disabled={props.running || !props.approved || props.query.trim().length === 0 || (props.provider === "openai" && !props.openAIConnected)} onClick={props.onRun}>{props.running ? "検証しながら読んでいます…" : `${definition.label}に聞く`}</button>
    <p className="privacy-note">本文の生成・書換え・自動適用は行いません。会話とAPIキーはprojectへ保存しません。</p>
  </div>;
}

function SearchPanel({ query, setQuery, hits, onSearch, onHit }: { query: string; setQuery: (value: string) => void; hits: SearchHit[]; onSearch: () => void; onHit: (hit: SearchHit) => void }): ReactNode {
  return <div className="inspector-content"><span className="eyebrow">FULL TEXT</span><h2>作品内検索</h2><div className="search-box"><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") onSearch(); }} placeholder="語句を入力" /><button onClick={onSearch}>検索</button></div><p className="result-count">{hits.length}件</p><div className="search-results">{hits.map((hit, index) => <button key={`${hit.chapterId}-${hit.start}-${index}`} onClick={() => onHit(hit)}><b>{hit.title}</b><p>{hit.excerpt}</p></button>)}</div></div>;
}

function HistoryPanel({ entries, onCreate, onRestore, onVariation }: { entries: CheckpointEntry[]; onCreate: () => void; onRestore: (entry: CheckpointEntry) => void; onVariation: () => void }): ReactNode {
  return <div className="inspector-content"><span className="eyebrow">RECOVERY</span><h2>保存点と別案</h2><p className="muted">Gitを知らなくても、節目へ戻れます。復元前の状態も自動で残します。</p><div className="history-actions"><button className="primary" onClick={onCreate}>保存点を作る</button><button className="secondary" onClick={onVariation}>別案を複製</button></div><div className="history-list">{entries.length === 0 ? <p className="empty">保存点はまだありません。</p> : entries.map((entry) => <article key={entry.commit}><div><b>{entry.subject}</b><small>{formatDate(entry.authoredAt)}</small></div><button className="text-button" onClick={() => onRestore(entry)}>ここへ戻る</button></article>)}</div></div>;
}
