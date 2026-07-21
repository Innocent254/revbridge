# Contributing to RevBridge

Thank you for helping make no-root reverse tethering reliable again.

## Before opening an issue

1. Run **Diagnostics** in the desktop app.
2. Reproduce the problem once.
3. Export the connection log.
4. Search existing issues for the same Android version, OEM, or error text.

Bug reports should include the desktop OS, Android version, device manufacturer/model, RevBridge version, ADB version, steps to reproduce, and the exported log with sensitive details removed.

## Pull requests

- Keep changes focused and explain the user-facing reason.
- Add or update tests for parser, control, or settings behavior.
- Run desktop tests and type checking, Rust tests/formatting, and Android unit tests/lint where applicable.
- Do not weaken Electron context isolation or enable renderer Node.js access.
- Do not silently upload telemetry, logs, browsing data, or device identifiers.
- Preserve Apache-2.0 headers and upstream attribution in derived source files.

The CI workflow is the reference build for all supported platforms.
