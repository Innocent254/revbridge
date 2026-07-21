import { EventEmitter } from "node:events";
import type {
  AppSettings,
  AppSnapshot,
  DiagnosticCheck,
  LogEntry,
  StartTunnelRequest,
} from "../shared/types";
import { AdbService } from "./services/adb";
import type { AppAssets } from "./services/assets";
import { fileExists } from "./services/assets";
import { CommandError } from "./services/command-runner";
import { RelayService, type RelayLine } from "./services/relay";
import { SettingsStore } from "./services/settings-store";

export const CLIENT_PACKAGE = "io.github.innocent254.revbridge";
export const CLIENT_ACTIVITY =
  `${CLIENT_PACKAGE}/io.github.innocent254.revbridge.GnirehtetActivity`;
export const CLIENT_START_ACTION = `${CLIENT_PACKAGE}.START`;
export const CLIENT_STOP_ACTION = `${CLIENT_PACKAGE}.STOP`;
export const REVERSE_SOCKET = "localabstract:revbridge";
export const REQUIRED_CLIENT_VERSION_CODE = 1;

export function validateStartRequest(request: StartTunnelRequest): string[] {
  const errors: string[] = [];
  if (!request.serial.trim()) {
    errors.push("Choose an Android device.");
  }
  if (!Number.isInteger(request.port) || request.port < 1 || request.port > 65_535) {
    errors.push("Port must be a whole number between 1 and 65535.");
  }
  if (!request.dnsServers.trim()) {
    errors.push("At least one DNS server is required.");
  }
  if (!request.routes.trim()) {
    errors.push("At least one IPv4 route is required.");
  }
  return errors;
}

export function buildStartActivityArgs(request: StartTunnelRequest): string[] {
  return [
    "shell",
    "am",
    "start",
    "-a",
    CLIENT_START_ACTION,
    "-n",
    CLIENT_ACTIVITY,
    "--esa",
    "dnsServers",
    request.dnsServers,
    "--esa",
    "routes",
    request.routes,
  ];
}

function friendlyError(error: unknown): string {
  const raw =
    error instanceof CommandError
      ? `${error.message}\n${error.result.stdout}\n${error.result.stderr}`
      : error instanceof Error
        ? error.message
        : String(error);

  if (/unauthorized/i.test(raw)) {
    return "This phone has not authorized this computer. Unlock it and accept the USB debugging prompt.";
  }
  if (/DeviceBusy|already in use|claim interface|LIBUSB_ERROR_BUSY/i.test(raw)) {
    return "Another program is using the phone’s debugging connection. Close Android Studio, other phone tools, or any running ADB server, then reconnect.";
  }
  if (/LIBUSB_ERROR_NOT_SUPPORTED|LIBUSB_ERROR_ACCESS|Access denied|driver/i.test(raw)) {
    return "The computer cannot open the phone’s USB debugging interface. On Windows, install the phone manufacturer’s USB driver; on Linux, check Android udev permissions.";
  }
  if (/INSTALL_FAILED_USER_RESTRICTED|user rejected|install canceled/i.test(raw)) {
    return "Android blocked the companion app install. Enable “Install via USB” (and, on Xiaomi, “USB debugging — Security settings”) in Developer options.";
  }
  if (/no devices|device not found|offline/i.test(raw)) {
    return "The phone disconnected or went offline. Reconnect USB, choose File transfer, and try again.";
  }
  if (/Address already in use|os error 10048/i.test(raw)) {
    return "The relay port is already in use. Stop the other tunnel or choose a different advanced port.";
  }
  if (/Permission Denial|WRITE_SECURE_SETTINGS/i.test(raw)) {
    return "Android blocked remote launch permission. Reinstall the new RevBridge client; if your OEM still blocks it, enable USB debugging security controls in Developer options.";
  }
  return raw.trim().split(/\r?\n/).filter(Boolean).slice(0, 3).join(" — ");
}

export class AppController extends EventEmitter {
  private logId = 0;
  private reconnecting = false;
  private activeRequest?: StartTunnelRequest;
  private monitor?: NodeJS.Timeout;
  private snapshot: AppSnapshot;

  constructor(
    private readonly assets: AppAssets,
    private readonly settingsStore: SettingsStore,
    private readonly adb: AdbService,
    private readonly relay: RelayService,
    version: string,
  ) {
    super();
    this.snapshot = {
      dependencies: {
        adb: { available: false },
        relay: { available: false, path: assets.relayPath },
        client: { available: false, path: assets.clientApkPath },
      },
      devices: [],
      diagnostics: [],
      tunnel: { phase: "idle", message: "Ready to connect" },
      settings: {
        dnsServers: "1.1.1.1,8.8.8.8",
        routes: "0.0.0.0/0",
        port: 31416,
        autoReconnect: true,
        theme: "system",
      },
      logs: [],
      version,
    };

    this.relay.on("line", (line: RelayLine) => this.handleRelayLine(line));
    this.relay.on("exit", ({ code }) => {
      this.addLog(code === 0 ? "info" : "warning", "relay", `Relay exited (${code ?? "signal"}).`);
      if (this.snapshot.tunnel.phase !== "stopping" && this.snapshot.tunnel.phase !== "idle") {
        this.setTunnel("error", "The relay stopped unexpectedly. Run diagnostics, then reconnect.");
      }
    });
    this.relay.on("error", (error: Error) => {
      this.addLog("error", "relay", error.message);
    });
  }

  async initialize(): Promise<void> {
    this.snapshot.settings = await this.settingsStore.load();
    await this.resolveDependencies();
    await this.refreshDevices();
  }

  getSnapshot(): AppSnapshot {
    return structuredClone(this.snapshot);
  }

  async refreshDevices(): Promise<AppSnapshot> {
    try {
      this.snapshot.devices = await this.adb.listDevices();
      const selectedStillExists = this.snapshot.devices.some(
        (device) => device.serial === this.snapshot.settings.selectedSerial,
      );
      if (!selectedStillExists) {
        this.snapshot.settings.selectedSerial =
          this.snapshot.devices.find((device) => device.state === "device")?.serial;
      }
      this.addLog(
        "debug",
        "adb",
        `Found ${this.snapshot.devices.length} Android device${this.snapshot.devices.length === 1 ? "" : "s"}.`,
      );
    } catch (error) {
      this.snapshot.devices = [];
      this.addLog("error", "adb", friendlyError(error));
    }
    await this.rebuildDiagnostics();
    this.emitSnapshot();
    return this.getSnapshot();
  }

  async runDiagnostics(): Promise<AppSnapshot> {
    await this.resolveDependencies();
    try {
      this.snapshot.devices = await this.adb.listDevices();
    } catch (error) {
      this.addLog("error", "adb", friendlyError(error));
    }
    await this.rebuildDiagnostics();
    this.emitSnapshot();
    return this.getSnapshot();
  }

  async saveSettings(settings: Partial<AppSettings>): Promise<AppSnapshot> {
    this.snapshot.settings = { ...this.snapshot.settings, ...settings };
    await this.settingsStore.save(this.snapshot.settings);
    this.emitSnapshot();
    return this.getSnapshot();
  }

  async startTunnel(request: StartTunnelRequest): Promise<AppSnapshot> {
    const validationErrors = validateStartRequest(request);
    if (validationErrors.length > 0) {
      this.setTunnel("error", validationErrors.join(" "));
      return this.getSnapshot();
    }
    const device = this.snapshot.devices.find((item) => item.serial === request.serial);
    if (!device || device.state !== "device") {
      this.setTunnel(
        "error",
        device?.state === "unauthorized"
          ? "Unlock the phone and accept its USB debugging prompt."
          : "The selected phone is not ready for ADB.",
      );
      return this.getSnapshot();
    }
    if (!(await fileExists(this.assets.relayPath, true)) || !(await fileExists(this.assets.clientApkPath))) {
      this.setTunnel("error", "This build is missing its relay or Android client asset.");
      return this.getSnapshot();
    }

    this.activeRequest = { ...request };
    await this.saveSettings({
      selectedSerial: request.serial,
      dnsServers: request.dnsServers,
      routes: request.routes,
      port: request.port,
      autoReconnect: request.autoReconnect,
    });
    this.setTunnel(
      "starting",
      "Unlock the phone and allow USB debugging if Android asks…",
      request.serial,
    );
    this.addLog("info", "app", `Starting RevBridge for ${device.model ?? request.serial}.`);

    try {
      await this.adb.connectDevice(request.serial);
      this.snapshot.devices = await this.adb.listDevices();
      this.emitSnapshot();
      await this.ensureClientInstalled(request.serial);
      this.setTunnel("starting", "Opening the USB reverse tunnel…", request.serial);
      await this.adb.runForDevice(request.serial, [
        "reverse",
        REVERSE_SOCKET,
        `tcp:${request.port}`,
      ]);
      this.addLog("info", "adb", `${REVERSE_SOCKET} → tcp:${request.port}`);

      this.setTunnel("starting", "Starting the relay…", request.serial);
      await this.relay.start(this.assets.relayPath, request.port);

      this.setTunnel(
        "waiting-permission",
        "Check the phone and allow the VPN connection if Android asks.",
        request.serial,
      );
      const startResult = await this.adb.runForDevice(
        request.serial,
        buildStartActivityArgs(request),
        20_000,
      );
      const launchOutput = `${startResult.stdout}\n${startResult.stderr}`.trim();
      if (launchOutput) {
        this.addLog("info", "adb", launchOutput.replace(/\r?\n/g, " · "));
      }
      this.startMonitor();
    } catch (error) {
      await this.relay.stop();
      this.setTunnel("error", friendlyError(error), request.serial);
      this.addLog("error", "app", friendlyError(error));
    }

    return this.getSnapshot();
  }

  async stopTunnel(): Promise<AppSnapshot> {
    this.stopMonitor();
    const serial = this.snapshot.tunnel.serial ?? this.activeRequest?.serial;
    this.setTunnel("stopping", "Stopping the tunnel…", serial);
    if (serial) {
      try {
        await this.adb.runForDevice(serial, [
          "shell",
          "am",
          "start",
          "-a",
          CLIENT_STOP_ACTION,
          "-n",
          CLIENT_ACTIVITY,
        ]);
      } catch (error) {
        this.addLog("warning", "adb", friendlyError(error));
      }
      try {
        await this.adb.runForDevice(serial, ["reverse", "--remove", REVERSE_SOCKET]);
      } catch {
        // The reverse mapping disappears automatically when USB disconnects.
      }
    }
    await this.relay.stop();
    this.activeRequest = undefined;
    this.setTunnel("idle", "Ready to connect");
    this.addLog("info", "app", "Tunnel stopped.");
    return this.getSnapshot();
  }

  getLogText(): string {
    return this.snapshot.logs
      .map(
        (entry) =>
          `${entry.timestamp} [${entry.level.toUpperCase()}] [${entry.source}] ${entry.message}`,
      )
      .join("\n");
  }

  async shutdown(): Promise<void> {
    this.stopMonitor();
    await this.stopTunnel();
    await this.adb.close();
  }

  private async resolveDependencies(): Promise<void> {
    this.snapshot.dependencies.adb = {
      available: true,
      version: await this.adb.getVersion(),
    };
    this.snapshot.dependencies.relay = {
      available: await fileExists(this.assets.relayPath, true),
      path: this.assets.relayPath,
    };
    this.snapshot.dependencies.client = {
      available: await fileExists(this.assets.clientApkPath),
      path: this.assets.clientApkPath,
    };
  }

  private async ensureClientInstalled(serial: string): Promise<void> {
    let installedVersion = 0;
    try {
      const result = await this.adb.runForDevice(serial, [
        "shell",
        "dumpsys",
        "package",
        CLIENT_PACKAGE,
      ]);
      installedVersion = Number.parseInt(
        result.stdout.match(/versionCode=(\d+)/)?.[1] ?? "0",
        10,
      );
    } catch {
      installedVersion = 0;
    }

    if (installedVersion >= REQUIRED_CLIENT_VERSION_CODE) {
      this.addLog("info", "adb", `Android client v${installedVersion} is ready.`);
      return;
    }

    this.addLog(
      "info",
      "adb",
      installedVersion > 0 ? "Updating the Android client…" : "Installing the Android client…",
    );
    const result = await this.adb.runForDevice(
      serial,
      ["install", "-r", this.assets.clientApkPath],
      90_000,
    );
    this.addLog("info", "adb", result.stdout.trim() || "Android client installed.");
  }

  private handleRelayLine(line: RelayLine): void {
    const level = /\bERROR\b/.test(line.text)
      ? "error"
      : /\bWARN\b/.test(line.text)
        ? "warning"
        : "info";
    this.addLog(level, "relay", line.text);

    if (/Client #\d+ connected/.test(line.text)) {
      this.setTunnel(
        "connected",
        "Internet is being shared through this computer.",
        this.activeRequest?.serial,
        this.snapshot.tunnel.startedAt ?? new Date().toISOString(),
      );
    } else if (/Client #\d+ disconnected/.test(line.text) && this.activeRequest) {
      this.setTunnel(
        "waiting-permission",
        "The phone disconnected. Waiting for it to return…",
        this.activeRequest.serial,
        this.snapshot.tunnel.startedAt,
      );
    }
  }

  private startMonitor(): void {
    this.stopMonitor();
    if (!this.activeRequest?.autoReconnect) {
      return;
    }
    this.monitor = setInterval(() => void this.reconnectIfNeeded(), 4_000);
  }

  private stopMonitor(): void {
    if (this.monitor) {
      clearInterval(this.monitor);
      this.monitor = undefined;
    }
  }

  private async reconnectIfNeeded(): Promise<void> {
    if (this.reconnecting || !this.activeRequest) {
      return;
    }
    this.reconnecting = true;
    try {
      const devices = await this.adb.listDevices();
      const device = devices.find((item) => item.serial === this.activeRequest?.serial);
      if (!device || device.state !== "device") {
        if (this.snapshot.tunnel.phase === "connected") {
          this.setTunnel(
            "waiting-permission",
            "USB disconnected. Reconnect the phone to resume automatically…",
            this.activeRequest.serial,
            this.snapshot.tunnel.startedAt,
          );
        }
        return;
      }
      if (this.snapshot.tunnel.phase === "waiting-permission") {
        await this.adb.runForDevice(this.activeRequest.serial, [
          "reverse",
          REVERSE_SOCKET,
          `tcp:${this.activeRequest.port}`,
        ]);
        await this.adb.runForDevice(
          this.activeRequest.serial,
          buildStartActivityArgs(this.activeRequest),
        );
        this.addLog("info", "app", "Phone returned; the reverse tunnel was restored.");
      }
    } catch (error) {
      this.addLog("warning", "adb", friendlyError(error));
    } finally {
      this.reconnecting = false;
    }
  }

  private async rebuildDiagnostics(): Promise<void> {
    const checks: DiagnosticCheck[] = [];
    checks.push({
      id: "usb",
      title: "Built-in USB connection",
      detail: "Included in RevBridge — no separate Platform Tools installation required",
      level: "pass",
    });

    for (const [id, label, dependency] of [
      ["relay", "Native relay", this.snapshot.dependencies.relay] as const,
      ["client", "Android companion", this.snapshot.dependencies.client] as const,
    ]) {
      checks.push({
        id,
        title: label,
        detail: dependency.available ? "Included and ready" : "Missing from this app build",
        level: dependency.available ? "pass" : "fail",
      });
    }

    if (this.snapshot.devices.length === 0) {
      checks.push({
        id: "device",
        title: "Android device",
        detail: "No phone detected. Use a data-capable USB cable and enable USB debugging.",
        level: "warning",
      });
    } else {
      for (const device of this.snapshot.devices) {
        checks.push({
          id: `device-${device.serial}`,
          title: device.model ?? device.serial,
          detail:
            device.state === "device"
              ? device.androidVersion
                ? `Ready · Android ${device.androidVersion}`
                : "Detected over USB · authorization happens when you connect"
              : device.state === "unauthorized"
                ? "Unauthorized · unlock the phone and accept the debugging prompt"
                : `${device.state} · reconnect USB and retry`,
          level: device.state === "device" ? "pass" : "warning",
        });
      }
    }
    this.snapshot.diagnostics = checks;
  }

  private setTunnel(
    phase: AppSnapshot["tunnel"]["phase"],
    message: string,
    serial?: string,
    startedAt?: string,
  ): void {
    this.snapshot.tunnel = { phase, message, serial, startedAt };
    this.emitSnapshot();
  }

  private addLog(
    level: LogEntry["level"],
    source: LogEntry["source"],
    message: string,
  ): void {
    if (!message.trim()) {
      return;
    }
    this.snapshot.logs.push({
      id: ++this.logId,
      timestamp: new Date().toISOString(),
      level,
      source,
      message: message.trim(),
    });
    if (this.snapshot.logs.length > 500) {
      this.snapshot.logs.splice(0, this.snapshot.logs.length - 500);
    }
    this.emitSnapshot();
  }

  private emitSnapshot(): void {
    this.emit("snapshot", this.getSnapshot());
  }
}
