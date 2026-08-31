import { spawn } from "node:child_process";

import type { ConnectionStatus, GitHubConnectionStatus, OpenAIConnectionStatus } from "../shared/types.js";

interface ProcessResult { exitCode: number; timedOut: boolean }

function runCommand(executable: "gh", args: readonly string[], timeoutMs: number, onOutput?: (text: string) => void): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, [...args], {
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, GH_PAGER: "cat", NO_COLOR: "1" }
    });
    child.stdout.on("data", (chunk: Buffer) => onOutput?.(chunk.toString("utf8")));
    child.stderr.on("data", (chunk: Buffer) => onOutput?.(chunk.toString("utf8")));
    let settled = false;
    const finish = (value: ProcessResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => {
      child.kill();
      finish({ exitCode: -1, timedOut: true });
    }, timeoutMs);
    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.once("close", (code) => finish({ exitCode: code ?? -1, timedOut: false }));
  });
}

export class ConnectionManager {
  private openAIKey: string | null = null;
  private openAIStatus: OpenAIConnectionStatus = {
    connected: false,
    state: "disconnected",
    message: "OpenAI APIは未接続です。",
    verifiedAt: null
  };
  private githubStatus: GitHubConnectionStatus = {
    cliInstalled: false,
    connected: false,
    state: "unavailable",
    message: "GitHub CLIの状態をまだ確認していません。"
  };
  private githubLoginInFlight: Promise<ConnectionStatus> | null = null;

  constructor(private readonly onStatus: (status: ConnectionStatus) => void = () => undefined) {}

  statusSnapshot(): ConnectionStatus {
    return { openai: { ...this.openAIStatus }, github: { ...this.githubStatus } };
  }

  async refreshStatus(): Promise<ConnectionStatus> {
    this.githubStatus = await this.probeGitHub();
    return this.emit();
  }

  async connectOpenAI(apiKey: string): Promise<ConnectionStatus> {
    const candidate = apiKey.trim();
    if (!/^\S{20,512}$/u.test(candidate)) throw new Error("OpenAI APIキーの形式を確認してください。");
    this.openAIStatus = { connected: false, state: "checking", message: "OpenAI APIへの接続を確認しています…", verifiedAt: null };
    this.emit();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20_000);
    try {
      const response = await fetch("https://api.openai.com/v1/models", {
        method: "GET",
        headers: { Authorization: `Bearer ${candidate}` },
        redirect: "error",
        signal: controller.signal
      });
      await response.body?.cancel();
      if (response.status === 401 || response.status === 403) throw new Error("OpenAI APIキーまたはproject権限を確認してください。");
      if (!response.ok) throw new Error(`OpenAI APIへ接続できませんでした（HTTP ${response.status}）。`);
      this.openAIKey = candidate;
      const verifiedAt = new Date().toISOString();
      this.openAIStatus = { connected: true, state: "connected", message: "OpenAI APIへ接続済みです。この起動中だけ保持します。", verifiedAt };
      return this.emit();
    } catch (error) {
      this.openAIKey = null;
      const message = controller.signal.aborted ? "OpenAI APIへの接続確認が時間切れになりました。" : error instanceof Error ? error.message : "OpenAI APIへ接続できませんでした。";
      this.openAIStatus = { connected: false, state: "error", message, verifiedAt: null };
      this.emit();
      throw new Error(message);
    } finally {
      clearTimeout(timer);
    }
  }

  disconnectOpenAI(): ConnectionStatus {
    this.openAIKey = null;
    this.openAIStatus = { connected: false, state: "disconnected", message: "OpenAI API接続を解除しました。", verifiedAt: null };
    return this.emit();
  }

  requireOpenAIKey(): string {
    if (this.openAIKey === null) throw new Error("設定からOpenAI APIを接続してください。");
    return this.openAIKey;
  }

  loginGitHub(): Promise<ConnectionStatus> {
    if (this.githubLoginInFlight !== null) return this.githubLoginInFlight;
    this.githubStatus = { cliInstalled: true, connected: false, state: "connecting", message: "ブラウザでGitHubへのログインを完了してください。device codeはclipboardへコピーされます。" };
    this.emit();
    this.githubLoginInFlight = this.performGitHubLogin().finally(() => { this.githubLoginInFlight = null; });
    return this.githubLoginInFlight;
  }

  clear(): void {
    this.openAIKey = null;
  }

  private async performGitHubLogin(): Promise<ConnectionStatus> {
    try {
      let rollingOutput = "";
      let shownCode: string | null = null;
      const result = await runCommand("gh", ["auth", "login", "--web", "--clipboard", "--hostname", "github.com", "--git-protocol", "https", "--skip-ssh-key"], 10 * 60_000, (chunk) => {
        rollingOutput = `${rollingOutput}${chunk}`.slice(-500);
        const code = /\b[A-Z0-9]{4}-[A-Z0-9]{4}\b/u.exec(rollingOutput)?.[0] ?? null;
        if (code !== null && code !== shownCode) {
          shownCode = code;
          this.githubStatus = { cliInstalled: true, connected: false, state: "connecting", message: `GitHubのdevice code: ${code}（clipboardにもコピー済み）` };
          this.emit();
        }
      });
      if (result.timedOut) throw new Error("GitHubログインが時間切れになりました。もう一度お試しください。");
      if (result.exitCode !== 0) throw new Error("GitHubログインを完了できませんでした。");
      this.githubStatus = await this.probeGitHub();
      return this.emit();
    } catch (error) {
      const unavailable = error instanceof Error && "code" in error && error.code === "ENOENT";
      const message = unavailable ? "GitHub CLIが見つかりません。先に公式GitHub CLIをinstallしてください。" : error instanceof Error ? error.message : "GitHubログインを完了できませんでした。";
      this.githubStatus = { cliInstalled: !unavailable, connected: false, state: unavailable ? "unavailable" : "error", message };
      this.emit();
      throw new Error(message);
    }
  }

  private async probeGitHub(): Promise<GitHubConnectionStatus> {
    try {
      const version = await runCommand("gh", ["--version"], 10_000);
      if (version.exitCode !== 0) return { cliInstalled: false, connected: false, state: "unavailable", message: "GitHub CLIを起動できません。" };
      const auth = await runCommand("gh", ["auth", "status", "--active", "--hostname", "github.com"], 20_000);
      if (auth.exitCode === 0) return { cliInstalled: true, connected: true, state: "connected", message: "利用者のGitHub CLI認証へ接続済みです。Novel Lensはtokenを読みません。" };
      return { cliInstalled: true, connected: false, state: "disconnected", message: "GitHub CLIはinstall済みですが、github.comへ未ログインです。" };
    } catch (error) {
      const unavailable = error instanceof Error && "code" in error && error.code === "ENOENT";
      return { cliInstalled: !unavailable, connected: false, state: unavailable ? "unavailable" : "error", message: unavailable ? "GitHub CLIが見つかりません。" : "GitHub CLIの認証状態を確認できません。" };
    }
  }

  private emit(): ConnectionStatus {
    const snapshot = this.statusSnapshot();
    this.onStatus(snapshot);
    return snapshot;
  }
}
