# Security policy

## Supported versions

Only the newest RevBridge release receives security fixes while the project is in alpha.

## Reporting a vulnerability

Please do **not** open a public issue for a suspected security vulnerability. Use GitHub's private **Report a vulnerability** form in the repository Security tab.

Include:

- the affected RevBridge version and operating system;
- the Android version and manufacturer when relevant;
- reproduction steps or a proof of concept;
- the expected security impact; and
- any suggested mitigation.

Connection logs may include device serial numbers, installed-client version information, IP addresses contacted by Android apps, and ADB errors. Remove details you do not want to disclose before attaching a log.

## Security boundaries

RevBridge intentionally controls a connected Android device through an already-authorized ADB session and creates a local Android VPN. It does not provide network encryption between the computer and the wider internet. Applications should continue using TLS/HTTPS for end-to-end security.
