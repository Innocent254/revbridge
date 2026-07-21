import { constants as fsConstants } from "node:fs";
import { access } from "node:fs/promises";
import path from "node:path";
import type { AndroidDevice, DeviceState } from "../../shared/types";
import { CommandRunner } from "./command-runner";

const ADB_DOWNLOAD_URL =
  "https://developer.android.com/tools/releases/platform-tools";

export { ADB_DOWNLOAD_URL };

function normalizeState(rawState: string): DeviceState {
  if (rawState === "device" || rawState === "unauthorized" || rawState === "offline") {
    return rawState;
  }
  if (rawState === "no permissions" || rawState === "no-permissions") {
    return "no-permissions";
  }
  return "unknown";
}

export function parseAdbDevices(output: string): AndroidDevice[] {
  const devices: AndroidDevice[] = [];

  for (const rawLine of output.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("List of devices attached") || line.startsWith("* daemon")) {
      continue;
    }

    const firstWhitespace = line.search(/\s/);
    if (firstWhitespace < 1) {
      continue;
    }

    const serial = line.slice(0, firstWhitespace);
    const remainder = line.slice(firstWhitespace).trim();
    const fields = remainder.split(/\s+/);
    const rawState = remainder.startsWith("no permissions")
      ? "no permissions"
      : fields.shift() ?? "unknown";
    const metadata: Record<string, string> = {};

    for (const field of fields) {
      const separator = field.indexOf(":");
      if (separator > 0) {
        metadata[field.slice(0, separator)] = field.slice(separator + 1);
      }
    }

    devices.push({
      serial,
      state: normalizeState(rawState),
      model: metadata.model?.replaceAll("_", " "),
      product: metadata.product,
      device: metadata.device,
      transportId: metadata.transport_id,
    });
  }

  return devices;
}

async function isExecutable(filePath: string): Promise<boolean> {
  try {
    await access(
      filePath,
      process.platform === "win32" ? fsConstants.F_OK : fsConstants.X_OK,
    );
    return true;
  } catch {
    return false;
  }
}

export async function findAdb(preferredPath?: string): Promise<string | undefined> {
  const executable = process.platform === "win32" ? "adb.exe" : "adb";
  const candidates: string[] = [];

  if (preferredPath) {
    candidates.push(preferredPath);
  }
  if (process.env.ADB) {
    candidates.push(process.env.ADB);
  }
  for (const sdkRoot of [process.env.ANDROID_HOME, process.env.ANDROID_SDK_ROOT]) {
    if (sdkRoot) {
      candidates.push(path.join(sdkRoot, "platform-tools", executable));
    }
  }

  const home = process.env.HOME ?? process.env.USERPROFILE;
  if (home) {
    candidates.push(path.join(home, "Android", "Sdk", "platform-tools", executable));
    candidates.push(path.join(home, "Library", "Android", "sdk", "platform-tools", executable));
  }
  if (process.env.LOCALAPPDATA) {
    candidates.push(
      path.join(process.env.LOCALAPPDATA, "Android", "Sdk", "platform-tools", executable),
    );
  }

  for (const directory of (process.env.PATH ?? "").split(path.delimiter)) {
    if (directory) {
      candidates.push(path.join(directory, executable));
    }
  }

  for (const candidate of [...new Set(candidates.map((item) => path.resolve(item)))]) {
    if (await isExecutable(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

export class AdbService {
  constructor(
    private adbPath: string,
    private readonly runner = new CommandRunner(),
  ) {}

  setPath(adbPath: string): void {
    this.adbPath = adbPath;
  }

  getPath(): string {
    return this.adbPath;
  }

  async getVersion(): Promise<string> {
    const result = await this.runner.run(this.adbPath, ["version"], { timeoutMs: 8_000 });
    return (
      result.stdout.match(/Android Debug Bridge version\s+([^\s]+)/)?.[1] ??
      result.stdout.split(/\r?\n/)[0]?.trim() ??
      "Unknown"
    );
  }

  async listDevices(): Promise<AndroidDevice[]> {
    await this.runner.run(this.adbPath, ["start-server"], { timeoutMs: 12_000 });
    const result = await this.runner.run(this.adbPath, ["devices", "-l"], {
      timeoutMs: 10_000,
    });
    const devices = parseAdbDevices(result.stdout);

    await Promise.all(
      devices
        .filter((device) => device.state === "device")
        .map(async (device) => {
          try {
            const [version, sdk] = await Promise.all([
              this.runForDevice(device.serial, ["shell", "getprop", "ro.build.version.release"]),
              this.runForDevice(device.serial, ["shell", "getprop", "ro.build.version.sdk"]),
            ]);
            device.androidVersion = version.stdout.trim();
            const parsedSdk = Number.parseInt(sdk.stdout.trim(), 10);
            device.sdkLevel = Number.isNaN(parsedSdk) ? undefined : parsedSdk;
          } catch {
            // Keep the device in the list; extended properties are optional.
          }
        }),
    );

    return devices;
  }

  async runForDevice(serial: string, args: string[], timeoutMs = 15_000) {
    return await this.runner.run(this.adbPath, ["-s", serial, ...args], { timeoutMs });
  }
}
