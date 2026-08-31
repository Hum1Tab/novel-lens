# Novel Lens

Novel Lensは、作者が所有するMarkdown原稿を正本にし、復元可能な保存点と根拠付きAIレンズを備えた、ローカル優先のOSS小説制作環境です。本文の自動生成や無断書換えを主導線にせず、作者が書き、読み返し、判断する仕事を支えます。

## デスクトップ版でできること

- 章・場面の作成、改名、並べ替え、削除
- UTF-8 TXT / Markdownの複数ファイル取り込み
- 800msの自動保存と、終了直前の保存待ち
- 横書き／直接縦書き、明朝・ゴシック・等幅、文字サイズ・行間・本文幅、3テーマ
- 全章横断検索と該当箇所への移動
- 名前を付けた保存点、安全な復元、別案フォルダーの作成
- 結合Markdown書き出し
- 初見読者、編集者、批評家、整合性確認、設定確認の5つの会話レンズ
- current / currentまで / 全章から、AIへ送る範囲を毎回preview
- Offline Mockと、利用者自身のAPIキーを使うOpenAI Responses API
- AI引用のlocal完全一致検証。一意な根拠だけ原文へジャンプ
- VS Code型の独立設定画面。ユーザー既定値と作品固有設定を分離
- 競合を検出し、その場で変更できるキーボードショートカット
- OpenAI APIのsession接続と、公式GitHub CLI browser flowによるGitHubログイン
- GitHub Releasesを使うアプリ内更新確認とOS別installerへの案内

APIキー、会話、AI raw responseはprojectへ保存しません。OpenAI利用時も`store:false`、toolなし、外部検索なし、自動retryなしで実行します。未選択章、ファイルpath、表示設定、履歴は送信しません。

ChatGPT Plus / ProとOpenAI APIは別契約です。本アプリはChatGPT web sessionを流用せず、利用者自身のAPI keyを接続確認後にmain processのメモリだけへ保持します。GitHubは`gh auth login --web`を利用し、Novel Lens自身はtokenを読みません。

## インストール

[GitHub Releases](https://github.com/Hum1Tab/novel-lens/releases/latest)からOSに合うファイルを取得します。

- Windows x64: setup `.exe` またはportable `.exe`
- macOS: Intel / Apple Silicon用 `.dmg` または `.zip`
- Linux x64: `.AppImage` または `.deb`

公開前のsource build手順と、署名されていないpreview buildの注意は[インストール案内](./docs/INSTALL.md)を参照してください。

起動後は「設定 → 更新」から最新版を確認し、現在のOSとCPUに合うinstallerを直接開けます。作品は利用者が選んだフォルダーにあるため、更新や再installでは削除されません。

### 最初の作品を開く

1. 初めて使う場合は「新しい作品を作る」を押し、作品名と保存場所を指定します。
2. 以前の作品を開く場合は「作品フォルダーを開く」を押し、そのフォルダー内の`novel-lens.json`を選択します。

本文は作品フォルダーの`manuscript/*.md`に保存されます。

## 開発・起動

必要環境はNode.js 24.17系とpnpm 11.19系です。

```powershell
pnpm install --frozen-lockfile
pnpm build
pnpm start
```

Windows installerをlocalで作る場合:

```powershell
pnpm desktop:dist -- --win --x64
```

型検査、必要な回帰試験、production build:

```powershell
pnpm check
```

## データ形式

作品フォルダーはアプリなしでも読めます。

```text
my-novel/
├─ novel-lens.json         # 作品名、章順、表示設定
├─ manuscript/
│  ├─ chapter-....md       # 本文の正本
│  └─ chapter-....md
└─ .novel-editor/
   └─ history/             # local保存点
```

自動保存は同一フォルダー内のtemporary fileへ書き、flush後にrenameします。削除前と復元前には保存点を作り、復元操作そのものも取り消せる状態を残します。別案は独立フォルダーとして作成します。

## 構成

|場所|責任|
|---|---|
|`apps/novel-editor`|Electron main/preload、React執筆UI、installer設定|
|`packages/project-store`|plain Markdown project、atomic save、検索、保存点、復元、export|
|`packages/editor-core`|5つのrole、本文統計、検索、exact quote検証|
|`packages/lens-core`|snapshot、cutoff、anchor、安全境界|
|`packages/provider-openai`|Gate A用BYOK OpenAI adapter|
|`apps/gate-a-pilot`|generic回答とlensを比較する研究用companion|

初期の市場調査、Gate A仕様、fixtureは研究記録として`docs/`、`research/`、`specs/`に残しています。現在の製品状態は[desktop implementation status](./docs/desktop-implementation-status.md)を正とします。

設定、OpenAI/GitHub接続、更新境界の詳細は[設定・アカウント・更新の設計](./docs/settings-accounts-updates.md)にあります。

## Release

`v<major>.<minor>.<patch>` tagでGitHub ActionsがWindows、macOS Intel/Apple Silicon、Linuxのinstallerをbuildし、platform別SHA-256を添えてdraft releaseへuploadします。全matrix成功後だけReleaseを公開します。手順は[release guide](./docs/release.md)にあります。

## Security / contribution / license

- [Security policy](./SECURITY.md)
- [Contributing](./CONTRIBUTING.md)
- [Code of Conduct](./CODE_OF_CONDUCT.md)
- Apache License 2.0 — [LICENSE](./LICENSE)
