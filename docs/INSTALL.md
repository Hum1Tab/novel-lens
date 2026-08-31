# インストール

[GitHub Releases](https://github.com/Hum1Tab/novel-lens/releases/latest)から利用OS・CPUに合うファイルと、同名platformの`SHA256SUMS`を取得してください。

## Windows 10 / 11 x64

- `Novel-Lens-<version>-windows-x64-setup.exe`: 通常installer
- `Novel-Lens-<version>-windows-x64-portable.exe`: installせず起動

署名secretを設定していないpreview buildでは、SmartScreenの警告が表示されます。Release本文の署名状態とchecksumを確認し、出所が確認できないbuildは実行しないでください。

## macOS Intel / Apple Silicon

- Intel Mac: `mac-x64.dmg` / `.zip`
- Apple Silicon: `mac-arm64.dmg` / `.zip`

`.dmg`を開き、Novel LensをApplicationsへ移します。Developer ID署名・notarizationのないpreview buildは「プライバシーとセキュリティ」から個別許可が必要です。正式ReleaseではRelease本文のnotarization状態を確認してください。

## Linux x64

- AppImage: `chmod +x <file>.AppImage`の後に起動
- Debian / Ubuntu: `.deb`をpackage managerでinstall

## checksum

PowerShell:

```powershell
Get-FileHash .\Novel-Lens-*.exe -Algorithm SHA256
```

macOS / Linux:

```bash
shasum -a 256 Novel-Lens-*
```

表示値をRelease添付の`SHA256SUMS-<platform>-<arch>.txt`と比較します。

## アプリ内更新

install済みのNovel Lensでは「設定 → 更新」から最新版を確認できます。packaged版は「起動時に確認」をオンにすると起動後に自動確認します。更新がある場合は「ダウンロードして更新」を押すと、現在のOS・CPU用installerをtemporary directoryへ取得し、GitHub ReleaseのSHA-256と一致した場合だけ起動します。

これは無人installではありません。未署名previewではOSの警告内容を確認し、installer画面で続行してください。作品原稿はinstall先とは別の利用者指定フォルダーに残ります。

## アプリ内更新

「設定 → 更新 → 今すぐ確認」は、tokenなしで公開GitHub Releasesへ接続し、現在のversionと最新版を比較する。新しいversionがある場合は現在のOS・CPU用installerを開く。packaged版では「起動時に確認」を有効にすると、起動後に1回だけ同じ確認を行う。原稿、作品名、設定、GitHub認証は送信しない。

macOSの完全自動更新はcode signingが必須であり、Linuxはpackage managerとの整合も必要になるため、v0.2では全OS共通で「最新版確認と正しいinstallerへの案内」までを安全な共通動作とする。

## 原稿データとuninstall

作品は利用者が選んだフォルダーに`novel-lens.json`と`manuscript/*.md`として保存され、アプリのuninstallでは削除されません。必要な作品フォルダーをbackupしてからOSの通常手順でアプリを削除してください。APIキーとAI会話はdisk保存しません。
