# Changelog

All notable changes follow [Keep a Changelog](https://keepachangelog.com/) and
this project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Changed

- Subscription emails are visible by default, and Add another subscription
  opens device sign-in directly without an intermediate menu row.

## [0.1.1] - 2026-08-20

### Added

- Windows x64 installation using the official desktop CLI/profile overrides,
  fail-closed Store build verification, recoverable updates, and an integrated
  subscription menu in the independent desktop copy.
- One-command installer with safe source updates, prerequisite checks, signed
  rebuilds, recoverable upgrades, and automatic launch.
- Reset-aware routing that prioritizes weekly quota at risk of expiring and
  gives a bounded boost to subscriptions with banked usage resets.

### Removed

- The separate Windows browser manager and its Start menu shortcut.

## [0.1.0] - 2026-08-15

### Added

- Multi-subscription routing with quota-aware balancing and sticky threads.
- Account isolation, device-code sign-in, pooled usage, and quota failover.
- Native account menu, masked emails, plan labels, and profile photos.
- Combined Profile statistics with per-account selection.
- Account-scoped Apps and MCP connection state in Settings → Plugins.
- Per-account rate-limit reset selection and pooled depletion handling.
- Independently signed Appshots and Computer Use support.
- Fail-closed upstream compatibility checks and deepest-first nested helper signing.
- Loopback-only, token-authenticated diagnostic UI states.
- Source-only CI, draft release automation, security documentation, and smoke tests.

[Unreleased]: https://github.com/b-nnett/codex-subscription-router/compare/v0.1.1...HEAD
[0.1.1]: https://github.com/b-nnett/codex-subscription-router/releases/tag/v0.1.1
[0.1.0]: https://github.com/b-nnett/codex-subscription-router/releases/tag/v0.1.0
