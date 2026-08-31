export type AppCommandId =
  | "file.new"
  | "file.open"
  | "file.save"
  | "history.checkpoint"
  | "file.export"
  | "view.settings"
  | "view.settings.editor"
  | "view.settings.ai"
  | "view.settings.accounts"
  | "view.settings.keyboard"
  | "view.settings.updates"
  | "view.search"
  | "view.lens"
  | "view.history"
  | "updates.check";

export interface CommandDefinition {
  id: AppCommandId;
  label: string;
  category: "ファイル" | "表示" | "履歴" | "設定" | "更新";
  defaultBinding: string;
}

export const COMMAND_DEFINITIONS: readonly CommandDefinition[] = [
  { id: "file.new", label: "新しい作品", category: "ファイル", defaultBinding: "Mod+N" },
  { id: "file.open", label: "作品を開く", category: "ファイル", defaultBinding: "Mod+O" },
  { id: "file.save", label: "保存", category: "ファイル", defaultBinding: "Mod+S" },
  { id: "history.checkpoint", label: "保存点を作る", category: "履歴", defaultBinding: "Mod+Shift+S" },
  { id: "file.export", label: "Markdownを書き出す", category: "ファイル", defaultBinding: "Mod+Alt+E" },
  { id: "view.settings", label: "設定を開く", category: "表示", defaultBinding: "Mod+," },
  { id: "view.settings.editor", label: "エディター設定を開く", category: "設定", defaultBinding: "" },
  { id: "view.settings.ai", label: "AI接続設定を開く", category: "設定", defaultBinding: "" },
  { id: "view.settings.accounts", label: "アカウント設定を開く", category: "設定", defaultBinding: "" },
  { id: "view.settings.keyboard", label: "キーボード ショートカットを開く", category: "設定", defaultBinding: "" },
  { id: "view.settings.updates", label: "更新設定を開く", category: "設定", defaultBinding: "" },
  { id: "view.search", label: "作品内検索", category: "表示", defaultBinding: "Mod+F" },
  { id: "view.lens", label: "編集レンズ", category: "表示", defaultBinding: "Mod+Shift+L" },
  { id: "view.history", label: "履歴", category: "表示", defaultBinding: "Mod+Shift+H" },
  { id: "updates.check", label: "更新を確認", category: "更新", defaultBinding: "Mod+Shift+U" }
] as const;

export type KeybindingMap = Record<AppCommandId, string>;

export interface EditorPreferences {
  writingMode: "horizontal" | "vertical-rl";
  theme: "paper" | "sepia" | "dark";
  font: string;
  fontSize: number;
  lineHeight: number;
  width: number;
}

export interface UserSettings {
  schemaVersion: 1;
  general: { autoSaveDelayMs: number };
  editor: EditorPreferences;
  ai: { defaultProvider: "mock" | "openai"; openaiModel: string };
  updates: { checkOnStartup: boolean };
  keybindings: KeybindingMap;
}

export type UserSettingsPatch = {
  general?: Partial<UserSettings["general"]>;
  editor?: Partial<UserSettings["editor"]>;
  ai?: Partial<UserSettings["ai"]>;
  updates?: Partial<UserSettings["updates"]>;
  keybindings?: Partial<KeybindingMap>;
};

const DEFAULT_FONT = '"Yu Mincho", "Hiragino Mincho ProN", serif';
const RESERVED_BINDINGS = new Set(["Mod+C", "Mod+X", "Mod+V", "Mod+A", "Mod+Z", "Mod+Shift+Z", "Mod+Q"]);

export function defaultKeybindings(): KeybindingMap {
  return Object.fromEntries(COMMAND_DEFINITIONS.map((command) => [command.id, command.defaultBinding])) as KeybindingMap;
}

export function defaultUserSettings(): UserSettings {
  return {
    schemaVersion: 1,
    general: { autoSaveDelayMs: 800 },
    editor: { writingMode: "horizontal", theme: "paper", font: DEFAULT_FONT, fontSize: 18, lineHeight: 2, width: 760 },
    ai: { defaultProvider: "mock", openaiModel: "gpt-5-mini" },
    updates: { checkOnStartup: true },
    keybindings: defaultKeybindings()
  };
}

function finiteNumber(value: unknown, fallback: number, minimum: number, maximum: number): number {
  return typeof value === "number" && Number.isFinite(value) && value >= minimum && value <= maximum ? value : fallback;
}

function objectValue(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function normalizeKeybinding(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) return "";
  const rawParts = trimmed.split("+").map((part) => part.trim()).filter(Boolean);
  if (rawParts.length === 0) return null;
  const rawKey = rawParts.at(-1)!;
  const modifierSet = new Set<string>();
  for (const raw of rawParts.slice(0, -1)) {
    const lower = raw.toLowerCase();
    if (["mod", "cmd", "command", "meta", "ctrl", "control", "cmdorctrl", "commandorcontrol"].includes(lower)) modifierSet.add("Mod");
    else if (lower === "alt" || lower === "option") modifierSet.add("Alt");
    else if (lower === "shift") modifierSet.add("Shift");
    else return null;
  }
  const aliases: Record<string, string> = { comma: ",", period: ".", slash: "/", space: "Space", escape: "Escape", enter: "Enter", backspace: "Backspace", delete: "Delete", minus: "-", equal: "=" };
  const keyLower = rawKey.toLowerCase();
  let key = aliases[keyLower] ?? rawKey;
  if (/^[a-z]$/iu.test(key)) key = key.toUpperCase();
  else if (/^f(?:[1-9]|1[0-2])$/iu.test(key)) key = key.toUpperCase();
  else if (!/^[0-9,./;'\[\]\\`=-]$/u.test(key) && !["Space", "Escape", "Enter", "Backspace", "Delete"].includes(key)) return null;
  if (!modifierSet.has("Mod") && !modifierSet.has("Alt") && !/^F(?:[1-9]|1[0-2])$/u.test(key)) return null;
  const result = [...["Mod", "Alt", "Shift"].filter((part) => modifierSet.has(part)), key].join("+");
  return RESERVED_BINDINGS.has(result) ? null : result;
}

export function validateKeybindings(bindings: KeybindingMap): void {
  const used = new Map<string, AppCommandId>();
  for (const definition of COMMAND_DEFINITIONS) {
    const normalized = normalizeKeybinding(bindings[definition.id]);
    if (normalized === null) throw new Error(`「${definition.label}」のショートカットを確認してください。`);
    if (normalized.length === 0) continue;
    const existing = used.get(normalized);
    if (existing !== undefined) {
      const other = COMMAND_DEFINITIONS.find((item) => item.id === existing)?.label ?? existing;
      throw new Error(`ショートカット ${formatKeybinding(normalized)} は「${other}」と重複しています。`);
    }
    used.set(normalized, definition.id);
  }
}

export function sanitizeUserSettings(input: unknown): UserSettings {
  const defaults = defaultUserSettings();
  const source = objectValue(input);
  const general = objectValue(source["general"]);
  const editor = objectValue(source["editor"]);
  const ai = objectValue(source["ai"]);
  const updates = objectValue(source["updates"]);
  const rawBindings = objectValue(source["keybindings"]);
  const keybindings = defaultKeybindings();
  for (const definition of COMMAND_DEFINITIONS) {
    const candidate = rawBindings[definition.id];
    if (typeof candidate !== "string") continue;
    const normalized = normalizeKeybinding(candidate);
    if (normalized !== null) keybindings[definition.id] = normalized;
  }
  try { validateKeybindings(keybindings); }
  catch { return defaults; }
  return {
    schemaVersion: 1,
    general: { autoSaveDelayMs: finiteNumber(general["autoSaveDelayMs"], defaults.general.autoSaveDelayMs, 250, 5000) },
    editor: {
      writingMode: editor["writingMode"] === "vertical-rl" ? "vertical-rl" : editor["writingMode"] === "horizontal" ? "horizontal" : defaults.editor.writingMode,
      theme: editor["theme"] === "dark" || editor["theme"] === "sepia" || editor["theme"] === "paper" ? editor["theme"] : defaults.editor.theme,
      font: typeof editor["font"] === "string" && editor["font"].length <= 200 ? editor["font"] : defaults.editor.font,
      fontSize: finiteNumber(editor["fontSize"], defaults.editor.fontSize, 12, 36),
      lineHeight: finiteNumber(editor["lineHeight"], defaults.editor.lineHeight, 1.2, 3),
      width: finiteNumber(editor["width"], defaults.editor.width, 480, 1600)
    },
    ai: {
      defaultProvider: ai["defaultProvider"] === "openai" ? "openai" : "mock",
      openaiModel: typeof ai["openaiModel"] === "string" && /^[A-Za-z0-9._:-]{1,128}$/u.test(ai["openaiModel"]) ? ai["openaiModel"] : defaults.ai.openaiModel
    },
    updates: { checkOnStartup: typeof updates["checkOnStartup"] === "boolean" ? updates["checkOnStartup"] : defaults.updates.checkOnStartup },
    keybindings
  };
}

export function mergeUserSettings(current: UserSettings, patch: UserSettingsPatch): UserSettings {
  const candidate = sanitizeUserSettings({
    schemaVersion: 1,
    general: { ...current.general, ...patch.general },
    editor: { ...current.editor, ...patch.editor },
    ai: { ...current.ai, ...patch.ai },
    updates: { ...current.updates, ...patch.updates },
    keybindings: { ...current.keybindings, ...patch.keybindings }
  });
  validateKeybindings(candidate.keybindings);
  return candidate;
}

export function toElectronAccelerator(binding: string): string | undefined {
  const normalized = normalizeKeybinding(binding);
  if (normalized === null || normalized.length === 0) return undefined;
  return normalized.split("+").map((part) => part === "Mod" ? "CommandOrControl" : part).join("+");
}

export function formatKeybinding(binding: string): string {
  if (binding.length === 0) return "未設定";
  return binding.replace("Mod", "Ctrl / ⌘").replaceAll("+", " + ");
}

export function bindingFromKeyboardEvent(event: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey">): string | null {
  if (["Control", "Meta", "Alt", "Shift"].includes(event.key)) return null;
  const parts: string[] = [];
  if (event.metaKey || event.ctrlKey) parts.push("Mod");
  if (event.altKey) parts.push("Alt");
  if (event.shiftKey) parts.push("Shift");
  const aliases: Record<string, string> = { " ": "Space", ",": ",", ".": ".", "/": "/" };
  const key = aliases[event.key] ?? (/^[a-z]$/iu.test(event.key) ? event.key.toUpperCase() : event.key);
  return normalizeKeybinding([...parts, key].join("+"));
}
