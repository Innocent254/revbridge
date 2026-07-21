export type DeviceState =
  | "device"
  | "unauthorized"
  | "offline"
  | "no-permissions"
  | "unknown";

export interface AndroidDevice {
  serial: string;
  state: DeviceState;
  model?: string;
  product?: string;
  device?: string;
  transportId?: string;
  androidVersion?: string;
  sdkLevel?: number;
}

export type CheckLevel = "pass" | "warning" | "fail" | "info";

export interface DiagnosticCheck {
  id: string;
  title: string;
  detail: string;
  level: CheckLevel;
  actionLabel?: string;
  actionUrl?: string;
}

export type TunnelPhase =
  | "idle"
  | "starting"
  | "waiting-permission"
  | "connected"
  | "stopping"
  | "error";

export interface TunnelState {
  phase: TunnelPhase;
  serial?: string;
  message: string;
  startedAt?: string;
}

export interface DependencyState {
  adb: {
    available: boolean;
    path?: string;
    version?: string;
  };
  relay: {
    available: boolean;
    path?: string;
  };
  client: {
    available: boolean;
    path?: string;
  };
}

export interface LogEntry {
  id: number;
  timestamp: string;
  level: "debug" | "info" | "warning" | "error";
  source: "app" | "adb" | "relay";
  message: string;
}

export interface AppSettings {
  selectedSerial?: string;
  dnsServers: string;
  routes: string;
  port: number;
  autoReconnect: boolean;
  theme: "system" | "light" | "dark";
}

export interface AppSnapshot {
  dependencies: DependencyState;
  devices: AndroidDevice[];
  diagnostics: DiagnosticCheck[];
  tunnel: TunnelState;
  settings: AppSettings;
  logs: LogEntry[];
  version: string;
}

export interface StartTunnelRequest {
  serial: string;
  dnsServers: string;
  routes: string;
  port: number;
  autoReconnect: boolean;
}

export interface RevBridgeApi {
  getSnapshot(): Promise<AppSnapshot>;
  refreshDevices(): Promise<AppSnapshot>;
  runDiagnostics(): Promise<AppSnapshot>;
  startTunnel(request: StartTunnelRequest): Promise<AppSnapshot>;
  stopTunnel(): Promise<AppSnapshot>;
  saveSettings(settings: Partial<AppSettings>): Promise<AppSnapshot>;
  exportLogs(): Promise<string | null>;
  openExternal(url: string): Promise<void>;
  onSnapshot(callback: (snapshot: AppSnapshot) => void): () => void;
}
