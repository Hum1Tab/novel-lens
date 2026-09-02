import { describe, expect, it } from "vitest";

import { checksumForAsset, chooseInstaller, compareVersions, installerLaunchArguments } from "./updates.js";

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

  it("matches packaged Linux names and the exact SHA-256 entry", () => {
    const linux = [{ name: "Novel-Lens-0.2.0-linux-x86_64.AppImage", browser_download_url: "https://github.com/Hum1Tab/novel-lens/releases/download/v0.2.0/Novel-Lens-0.2.0-linux-x86_64.AppImage" }];
    expect(chooseInstaller(linux, "linux", "x64")).toContain("x86_64.AppImage");
    const digest = "a".repeat(64);
    expect(checksumForAsset(`${digest}  Novel-Lens-0.2.0-linux-x86_64.AppImage\n`, linux[0]!.name)).toBe(digest);
    expect(checksumForAsset(`${digest}  another.exe\n`, linux[0]!.name)).toBeNull();
  });

  it("uses the NSIS silent update and restart flags only on Windows", () => {
    expect(installerLaunchArguments("win32")).toEqual(["/S", "--updated", "--force-run"]);
    expect(installerLaunchArguments("darwin")).toEqual([]);
  });
});
