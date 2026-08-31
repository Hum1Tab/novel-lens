import { useEffect, useMemo, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";

import {
  COMMAND_DEFINITIONS,
  bindingFromKeyboardEvent,
  formatKeybinding,
  type AppCommandId,
  type EditorPreferences,
  type UserSettings,
  type UserSettingsPatch
} from "../shared/settings.js";
import type { AppInfo, ConnectionStatus, ProjectSettings, ProjectSummary, UpdateStatus } from "../shared/types.js";

export type SettingsCategory = "general" | "editor" | "ai" | "accounts" | "keyboard" | "updates" | "about";
type EditorKey = keyof EditorPreferences;

interface SettingsViewProps {
  category: SettingsCategory;
  setCategory: (category: SettingsCategory) => void;
  settings: UserSettings;
  project: ProjectSummary | null;
  appInfo: AppInfo | null;
  connections: ConnectionStatus;
  updateStatus: UpdateStatus | null;
  onClose: () => void;
  onUpdateUser: (patch: UserSettingsPatch) => Promise<void>;
  onUpdateProject: (patch: ProjectSettings) => Promise<void>;
  onResetProjectSetting: (key: EditorKey) => Promise<void>;
  onRefreshConnections: () => Promise<void>;
  onConnectOpenAI: (key: string) => Promise<void>;
  onDisconnectOpenAI: () => Promise<void>;
  onLoginGitHub: () => Promise<void>;
  onResetKeybindings: () => Promise<void>;
  onCheckUpdates: () => Promise<void>;
  onInstallUpdate: () => Promise<void>;
  onOpenUpdatePage: () => Promise<void>;
  onOpenExternal: (page: "chatgpt" | "openai-api-keys" | "github-cli" | "github-applications" | "latest-release") => Promise<void>;
}

const CATEGORIES: readonly { id: SettingsCategory; label: string; icon: string; search: string }[] = [
  { id: "general", label: "全般", icon: "⌂", search: "全般 自動保存 起動" },
  { id: "editor", label: "エディター", icon: "Aa", search: "エディター 縦書き 横書き フォント テーマ 文字 行間 幅" },
  { id: "ai", label: "AI", icon: "◇", search: "AI OpenAI ChatGPT API model レンズ" },
  { id: "accounts", label: "アカウント", icon: "◎", search: "アカウント ChatGPT OpenAI GitHub ログイン 認証" },
  { id: "keyboard", label: "キーボード", icon: "⌨", search: "キーボード ショートカット キー割り当て" },
  { id: "updates", label: "更新", icon: "↻", search: "更新 アップデート install download version" },
  { id: "about", label: "情報", icon: "i", search: "情報 version license privacy OSS" }
] as const;

const EMPTY_CONNECTIONS: ConnectionStatus = {
  openai: { connected: false, state: "disconnected", storage: "none", message: "OpenAI APIは未接続です。", verifiedAt: null },
  github: { cliInstalled: false, connected: false, state: "unavailable", message: "GitHub CLIの状態を確認していません。" }
};

function projectValue(project: ProjectSummary | null, key: EditorKey): unknown {
  return project?.manifest.settings[key];
}

function settingMatches(query: string, ...terms: string[]): boolean {
  const normalized = query.trim().toLocaleLowerCase();
  return normalized.length === 0 || terms.join(" ").toLocaleLowerCase().includes(normalized);
}

function StatusBadge({ state, children }: { state: "ok" | "warn" | "muted"; children: ReactNode }): ReactNode {
  return <span className={`settings-status ${state}`}>{children}</span>;
}

export function SettingsView(props: SettingsViewProps): ReactNode {
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<"user" | "workspace">("user");
  const [openAIKey, setOpenAIKey] = useState("");
  const [modelDraft, setModelDraft] = useState(props.settings.ai.openaiModel);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [recording, setRecording] = useState<AppCommandId | null>(null);

  useEffect(() => { setModelDraft(props.settings.ai.openaiModel); }, [props.settings.ai.openaiModel]);
  useEffect(() => { void props.onRefreshConnections(); }, []);
  useEffect(() => () => { void window.novelLens.setKeybindingRecording(false); }, []);
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent): void => { if (event.key === "Escape" && recording === null) props.onClose(); };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [props.onClose, recording]);

  const visibleCategories = useMemo(() => CATEGORIES.filter((item) => settingMatches(query, item.search)), [query]);
  const connections = props.connections ?? EMPTY_CONNECTIONS;
  const updateInProgress = props.updateStatus?.state === "downloading" || props.updateStatus?.state === "verifying" || props.updateStatus?.state === "installing";
  const canInstallUpdate = (props.updateStatus?.state === "available" && props.updateStatus.downloadUrl !== null) || props.updateStatus?.state === "ready";

  useEffect(() => {
    if (visibleCategories.length > 0 && !visibleCategories.some((item) => item.id === props.category)) props.setCategory(visibleCategories[0]!.id);
  }, [props.category, props.setCategory, visibleCategories]);

  const run = async (name: string, action: () => Promise<void>): Promise<void> => {
    setBusy(name); setError(null);
    try { await action(); }
    catch (cause) { setError(cause instanceof Error ? cause.message.replace(/^Error invoking remote method '[^']+': Error:\s*/u, "") : String(cause)); }
    finally { setBusy(null); }
  };

  const setEditor = async <K extends EditorKey>(key: K, value: EditorPreferences[K]): Promise<void> => {
    if (scope === "workspace" && props.project !== null) await props.onUpdateProject({ [key]: value });
    else await props.onUpdateUser({ editor: { [key]: value } });
  };

  const editorValue = <K extends EditorKey>(key: K): EditorPreferences[K] => {
    const workspace = projectValue(props.project, key);
    if (scope === "workspace" && workspace !== undefined) return workspace as EditorPreferences[K];
    return props.settings.editor[key];
  };

  const beginRecording = (command: AppCommandId): void => {
    setRecording(command); setError(null); void window.novelLens.setKeybindingRecording(true);
  };

  const finishRecording = (): void => {
    setRecording(null); void window.novelLens.setKeybindingRecording(false);
  };

  const recordKey = (event: ReactKeyboardEvent<HTMLButtonElement>, command: AppCommandId): void => {
    event.preventDefault(); event.stopPropagation();
    if (event.key === "Escape") { finishRecording(); return; }
    if (event.key === "Backspace" || event.key === "Delete") {
      void run("keybinding", async () => { await props.onUpdateUser({ keybindings: { [command]: "" } }); finishRecording(); });
      return;
    }
    const binding = bindingFromKeyboardEvent(event.nativeEvent);
    if (binding === null) { setError("Ctrl / ⌘ またはAltを含むショートカットを入力してください。編集用の標準キーは上書きできません。"); return; }
    const conflict = COMMAND_DEFINITIONS.find((item) => item.id !== command && props.settings.keybindings[item.id] === binding);
    if (conflict !== undefined) { setError(`${formatKeybinding(binding)} は「${conflict.label}」で使用中です。`); return; }
    void run("keybinding", async () => { await props.onUpdateUser({ keybindings: { [command]: binding } }); finishRecording(); });
  };

  const editorPanel = <>
    <div className="settings-scope-tabs" role="tablist" aria-label="設定の適用範囲">
      <button className={scope === "user" ? "active" : ""} onClick={() => setScope("user")}>ユーザー</button>
      <button disabled={props.project === null} className={scope === "workspace" ? "active" : ""} onClick={() => setScope("workspace")}>この作品</button>
    </div>
    <p className="settings-lead">{scope === "user" ? "新しい作品を含むすべての作品の既定値です。" : `「${props.project?.manifest.title ?? "作品"}」だけの上書きです。`}</p>
    <SettingRow title="組方向" description="本文を横書きまたは日本語の縦書きで表示します。" inherited={scope === "workspace" && projectValue(props.project, "writingMode") === undefined} onReset={scope === "workspace" && projectValue(props.project, "writingMode") !== undefined ? () => props.onResetProjectSetting("writingMode") : undefined}>
      <select value={editorValue("writingMode")} onChange={(event) => void setEditor("writingMode", event.target.value as EditorPreferences["writingMode"])}><option value="horizontal">横書き</option><option value="vertical-rl">縦書き</option></select>
    </SettingRow>
    <SettingRow title="カラーテーマ" description="執筆画面の色だけを変え、原稿には記録しません。" inherited={scope === "workspace" && projectValue(props.project, "theme") === undefined} onReset={scope === "workspace" && projectValue(props.project, "theme") !== undefined ? () => props.onResetProjectSetting("theme") : undefined}>
      <select value={editorValue("theme")} onChange={(event) => void setEditor("theme", event.target.value as EditorPreferences["theme"])}><option value="paper">紙</option><option value="sepia">セピア</option><option value="dark">夜</option></select>
    </SettingRow>
    <SettingRow title="本文フォント" description="端末にあるフォントだけを使用します。" inherited={scope === "workspace" && projectValue(props.project, "font") === undefined} onReset={scope === "workspace" && projectValue(props.project, "font") !== undefined ? () => props.onResetProjectSetting("font") : undefined}>
      <select value={editorValue("font")} onChange={(event) => void setEditor("font", event.target.value)}><option value={'"Yu Mincho", "Hiragino Mincho ProN", serif'}>明朝体</option><option value={'"Yu Gothic UI", "Hiragino Sans", sans-serif'}>ゴシック体</option><option value={'ui-monospace, "BIZ UDゴシック", monospace'}>等幅</option></select>
    </SettingRow>
    <SettingRow title="文字サイズ" description={`${editorValue("fontSize")} px`} inherited={scope === "workspace" && projectValue(props.project, "fontSize") === undefined} onReset={scope === "workspace" && projectValue(props.project, "fontSize") !== undefined ? () => props.onResetProjectSetting("fontSize") : undefined}>
      <input aria-label="文字サイズ" type="range" min="12" max="36" value={editorValue("fontSize")} onChange={(event) => void setEditor("fontSize", Number(event.target.value))} />
    </SettingRow>
    <SettingRow title="行間" description={editorValue("lineHeight").toFixed(1)} inherited={scope === "workspace" && projectValue(props.project, "lineHeight") === undefined} onReset={scope === "workspace" && projectValue(props.project, "lineHeight") !== undefined ? () => props.onResetProjectSetting("lineHeight") : undefined}>
      <input aria-label="行間" type="range" min="1.2" max="3" step="0.1" value={editorValue("lineHeight")} onChange={(event) => void setEditor("lineHeight", Number(event.target.value))} />
    </SettingRow>
    <SettingRow title="本文幅" description={`${editorValue("width")} px`} inherited={scope === "workspace" && projectValue(props.project, "width") === undefined} onReset={scope === "workspace" && projectValue(props.project, "width") !== undefined ? () => props.onResetProjectSetting("width") : undefined}>
      <input aria-label="本文幅" type="range" min="480" max="1200" step="20" value={editorValue("width")} onChange={(event) => void setEditor("width", Number(event.target.value))} />
    </SettingRow>
  </>;

  return <div className="settings-view" role="dialog" aria-modal="true" aria-labelledby="settings-title">
    <header className="settings-header">
      <button className="settings-back" onClick={props.onClose} aria-label="設定を閉じる">←</button>
      <div><span className="eyebrow">PREFERENCES</span><h1 id="settings-title">設定</h1></div>
      <input className="settings-search" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="設定を検索" aria-label="設定を検索" />
      <button className="settings-close" onClick={props.onClose} aria-label="設定を閉じる">×</button>
    </header>
    <div className="settings-layout">
      <nav className="settings-nav" aria-label="設定カテゴリ">
        {visibleCategories.map((item) => <button key={item.id} className={props.category === item.id ? "active" : ""} onClick={() => props.setCategory(item.id)}><span>{item.icon}</span>{item.label}</button>)}
        {visibleCategories.length === 0 && <p>一致する設定がありません。</p>}
      </nav>
      <main className="settings-main">
        {error !== null && <div className="settings-error" role="alert">{error}<button onClick={() => setError(null)}>×</button></div>}
        {props.category === "general" && <SettingsSection eyebrow="APPLICATION" title="全般" lead="アプリ全体の動作を設定します。作品本文には保存されません。">
          <SettingRow title="自動保存" description="入力を止めてから保存するまでの時間です。IME変換中は保存しません。"><select value={props.settings.general.autoSaveDelayMs} onChange={(event) => void props.onUpdateUser({ general: { autoSaveDelayMs: Number(event.target.value) } })}><option value="400">0.4秒</option><option value="800">0.8秒</option><option value="1500">1.5秒</option><option value="3000">3秒</option></select></SettingRow>
          <SettingRow title="設定の保存場所" description="ユーザー設定はOSのNovel Lens設定フォルダーに保存します。APIキーとGitHub tokenは含みません。"><StatusBadge state="ok">ローカルのみ</StatusBadge></SettingRow>
        </SettingsSection>}
        {props.category === "editor" && <SettingsSection eyebrow="EDITOR" title="エディター" lead="VS Codeと同じように、ユーザー既定値と作品固有の上書きを分けます。">{editorPanel}</SettingsSection>}
        {props.category === "ai" && <SettingsSection eyebrow="AI CONNECTION" title="AIレンズ（OpenAI API）" lead="ChatGPTアカウントではなく、作者が選んだ範囲を読むためのOpenAI API接続です。">
          <SettingRow title="既定の接続" description="新しく開いたレンズで最初に選ばれる接続です。"><select value={props.settings.ai.defaultProvider} onChange={(event) => void props.onUpdateUser({ ai: { defaultProvider: event.target.value as "mock" | "openai" } })}><option value="mock">Offline Mock（通信なし）</option><option value="openai">OpenAI API</option></select></SettingRow>
          <SettingRow title="OpenAI model ID" description="利用者のAPI projectで利用できる正確なmodel IDを指定します。"><input value={modelDraft} onChange={(event) => setModelDraft(event.target.value)} onBlur={() => { if (modelDraft !== props.settings.ai.openaiModel) void props.onUpdateUser({ ai: { openaiModel: modelDraft } }); }} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} /></SettingRow>
          <div className="connection-card">
            <div className="connection-heading"><div><h3>OpenAI API</h3><p>{connections.openai.message}</p></div><StatusBadge state={connections.openai.connected ? "ok" : connections.openai.state === "error" ? "warn" : "muted"}>{connections.openai.connected ? connections.openai.storage === "os" ? "OSへ保存済み" : "接続済み" : "未接続"}</StatusBadge></div>
            {!connections.openai.connected ? <div className="connection-form"><input type="password" autoComplete="off" spellCheck={false} value={openAIKey} onChange={(event) => setOpenAIKey(event.target.value)} placeholder="OpenAI API key" aria-label="OpenAI API key" /><button className="primary" disabled={busy !== null || openAIKey.trim().length < 20} onClick={() => void run("openai", async () => { await props.onConnectOpenAI(openAIKey); setOpenAIKey(""); })}>APIキーを接続して確認</button></div> : <button className="secondary" disabled={busy !== null} onClick={() => void run("openai", props.onDisconnectOpenAI)}>接続と保存済みキーを削除</button>}
            <div className="connection-links"><button onClick={() => void props.onOpenExternal("openai-api-keys")}>APIキーを作成・管理</button></div>
            <p className="settings-note">ChatGPT Plus / Proのログイン枠は利用しません。API Platformの請求と権限が適用されます。確認後のキーはrendererから消去し、利用可能な端末ではOSの暗号化ストレージへ保存します。作品やsettings.jsonには保存しません。</p>
          </div>
        </SettingsSection>}
        {props.category === "accounts" && <SettingsSection eyebrow="ACCOUNTS" title="アカウント" lead="認証情報はNovel Lensのサーバーを経由しません。">
          <div className="connection-card">
            <div className="connection-heading"><div><h3>ChatGPT</h3><p>ブラウザのChatGPTログイン画面を開きます。Novel Lensとは接続されません。</p></div><StatusBadge state="muted">ブラウザ</StatusBadge></div>
            <button className="secondary" onClick={() => void props.onOpenExternal("chatgpt")}>ChatGPTを開く</button>
            <p className="settings-note">ブラウザのログイン状態やsubscriptionをNovel Lensが読み取ることはありません。AIレンズは上のOpenAI API接続を使用します。</p>
          </div>
          <div className="connection-card">
            <div className="connection-heading"><div><h3>GitHub</h3><p>{connections.github.message}</p></div><StatusBadge state={connections.github.connected ? "ok" : connections.github.state === "error" ? "warn" : "muted"}>{connections.github.connected ? "接続済み" : connections.github.cliInstalled ? "未ログイン" : "CLIなし"}</StatusBadge></div>
            {!connections.github.connected && connections.github.cliInstalled && <button className="primary" disabled={busy !== null} onClick={() => void run("github", props.onLoginGitHub)}>{busy === "github" ? "ブラウザで確認中…" : "GitHubへログイン"}</button>}
            {!connections.github.cliInstalled && <button className="secondary" onClick={() => void props.onOpenExternal("github-cli")}>GitHub CLIをinstall</button>}
            <div className="connection-links"><button onClick={() => void props.onRefreshConnections()}>状態を再確認</button><button onClick={() => void props.onOpenExternal("github-applications")}>GitHub側で認証を管理</button></div>
            <p className="settings-note">公式GitHub CLIのbrowser flowを使用します。tokenはOS credential storeまたはGitHub CLIが管理し、Novel Lensはtoken値を読みません。</p>
          </div>
        </SettingsSection>}
        {props.category === "keyboard" && <SettingsSection eyebrow="KEYBOARD" title="キーボード ショートカット" lead="キー割り当てをクリックし、使いたい組み合わせを押します。Backspaceで未設定にできます。">
          <div className="keybinding-list">{COMMAND_DEFINITIONS.map((command) => <div className="keybinding-row" key={command.id}><div><small>{command.category}</small><b>{command.label}</b><code>{command.id}</code></div><button autoFocus={recording === command.id} className={recording === command.id ? "recording" : ""} onClick={() => beginRecording(command.id)} onKeyDown={(event) => { if (recording === command.id) recordKey(event, command.id); }}>{recording === command.id ? "キーを入力…" : formatKeybinding(props.settings.keybindings[command.id])}</button><button className="reset-key" title="既定値へ戻す" onClick={() => void run("keybinding", async () => { await props.onUpdateUser({ keybindings: { [command.id]: command.defaultBinding } }); finishRecording(); })}>↺</button></div>)}</div>
          <button className="secondary" disabled={busy !== null} onClick={() => { if (window.confirm("すべてのショートカットを既定値へ戻しますか？")) void run("reset-keys", async () => { await props.onResetKeybindings(); finishRecording(); }); }}>すべて既定値へ戻す</button>
        </SettingsSection>}
        {props.category === "updates" && <SettingsSection eyebrow="UPDATES" title="更新" lead="GitHub Releasesを直接確認します。運営者サーバーやGitHub tokenは不要です。">
          <SettingRow title="起動時に確認" description="packaged版の起動後にGitHubへ1回だけ最新版を問い合わせます。原稿や設定は送りません。"><label className="toggle"><input type="checkbox" checked={props.settings.updates.checkOnStartup} onChange={(event) => void props.onUpdateUser({ updates: { checkOnStartup: event.target.checked } })} />{props.settings.updates.checkOnStartup ? "オン" : "オフ"}</label></SettingRow>
          <div className="update-card"><div><small>現在</small><strong>v{props.updateStatus?.currentVersion ?? props.appInfo?.version ?? "-"}</strong></div><span>→</span><div><small>最新版</small><strong>{props.updateStatus?.latestVersion === null || props.updateStatus === null ? "未確認" : `v${props.updateStatus.latestVersion}`}</strong></div></div>
          <p className="settings-note">{props.updateStatus?.message ?? "更新はまだ確認していません。"}</p>
          {props.updateStatus?.progress !== null && props.updateStatus?.progress !== undefined && <div className="update-progress" aria-label={`更新 ${props.updateStatus.progress}%`}><span style={{ width: `${props.updateStatus.progress}%` }} /></div>}
          <div className="settings-actions"><button className="primary" disabled={busy !== null || props.updateStatus?.state === "checking" || updateInProgress} onClick={() => void run("updates", props.onCheckUpdates)}>{props.updateStatus?.state === "checking" ? "確認中…" : "今すぐ確認"}</button><button className="secondary" disabled={busy !== null || updateInProgress || !canInstallUpdate} onClick={() => void run("install", props.onInstallUpdate)}>{props.updateStatus?.state === "downloading" ? `ダウンロード中 ${props.updateStatus.progress ?? 0}%` : props.updateStatus?.state === "verifying" ? "SHA-256を確認中…" : props.updateStatus?.state === "installing" ? "installerを起動中…" : "ダウンロードして更新"}</button><button className="text-button" disabled={updateInProgress} onClick={() => void props.onOpenUpdatePage()}>Releaseページ</button></div>
          <p className="settings-note">作品フォルダーはアプリの外にあるため、更新・再install・uninstallで原稿を削除しません。ダウンロードはGitHub ReleaseのSHA-256と照合します。preview版は未署名のため、起動後のOS警告を確認してください。</p>
        </SettingsSection>}
        {props.category === "about" && <SettingsSection eyebrow="ABOUT" title="Novel Lens" lead="作者が書くことを中心に置く、ローカル優先のOSS小説制作環境です。">
          <div className="about-grid"><span>Version</span><code>{props.appInfo?.version ?? "-"}</code><span>Platform</span><code>{props.appInfo?.platform ?? "desktop"}</code><span>License</span><code>Apache-2.0</code><span>データ</span><code>Markdown / local-first</code></div>
          <button className="secondary" onClick={() => void props.onOpenExternal("latest-release")}>GitHub Releases</button>
        </SettingsSection>}
      </main>
    </div>
  </div>;
}

function SettingsSection({ eyebrow, title, lead, children }: { eyebrow: string; title: string; lead: string; children: ReactNode }): ReactNode {
  return <section className="settings-section"><span className="eyebrow">{eyebrow}</span><h2>{title}</h2><p className="settings-lead">{lead}</p><div className="settings-rows">{children}</div></section>;
}

function SettingRow({ title, description, children, inherited = false, onReset }: { title: string; description: string; children: ReactNode; inherited?: boolean; onReset?: (() => Promise<void>) | undefined }): ReactNode {
  return <div className="setting-row"><div><div className="setting-title"><h3>{title}</h3>{inherited && <span>ユーザー設定を使用中</span>}</div><p>{description}</p>{onReset !== undefined && <button className="setting-reset" onClick={() => void onReset()}>ユーザー設定に戻す</button>}</div><div className="setting-control">{children}</div></div>;
}
