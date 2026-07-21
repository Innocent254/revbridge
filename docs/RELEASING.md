# Releasing RevBridge

Release builds are produced by `.github/workflows/release.yml`. The workflow creates the Windows installer, macOS disk image, Linux packages, native relay, and signed Android companion, then attaches the desktop downloads to a GitHub Release. End users do not install the companion separately.

## Android signing secrets

Create one long-lived Android signing key and store it securely. Losing it prevents seamless upgrades; publishing it allows anyone to impersonate future companion updates.

Create it once with the JDK's `keytool` (it prompts for the passwords and certificate details):

```bash
keytool -genkeypair -keystore revbridge-release.jks -alias revbridge -keyalg RSA -keysize 2048 -validity 10000
```

Convert the keystore to one Base64 line. On Linux/macOS:

```bash
base64 < revbridge-release.jks | tr -d '\n'
```

Or in PowerShell:

```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes("revbridge-release.jks"))
```

In the repository, open **Settings → Secrets and variables → Actions** and add:

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
6. On GitHub, open **Actions → Release → Run workflow**, enter a tag such as `v0.1.0-alpha.1`, and run it. The workflow creates the tag and release. Maintainers who prefer Git may instead push a `v*` tag.

The workflow builds a signed companion APK, compiles the relay natively on each desktop OS, packages Electron installers, and creates the GitHub release. If any platform build fails, no partial release is published.

Android signing is mandatory. Windows code signing and macOS signing/notarization are separate and strongly recommended before a stable release; without them, the operating system may show an unknown-publisher warning.
