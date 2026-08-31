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

## 原稿データとuninstall

作品は利用者が選んだフォルダーに`novel-lens.json`と`manuscript/*.md`として保存され、アプリのuninstallでは削除されません。必要な作品フォルダーをbackupしてからOSの通常手順でアプリを削除してください。APIキーとAI会話はdisk保存しません。
