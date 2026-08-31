# Release procedure

## 事前条件

- `main`で`pnpm check`が成功
- `apps/novel-editor/package.json`と`CHANGELOG.md`のversionが一致
- GitHub CLIまたはGit push権限が有効
- 公開Releaseの場合、署名状態と既知の制限をRelease noteへ明記

## Tag release

```bash
git tag -a v0.1.0 -m "Novel Lens v0.1.0"
git push origin v0.1.0
```

`Desktop release` workflowは次を行う。

1. tagとdesktop package versionの一致を検査
2. 型検査、必要な回帰試験、high以上のproduction advisory検査
3. draft GitHub Releaseを一度だけ作成
4. Windows x64、macOS Intel、macOS Apple Silicon、Linux x64を各native runnerでbuild
5. installer、platform別SHA-256、production dependency license一覧をdraftへ直接upload
6. 全platform成功後だけdraftを公開Releaseへ変更

workflowを手動再実行する場合は既存tagをinputへ指定する。未完のdraftへ同名artifactを再uploadするため、部分失敗から再開できる。

## Signing secrets

electron-builder標準のGitHub Actions secretだけを使う。

- Windows / macOS: `CSC_LINK`, `CSC_KEY_PASSWORD`
- macOS notarization: `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`

certificate、private key、PAT、API key、原稿をrepositoryへcommitしない。secretがない場合もinstallerは生成できるが、unsigned previewであることをRelease titleと本文へ明示する。

## Rollback

公開後のbinaryを同じtagで差し替えない。不具合Releaseは本文冒頭へ警告を付け、新しいpatch versionで修正する。重大な安全問題ではReleaseを取り下げ、Security Advisoryと修正版を案内する。
