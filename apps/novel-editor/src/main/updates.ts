import type { UpdateStatus } from "../shared/types.js";

const LATEST_RELEASE_API = "https://api.github.com/repos/Hum1Tab/novel-lens/releases/latest";
export const LATEST_RELEASE_PAGE = "https://github.com/Hum1Tab/novel-lens/releases/latest";

interface ReleaseAsset { name: string; browser_download_url: string }
interface LatestRelease { tag_name: string; html_url: string; assets: ReleaseAsset[] }

function versionTuple(value: string): [number, number, number] | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/u.exec(value);
  return match === null ? null : [Number(match[1]), Number(match[2]), Number(match[3])];
}

export function compareVersions(left: string, right: string): number {
  const a = versionTuple(left);
  const b = versionTuple(right);
  if (a === null || b === null) throw new Error("Release versionの形式を確認できません。");
  for (let index = 0; index < 3; index += 1) {
    const difference = a[index]! - b[index]!;
    if (difference !== 0) return Math.sign(difference);
  }
  return 0;
}

function isAllowedReleaseUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "github.com" && url.pathname.startsWith("/Hum1Tab/novel-lens/releases/");
  } catch { return false; }
}

export function chooseInstaller(assets: readonly ReleaseAsset[], platform: NodeJS.Platform, architecture: string): string | null {
  const arch = architecture === "arm64" ? "arm64" : architecture === "x64" ? "x64" : null;
  if (arch === null) return null;
  const patterns = platform === "win32"
    ? [new RegExp(`windows-${arch}-setup\\.exe$`, "iu")]
    : platform === "darwin"
      ? [new RegExp(`mac-${arch}\\.dmg$`, "iu"), /mac-universal\.dmg$/iu]
      : platform === "linux"
        ? [new RegExp(`linux-${arch}\\.AppImage$`, "u"), new RegExp(`linux-${arch}\\.deb$`, "u")]
        : [];
  for (const pattern of patterns) {
    const match = assets.find((asset) => pattern.test(asset.name) && isAllowedReleaseUrl(asset.browser_download_url));
    if (match !== undefined) return match.browser_download_url;
  }
  return null;
}

function parseLatestRelease(value: unknown): LatestRelease {
  if (typeof value !== "object" || value === null) throw new Error("GitHub Releaseの応答を確認できません。");
  const source = value as Record<string, unknown>;
  if (typeof source["tag_name"] !== "string" || versionTuple(source["tag_name"]) === null) throw new Error("最新版のversionを確認できません。");
  if (typeof source["html_url"] !== "string" || !isAllowedReleaseUrl(source["html_url"])) throw new Error("最新版のURLを確認できません。");
  const assets = Array.isArray(source["assets"]) ? source["assets"].flatMap((entry): ReleaseAsset[] => {
    if (typeof entry !== "object" || entry === null) return [];
    const asset = entry as Record<string, unknown>;
    return typeof asset["name"] === "string" && typeof asset["browser_download_url"] === "string"
      ? [{ name: asset["name"], browser_download_url: asset["browser_download_url"] }]
      : [];
  }) : [];
  return { tag_name: source["tag_name"], html_url: source["html_url"], assets };
}

export class UpdateManager {
  private status: UpdateStatus;

  constructor(
    private readonly currentVersion: string,
    private readonly platform: NodeJS.Platform,
    private readonly architecture: string,
    private readonly onStatus: (status: UpdateStatus) => void
  ) {
    this.status = { state: "idle", currentVersion, latestVersion: null, checkedAt: null, downloadUrl: null, releaseUrl: LATEST_RELEASE_PAGE, message: "更新はまだ確認していません。" };
  }

  snapshot(): UpdateStatus { return { ...this.status }; }

  async check(): Promise<UpdateStatus> {
    this.set({ ...this.status, state: "checking", message: "GitHub Releasesで最新版を確認しています…" });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20_000);
    try {
      const response = await fetch(LATEST_RELEASE_API, {
        headers: { Accept: "application/vnd.github+json", "User-Agent": `Novel-Lens/${this.currentVersion}`, "X-GitHub-Api-Version": "2022-11-28" },
        redirect: "error",
        signal: controller.signal
      });
      if (!response.ok) throw new Error(`GitHub Releasesを確認できませんでした（HTTP ${response.status}）。`);
      const release = parseLatestRelease(await response.json());
      const latestVersion = release.tag_name.replace(/^v/u, "");
      const checkedAt = new Date().toISOString();
      if (compareVersions(latestVersion, this.currentVersion) <= 0) {
        this.set({ state: "current", currentVersion: this.currentVersion, latestVersion, checkedAt, downloadUrl: null, releaseUrl: release.html_url, message: "最新版を使用しています。" });
      } else {
        const downloadUrl = chooseInstaller(release.assets, this.platform, this.architecture);
        this.set({ state: "available", currentVersion: this.currentVersion, latestVersion, checkedAt, downloadUrl, releaseUrl: release.html_url, message: downloadUrl === null ? "新しいversionがあります。Releaseページから取得できます。" : "新しいversionがあります。利用中のOS向けinstallerを取得できます。" });
      }
      return this.snapshot();
    } catch (error) {
      const message = controller.signal.aborted ? "更新確認が時間切れになりました。" : error instanceof Error ? error.message : "更新を確認できませんでした。";
      this.set({ ...this.status, state: "error", checkedAt: new Date().toISOString(), message });
      return this.snapshot();
    } finally { clearTimeout(timer); }
  }

  private set(status: UpdateStatus): void {
    this.status = status;
    this.onStatus(this.snapshot());
  }
}
