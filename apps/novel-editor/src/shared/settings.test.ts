import { describe, expect, it } from "vitest";

import { bindingFromKeyboardEvent, defaultUserSettings, mergeUserSettings, normalizeKeybinding, validateKeybindings } from "./settings.js";

describe("desktop user settings", () => {
  it("keeps editable keybindings portable, unique, and away from editor-reserved keys", () => {
    const settings = defaultUserSettings();
    expect(normalizeKeybinding("Ctrl+Shift+l")).toBe("Mod+Shift+L");
    expect(normalizeKeybinding("Ctrl+C")).toBeNull();
    expect(bindingFromKeyboardEvent({ key: "u", ctrlKey: true, metaKey: false, altKey: false, shiftKey: true })).toBe("Mod+Shift+U");
    expect(() => validateKeybindings({ ...settings.keybindings, "file.new": "Mod+O" })).toThrow(/重複/u);
    expect(mergeUserSettings(settings, { general: { autoSaveDelayMs: 1500 }, keybindings: { "file.export": "Mod+Shift+E" } })).toMatchObject({ general: { autoSaveDelayMs: 1500 }, keybindings: { "file.export": "Mod+Shift+E" } });
  });
});
