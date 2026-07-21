# Troubleshooting

Start with the **Diagnostics** page in RevBridge. It checks ADB, packaged assets, device state, and authorization.

## No phone detected

1. Use a USB cable that supports data, not charging only.
2. Unlock the phone.
3. Set the USB mode to **File transfer** if the OEM requires it.
4. Enable Developer options and USB debugging.
5. Disconnect and reconnect the cable, then click Refresh.

On Linux, a `no permissions` state usually means the current user needs the correct Android udev rule and group membership.

## Unauthorized

Keep the phone unlocked and accept the **Allow USB debugging?** prompt. If no prompt appears:

1. In Developer options, choose **Revoke USB debugging authorizations**.
2. Disconnect USB.
3. Restart ADB (`adb kill-server`, then `adb start-server`).
4. Reconnect and accept the new computer fingerprint.

## Companion app will not install

For Xiaomi, Redmi, Poco, Oppo, Realme, and some other OEMs, enable **Install via USB** and **USB debugging (Security settings)** in Developer options. The device may require a SIM card or OEM account before those switches can be changed.

If Android reports a signature mismatch after switching from an early test build, uninstall the old RevBridge companion from Android Settings and connect again.

## Android blocks the start intent

RevBridge no longer uses gnirehtet's old `WRITE_SECURE_SETTINGS` activity permission. If an OEM still blocks ADB-launched activities, enable its USB debugging security option or disable permission monitoring in Developer options, then retry.

## VPN permission never appears

Open Android Settings → Network & internet → VPN and forget any stale RevBridge entry, then connect again. Only one Android VPN can be active at a time.

## Connected but no internet

- Confirm the computer itself has internet access.
- Disconnect any phone VPN or always-on VPN.
- Reset advanced settings to DNS `1.1.1.1,8.8.8.8`, route `0.0.0.0/0`, and port `31416`.
- Check whether a computer firewall blocks the RevBridge relay.
- Export the log and inspect DNS/UDP warnings or repeated client disconnects.

## Port already in use

Stop any old gnirehtet/RevBridge process. Otherwise open Advanced settings and choose a free port between 1024 and 65535. RevBridge applies the same port to the relay and ADB reverse mapping.

## Exporting a useful report

After reproducing the problem, click **Export logs**. Before posting it publicly, review device serial numbers and destination IP addresses. Include the RevBridge version, desktop OS, Android version, OEM/model, and exact steps.
