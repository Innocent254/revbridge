import { generateKeyPairSync } from "node:crypto";
import { once } from "node:events";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createConnection } from "node:net";
import { hostname } from "node:os";
import path from "node:path";
import {
  Adb,
  AdbDaemonTransport,
  type AdbCredentialStore,
  type AdbPrivateKey,
  type AdbSocket,
} from "@yume-chan/adb";
import {
  AdbDaemonWebUsbDevice,
  AdbDaemonWebUsbDeviceManager,
} from "@yume-chan/adb-daemon-webusb";
import { PackageManager } from "@yume-chan/android-bin";
import { ReadableStream } from "@yume-chan/stream-extra";
import { WebUSB } from "usb";
import type { AndroidDevice, DeviceState } from "../../shared/types";

interface UsbSession {
  hardware: AdbDaemonWebUsbDevice;
  adb: Adb;
  model?: string;
  product?: string;
  device?: string;
  androidVersion?: string;
  sdkLevel?: number;
}

export interface AdbCommandResult {
  stdout: string;
  stderr: string;
}

function normalizeState(rawState: string): DeviceState {
  if (rawState === "device" || rawState === "unauthorized" || rawState === "offline") {
    return rawState;
  }
  if (rawState === "no permissions" || rawState === "no-permissions") {
    return "no-permissions";
  }
  return "unknown";
}

/**
 * Kept as a small compatibility parser for imported logs and regression tests.
 * Runtime device access uses Tango's direct USB transport below, not Google ADB.
 */
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

class FileCredentialStore implements AdbCredentialStore {
  private cached?: AdbPrivateKey;

  constructor(private readonly keyPath: string) {}

  async *iterateKeys(): AsyncGenerator<AdbPrivateKey> {
    const key = await this.load();
    if (key) {
      yield key;
    }
  }

  async generateKey(): Promise<AdbPrivateKey> {
    const existing = await this.load();
    if (existing) {
      return existing;
    }

    const { privateKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
      publicExponent: 0x10001,
      privateKeyEncoding: { format: "der", type: "pkcs8" },
      publicKeyEncoding: { format: "der", type: "spki" },
    });
    const key: AdbPrivateKey = {
      buffer: new Uint8Array(privateKey),
      name: `${hostname()}@RevBridge`,
    };
    await mkdir(path.dirname(this.keyPath), { recursive: true });
    await writeFile(this.keyPath, privateKey, { mode: 0o600 });
    this.cached = key;
    return key;
  }

  private async load(): Promise<AdbPrivateKey | undefined> {
    if (this.cached) {
      return this.cached;
    }
    try {
      const buffer = await readFile(this.keyPath);
      this.cached = {
        buffer: new Uint8Array(buffer),
        name: `${hostname()}@RevBridge`,
      };
      return this.cached;
    } catch {
      return undefined;
    }
  }
}

async function bridgeReverseSocket(socket: AdbSocket, port: number): Promise<void> {
  const tcp = createConnection({ host: "127.0.0.1", port });
  const reader = socket.readable.getReader();
  const writer = socket.writable.getWriter();

  try {
    await once(tcp, "connect");

    const phoneToComputer = async () => {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          tcp.end();
          return;
        }
        if (!tcp.write(Buffer.from(value))) {
          await once(tcp, "drain");
        }
      }
    };

    const computerToPhone = async () => {
      for await (const chunk of tcp) {
        await writer.write(new Uint8Array(chunk));
      }
      await writer.close();
    };

    await Promise.allSettled([phoneToComputer(), computerToPhone()]);
  } finally {
    reader.releaseLock();
    writer.releaseLock();
    tcp.destroy();
    await Promise.resolve(socket.close()).catch(() => undefined);
  }
}

export class AdbService {
  private readonly manager: AdbDaemonWebUsbDeviceManager;
  private readonly credentials: FileCredentialStore;
  private readonly hardware = new Map<string, AdbDaemonWebUsbDevice>();
  private readonly sessions = new Map<string, UsbSession>();

  constructor(keyPath: string) {
    this.manager = new AdbDaemonWebUsbDeviceManager(
      new WebUSB({ allowAllDevices: true, deviceTimeout: 15_000 }),
    );
    this.credentials = new FileCredentialStore(keyPath);
  }

  async getVersion(): Promise<string> {
    return "Direct USB";
  }

  async connectDevice(serial: string): Promise<void> {
    await this.ensureAdb(serial);
  }

  async listDevices(): Promise<AndroidDevice[]> {
    const connected = await this.manager.getDevices();
    const activeSerials = new Set<string>();
    this.hardware.clear();

    const devices = await Promise.all(
      connected.map(async (hardware, index): Promise<AndroidDevice> => {
        const serial = hardware.serial || `usb-${hardware.raw.vendorId}-${hardware.raw.productId}-${index}`;
        activeSerials.add(serial);
        this.hardware.set(serial, hardware);

        const session = this.sessions.get(serial);
        if (session && !session.model) {
          await this.populateSessionDetails(session);
        }

        return {
          serial,
          state: "device",
          model:
            session?.model ??
            hardware.raw.productName ??
            hardware.name ??
            "Android phone",
          product: session?.product ?? hardware.raw.manufacturerName ?? undefined,
          device: session?.device,
          androidVersion: session?.androidVersion,
          sdkLevel: session?.sdkLevel,
        };
      }),
    );

    for (const [serial, session] of this.sessions) {
      if (!activeSerials.has(serial)) {
        this.sessions.delete(serial);
        await session.adb.close();
      }
    }

    return devices;
  }

  async runForDevice(
    serial: string,
    args: string[],
    _timeoutMs = 15_000,
  ): Promise<AdbCommandResult> {
    const adb = await this.ensureAdb(serial);
    const [command, ...rest] = args;

    if (command === "shell") {
      const stdout = await adb.subprocess.noneProtocol.spawnWaitText(rest);
      return { stdout, stderr: "" };
    }

    if (command === "reverse") {
      if (rest[0] === "--remove") {
        await adb.reverse.remove(rest[1]!);
        return { stdout: "", stderr: "" };
      }

      const [deviceAddress, localAddress] = rest;
      const port = Number.parseInt(localAddress?.match(/^tcp:(\d+)$/)?.[1] ?? "", 10);
      if (!deviceAddress || !Number.isInteger(port)) {
        throw new Error("Invalid reverse-tunnel address.");
      }

      try {
        await adb.reverse.remove(deviceAddress);
      } catch {
        // There may be no earlier mapping to replace.
      }
      await adb.reverse.add(
        deviceAddress,
        (socket) => bridgeReverseSocket(socket, port),
        localAddress,
      );
      return { stdout: `${deviceAddress} → ${localAddress}`, stderr: "" };
    }

    if (command === "install") {
      const apkPath = rest.at(-1);
      if (!apkPath) {
        throw new Error("The Android companion path is missing.");
      }
      const apk = await readFile(apkPath);
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array(apk));
          controller.close();
        },
      });
      await new PackageManager(adb).installStream(apk.byteLength, stream);
      return { stdout: "Success", stderr: "" };
    }

    throw new Error(`Unsupported direct USB command: ${args.join(" ")}`);
  }

  async close(): Promise<void> {
    const sessions = [...this.sessions.values()];
    this.sessions.clear();
    await Promise.allSettled(sessions.map((session) => session.adb.close()));
  }

  private async ensureAdb(serial: string): Promise<Adb> {
    const existing = this.sessions.get(serial);
    if (existing) {
      return existing.adb;
    }

    let hardware = this.hardware.get(serial);
    if (!hardware) {
      await this.listDevices();
      hardware = this.hardware.get(serial);
    }
    if (!hardware) {
      throw new Error("USB device not found. Reconnect the phone and try again.");
    }

    try {
      const connection = await hardware.connect();
      let authorizationTimer: NodeJS.Timeout | undefined;
      const transport = await Promise.race([
        AdbDaemonTransport.authenticate({
          serial,
          connection,
          credentialStore: this.credentials,
        }),
        new Promise<never>((_resolve, reject) => {
          authorizationTimer = setTimeout(() => {
            void hardware.raw.close().catch(() => undefined);
            reject(
              new Error(
                "USB debugging authorization timed out. Unlock the phone, accept the prompt, and try again.",
              ),
            );
          }, 90_000);
        }),
      ]).finally(() => {
        if (authorizationTimer) clearTimeout(authorizationTimer);
      });
      const session: UsbSession = { hardware, adb: new Adb(transport) };
      this.sessions.set(serial, session);
      void transport.disconnected.finally(() => this.sessions.delete(serial));
      await this.populateSessionDetails(session);
      return session.adb;
    } catch (error) {
      if (hardware.raw.opened) {
        await hardware.raw.close().catch(() => undefined);
      }
      throw error;
    }
  }

  private async populateSessionDetails(session: UsbSession): Promise<void> {
    try {
      const [model, product, device, version, sdk] = await Promise.all([
        session.adb.getProp("ro.product.model"),
        session.adb.getProp("ro.product.name"),
        session.adb.getProp("ro.product.device"),
        session.adb.getProp("ro.build.version.release"),
        session.adb.getProp("ro.build.version.sdk"),
      ]);
      session.model = model || session.hardware.raw.productName || "Android phone";
      session.product = product || undefined;
      session.device = device || undefined;
      session.androidVersion = version || undefined;
      const parsedSdk = Number.parseInt(sdk, 10);
      session.sdkLevel = Number.isNaN(parsedSdk) ? undefined : parsedSdk;
    } catch {
      session.model ??= session.hardware.raw.productName ?? "Android phone";
    }
  }
}
