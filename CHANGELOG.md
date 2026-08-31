# Changelog

All notable changes to Novel Lens are documented here.

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
