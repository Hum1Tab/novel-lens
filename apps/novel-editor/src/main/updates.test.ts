import { describe, expect, it } from "vitest";

import { chooseInstaller, compareVersions } from "./updates.js";

describe("desktop update selection", () => {
  it("detects a newer semantic version and selects only this repository's OS installer", () => {
    expect(compareVersions("0.2.0", "0.1.1")).toBeGreaterThan(0);
    const assets = [
      { name: "Novel-Lens-0.2.0-windows-x64-setup.exe", browser_download_url: "https://github.com/Hum1Tab/novel-lens/releases/download/v0.2.0/Novel-Lens-0.2.0-windows-x64-setup.exe" },
      { name: "Novel-Lens-0.2.0-windows-x64-setup.exe", browser_download_url: "https://evil.example/installer.exe" }
    ];
    expect(chooseInstaller(assets, "win32", "x64")).toContain("github.com/Hum1Tab/novel-lens/releases/download/");
    expect(chooseInstaller(assets.slice(1), "win32", "x64")).toBeNull();
  });
});
