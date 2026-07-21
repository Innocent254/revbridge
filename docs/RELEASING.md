# Releasing RevBridge

Release builds are produced by `.github/workflows/release.yml` from tags matching `v*`.

## Android signing secrets

Create one long-lived Android signing key and store it securely. Losing it prevents seamless upgrades; publishing it allows anyone to impersonate future companion updates.

Configure these GitHub Actions secrets:

| Secret | Value |
| --- | --- |
| `REVBRIDGE_KEYSTORE_BASE64` | Base64-encoded JKS/PKCS12 keystore bytes |
| `REVBRIDGE_KEYSTORE_PASSWORD` | Keystore password |
| `REVBRIDGE_KEY_ALIAS` | Signing-key alias |
| `REVBRIDGE_KEY_PASSWORD` | Signing-key password |

Never commit the keystore or passwords. The repository `.gitignore` rejects common keystore extensions.

## Version checklist

1. Update `desktop/package.json`.
2. Update `app/build.gradle` (`versionCode` and `versionName`).
3. Update `relay-rust/Cargo.toml` and regenerate `Cargo.lock`.
4. Add user-facing changes to release notes or the tag message.
5. Confirm CI is green on `main`.
6. Create and push an annotated tag, for example `v0.1.0-alpha.1`.

The workflow builds a signed companion APK, compiles the relay natively on each desktop OS, packages Electron installers, and creates the GitHub release. macOS and Windows application code-signing/notarization can be added independently; Android signing is mandatory.
