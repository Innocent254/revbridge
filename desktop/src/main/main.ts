import { writeFile } from "node:fs/promises";
import path from "node:path";
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  nativeTheme,
  shell,
} from "electron";
import type { AppSettings, StartTunnelRequest } from "../shared/types";
import { AppController } from "./controller";
import { AdbService } from "./services/adb";
import { locateAssets } from "./services/assets";
import { RelayService } from "./services/relay";
import { SettingsStore } from "./services/settings-store";

let mainWindow: BrowserWindow | undefined;
let controller: AppController | undefined;
let shuttingDown = false;

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 920,
    height: 780,
    minWidth: 720,
    minHeight: 600,
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#0a0f1c" : "#f4f7fb",
    title: "RevBridge",
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      devTools: !app.isPackaged,
    },
  });

  window.removeMenu();
  void window.loadFile(path.join(__dirname, "../renderer/index.html"));
  window.once("ready-to-show", () => window.show());
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://")) {
      void shell.openExternal(url);
    }
    return { action: "deny" };
  });
  return window;
}

function registerIpc(appController: AppController): void {
  ipcMain.handle("revbridge:get-snapshot", () => appController.getSnapshot());
  ipcMain.handle("revbridge:refresh-devices", () => appController.refreshDevices());
  ipcMain.handle("revbridge:run-diagnostics", () => appController.runDiagnostics());
  ipcMain.handle(
    "revbridge:start-tunnel",
    (_event, request: StartTunnelRequest) => appController.startTunnel(request),
  );
  ipcMain.handle("revbridge:stop-tunnel", () => appController.stopTunnel());
  ipcMain.handle(
    "revbridge:save-settings",
    (_event, settings: Partial<AppSettings>) => appController.saveSettings(settings),
  );
  ipcMain.handle("revbridge:export-logs", async () => {
    const result = await dialog.showSaveDialog(mainWindow!, {
      title: "Export RevBridge logs",
      defaultPath: `revbridge-logs-${new Date().toISOString().slice(0, 10)}.txt`,
      filters: [{ name: "Text log", extensions: ["txt"] }],
    });
    if (result.canceled || !result.filePath) {
      return null;
    }
    await writeFile(result.filePath, `${appController.getLogText()}\n`, "utf8");
    return result.filePath;
  });
  ipcMain.handle("revbridge:open-external", async (_event, url: string) => {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") {
      throw new Error("Only HTTPS links are allowed.");
    }
    await shell.openExternal(parsed.toString());
  });
}

app.whenReady().then(async () => {
  const assets = locateAssets(app.isPackaged, process.resourcesPath, app.getAppPath());
  const settingsStore = new SettingsStore(path.join(app.getPath("userData"), "settings.json"));
  const adb = new AdbService(path.join(app.getPath("userData"), "adb-key.pk8"));
  controller = new AppController(
    assets,
    settingsStore,
    adb,
    new RelayService(),
    app.getVersion(),
  );
  registerIpc(controller);
  mainWindow = createWindow();
  controller.on("snapshot", (snapshot) => {
    if (!mainWindow?.isDestroyed()) {
      mainWindow?.webContents.send("revbridge:snapshot", snapshot);
    }
  });
  await controller.initialize();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createWindow();
    }
  });
});

app.on("before-quit", (event) => {
  if (shuttingDown || !controller) {
    return;
  }
  event.preventDefault();
  shuttingDown = true;
  void controller.shutdown().finally(() => app.quit());
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
