# Changelog

All notable changes to Novel Lens are documented here.

## 0.2.0 - 2026-09-01

### Added

- Added a dedicated VS Code-inspired settings view with searchable categories and separate user/workspace scopes.
- Added editable, conflict-checked keyboard shortcuts that immediately rebuild the native application menu.
- Added session-only OpenAI API connection verification outside the manuscript panel.
- Added GitHub CLI browser login and connection status without reading or storing the user's token.
- Added an in-app update center that checks public GitHub Releases and opens the correct installer for the current OS and CPU.

### Changed

- User defaults such as autosave, editor appearance, AI provider, model, update checks, and keybindings now persist atomically in the OS application-settings directory.
- The lens panel no longer receives or retains an API key after OpenAI has been connected.

## 0.1.1 - 2026-09-01

### Fixed

- Restored the visible, clickable primary action on the welcome screen.
- Replaced unsupported Electron `window.prompt()` calls with an in-app text dialog.
- Made existing projects open through their visible `novel-lens.json` file instead of an empty-looking directory-only picker.
- Kept welcome actions reachable at small window sizes and high display scaling.

## 0.1.0 - 2026-08-31

### Added

- Local-first Electron novel editor backed by plain Markdown files.
- Chapter/scene creation, import, rename, reorder, autosave, search, and export.
- Horizontal and direct vertical writing with workspace customization.
- Native checkpoints, safe restore, and independent variation folders.
- Five role-specific conversational lenses with explicit scope preview.
- Offline Mock and OpenAI BYOK with locally verified quote anchors.
- Windows, macOS, and Linux installer configuration and gated GitHub Release workflow.
- Apache-2.0 license, security policy, contribution guide, checksums, and dependency-license artifacts.
