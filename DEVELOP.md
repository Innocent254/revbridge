# Developing RevBridge

RevBridge has three independently testable components:

- `desktop/`: Electron 43, TypeScript, and a Vite-rendered UI
- `relay-rust/`: the native Rust relay derived from gnirehtet
- `app/`: the Android `VpnService` companion

The desktop process launches the relay and controls Android through ADB. The renderer has no direct process, filesystem, or Node.js access; all privileged operations pass through the small API exposed by `preload.ts`.

## Desktop development

```bash
cd desktop
npm ci
npm test
npm run typecheck
npm run build
```

To run the GUI against locally built assets, place these files in `desktop/resources/staged/`:

```text
revbridge-client.apk
revbridge-relay       # Linux/macOS
revbridge-relay.exe   # Windows
```

Then run `npm run dev`. You may instead set `REVBRIDGE_APK` and `REVBRIDGE_RELAY` to absolute paths.

## Relay development

```bash
cd relay-rust
cargo fmt --all -- --check
cargo test --locked
cargo build --release --locked
```

The relay remains a standalone CLI for diagnostics and scripting:

```text
revbridge-relay run [serial]
revbridge-relay relay [-p PORT]
revbridge-relay install [serial]
revbridge-relay start [serial]
revbridge-relay stop [serial]
```

`ADB` selects a custom ADB executable and `REVBRIDGE_APK` selects the Android APK. The legacy `GNIREHTET_APK` variable is accepted for migration.

## Android development

Install JDK 17, Android SDK Platform 37, and Build Tools 36.0.0, then run:

```bash
./gradlew :app:testDebugUnitTest :app:lintDebug :app:assembleDebug
```

The debug APK is written to `app/build/outputs/apk/debug/app-debug.apk`.

The Java packet-forwarding code intentionally stays close to upstream so protocol changes remain auditable. The application ID, intent actions, ADB abstract socket, Android build system, foreground-service declarations, and lifecycle handling are RevBridge changes.

## Useful environment variables

| Variable | Purpose |
| --- | --- |
| `ADB` | Custom ADB executable used by the CLI relay |
| `REVBRIDGE_APK` | Custom companion APK used by the CLI relay |
| `REVBRIDGE_RELAY` | Local relay override used by the desktop app |

## Pull requests

Run all applicable tests before opening a PR. Keep upstream copyright headers in derived files and add a clear modification note when making material changes to old gnirehtet code. See [CONTRIBUTING.md](CONTRIBUTING.md).
