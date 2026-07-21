import { contextBridge, ipcRenderer } from "electron";
import type {
  AppSettings,
  AppSnapshot,
  RevBridgeApi,
  StartTunnelRequest,
} from "../shared/types";

const api: RevBridgeApi = {
  getSnapshot: () => ipcRenderer.invoke("revbridge:get-snapshot"),
  refreshDevices: () => ipcRenderer.invoke("revbridge:refresh-devices"),
  runDiagnostics: () => ipcRenderer.invoke("revbridge:run-diagnostics"),
  startTunnel: (request: StartTunnelRequest) =>
    ipcRenderer.invoke("revbridge:start-tunnel", request),
  stopTunnel: () => ipcRenderer.invoke("revbridge:stop-tunnel"),
  saveSettings: (settings: Partial<AppSettings>) =>
    ipcRenderer.invoke("revbridge:save-settings", settings),
  exportLogs: () => ipcRenderer.invoke("revbridge:export-logs"),
  openExternal: (url: string) => ipcRenderer.invoke("revbridge:open-external", url),
  onSnapshot: (callback: (snapshot: AppSnapshot) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, snapshot: AppSnapshot) => callback(snapshot);
    ipcRenderer.on("revbridge:snapshot", listener);
    return () => ipcRenderer.removeListener("revbridge:snapshot", listener);
  },
};

contextBridge.exposeInMainWorld("revbridge", api);
