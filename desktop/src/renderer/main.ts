import type {
  AndroidDevice,
  AppSettings,
  AppSnapshot,
  CheckLevel,
  RevBridgeApi,
} from "../shared/types";
import "./styles.css";

declare global {
  interface Window {
    revbridge: RevBridgeApi;
  }
}

const $ = <T extends HTMLElement>(selector: string): T => {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing UI element: ${selector}`);
  return element;
};

const ui = {
  pageTitle: $("#page-title"),
  appVersion: $("#app-version"),
  adbStatus: $("#adb-status-pill"),
  refreshButton: $("#refresh-button") as HTMLButtonElement,
  deviceSelect: $("#device-select") as HTMLSelectElement,
  connectButton: $("#connect-button") as HTMLButtonElement,
  connectButtonLabel: $("#connect-button-label"),
  tunnelKicker: $("#tunnel-kicker"),
  tunnelTitle: $("#tunnel-title"),
  tunnelMessage: $("#tunnel-message"),
  deviceMeta: $("#selected-device-meta"),
  deviceModel: $("#device-model"),
  deviceAndroid: $("#device-android"),
  deviceSerial: $("#device-serial"),
  readinessScore: $("#readiness-score"),
  readyAdb: $("#ready-adb"),
  readyDevice: $("#ready-device"),
  readyAuthorized: $("#ready-authorized"),
  diagnosticCount: $("#diagnostic-count"),
  dnsInput: $("#dns-input") as HTMLInputElement,
  routesInput: $("#routes-input") as HTMLInputElement,
  portInput: $("#port-input") as HTMLInputElement,
  reconnectInput: $("#reconnect-input") as HTMLInputElement,
  logOutput: $("#log-output"),
  liveIndicator: $("#log-live-indicator"),
  exportLogsButton: $("#export-logs-button") as HTMLButtonElement,
  helpExportButton: $("#help-export-button") as HTMLButtonElement,
  diagnosticList: $("#diagnostic-list"),
  runDiagnosticsButton: $("#run-diagnostics-button") as HTMLButtonElement,
  chooseAdbButton: $("#choose-adb-button") as HTMLButtonElement,
  toast: $("#toast"),
};

let snapshot: AppSnapshot | undefined;
let activePage = "dashboard";
let settingsTimer: number | undefined;
let toastTimer: number | undefined;

function setBusy(button: HTMLButtonElement, busy: boolean): void {
  button.disabled = busy;
  button.classList.toggle("is-busy", busy);
}

function showToast(message: string): void {
  ui.toast.textContent = message;
  ui.toast.classList.add("is-visible");
  if (toastTimer) window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => ui.toast.classList.remove("is-visible"), 3_500);
}

function switchPage(page: string): void {
  activePage = page;
  document.querySelectorAll<HTMLElement>("[data-page-panel]").forEach((panel) => {
    panel.classList.toggle("is-active", panel.dataset.pagePanel === page);
  });
  document.querySelectorAll<HTMLButtonElement>("[data-page]").forEach((item) => {
    const selected = item.dataset.page === page;
    item.classList.toggle("is-active", selected);
    if (selected) item.setAttribute("aria-current", "page");
    else item.removeAttribute("aria-current");
  });
  const titles: Record<string, string> = {
    dashboard: "Dashboard",
    diagnostics: "Diagnostics",
    about: "About RevBridge",
  };
  ui.pageTitle.textContent = titles[page] ?? "RevBridge";
  if (page === "diagnostics") void runDiagnostics();
}

function selectedDevice(state: AppSnapshot): AndroidDevice | undefined {
  const serial = ui.deviceSelect.value || state.settings.selectedSerial;
  return state.devices.find((device) => device.serial === serial);
}

function renderAdb(state: AppSnapshot): void {
  const ready = state.dependencies.adb.available;
  ui.adbStatus.className = `status-pill ${ready ? "status-pill--good" : "status-pill--bad"}`;
  ui.adbStatus.innerHTML = "";
  const dot = document.createElement("span");
  dot.className = "status-dot";
  const label = document.createTextNode(ready ? `ADB ${state.dependencies.adb.version ?? "ready"}` : "ADB missing");
  ui.adbStatus.append(dot, label);
}

function renderDevices(state: AppSnapshot): void {
  const previous = ui.deviceSelect.value;
  ui.deviceSelect.replaceChildren();
  if (state.devices.length === 0) {
    const option = new Option("No Android device detected", "");
    option.disabled = true;
    option.selected = true;
    ui.deviceSelect.add(option);
  } else {
    for (const device of state.devices) {
      const status = device.state === "device" ? "" : ` — ${device.state}`;
      const option = new Option(`${device.model ?? device.serial}${status}`, device.serial);
      option.disabled = device.state !== "device";
      ui.deviceSelect.add(option);
    }
    const preferred =
      state.devices.find((device) => device.serial === previous && device.state === "device")?.serial ??
      state.devices.find(
        (device) => device.serial === state.settings.selectedSerial && device.state === "device",
      )?.serial ??
      state.devices.find((device) => device.state === "device")?.serial ??
      "";
    ui.deviceSelect.value = preferred;
  }
  renderSelectedDevice(state);
}

function renderSelectedDevice(state: AppSnapshot): void {
  const device = selectedDevice(state);
  if (!device) {
    ui.deviceMeta.hidden = true;
    return;
  }
  ui.deviceMeta.hidden = false;
  ui.deviceModel.textContent = device.model ?? "Android device";
  ui.deviceAndroid.textContent = device.androidVersion
    ? `Android ${device.androidVersion}`
    : "Android version unknown";
  ui.deviceSerial.textContent = device.serial;
}

function setReadiness(element: HTMLElement, ready: boolean, warning = false): void {
  element.classList.toggle("is-ready", ready);
  element.classList.toggle("is-warning", warning && !ready);
}

function renderReadiness(state: AppSnapshot): void {
  const adbReady = state.dependencies.adb.available;
  const hasDevice = state.devices.length > 0;
  const hasAuthorized = state.devices.some((device) => device.state === "device");
  setReadiness(ui.readyAdb, adbReady);
  setReadiness(ui.readyDevice, hasDevice);
  setReadiness(
    ui.readyAuthorized,
    hasAuthorized,
    state.devices.some((device) => device.state === "unauthorized"),
  );
  const score = [adbReady, hasDevice, hasAuthorized].filter(Boolean).length;
  ui.readinessScore.textContent = `${score}/3`;
  ui.readinessScore.classList.toggle("is-complete", score === 3);
}

function renderTunnel(state: AppSnapshot): void {
  const { phase, message } = state.tunnel;
  const isActive = ["starting", "waiting-permission", "connected", "stopping"].includes(phase);
  const isConnected = phase === "connected";
  const isBusy = phase === "starting" || phase === "stopping";
  const device = selectedDevice(state);
  document.body.dataset.tunnel = phase;

  const content = {
    idle: ["Not connected", "Share this computer’s internet"],
    starting: ["Starting", "Preparing a secure local bridge"],
    "waiting-permission": ["Waiting for phone", "Complete setup on Android"],
    connected: ["Connected", `${device?.model ?? "Android"} is online`],
    stopping: ["Stopping", "Closing the local bridge"],
    error: ["Needs attention", "The connection could not start"],
  }[phase];

  ui.tunnelKicker.textContent = content[0];
  ui.tunnelTitle.textContent = content[1];
  ui.tunnelMessage.textContent = message;
  ui.connectButton.classList.toggle("primary-button--danger", isActive);
  ui.connectButtonLabel.textContent = isActive ? (phase === "stopping" ? "Stopping…" : "Disconnect") : "Connect";
  ui.connectButton.disabled = isBusy || (!isActive && (!device || device.state !== "device"));
  ui.liveIndicator.classList.toggle("is-live", isConnected);
  ui.liveIndicator.innerHTML = "";
  const liveDot = document.createElement("span");
  ui.liveIndicator.append(liveDot, document.createTextNode(isConnected ? "Live" : phase === "idle" ? "Idle" : "Active"));
}

function renderSettings(settings: AppSettings): void {
  if (document.activeElement !== ui.dnsInput) ui.dnsInput.value = settings.dnsServers;
  if (document.activeElement !== ui.routesInput) ui.routesInput.value = settings.routes;
  if (document.activeElement !== ui.portInput) ui.portInput.value = String(settings.port);
  ui.reconnectInput.checked = settings.autoReconnect;
  document.documentElement.dataset.theme = settings.theme;
}

function iconForLevel(level: CheckLevel): string {
  if (level === "pass") return "✓";
  if (level === "warning") return "!";
  if (level === "fail") return "×";
  return "i";
}

function renderDiagnostics(state: AppSnapshot): void {
  ui.diagnosticList.replaceChildren();
  const fragment = document.createDocumentFragment();
  for (const check of state.diagnostics) {
    const card = document.createElement("article");
    card.className = `card diagnostic-card diagnostic-card--${check.level}`;
    const icon = document.createElement("span");
    icon.className = "diagnostic-icon";
    icon.textContent = iconForLevel(check.level);
    const copy = document.createElement("div");
    copy.className = "diagnostic-copy";
    const title = document.createElement("h3");
    title.textContent = check.title;
    const detail = document.createElement("p");
    detail.textContent = check.detail;
    copy.append(title, detail);
    card.append(icon, copy);
    if (check.actionLabel && check.actionUrl) {
      const action = document.createElement("button");
      action.type = "button";
      action.className = "secondary-button secondary-button--small";
      action.textContent = check.actionLabel;
      action.addEventListener("click", () => void window.revbridge.openExternal(check.actionUrl!));
      card.append(action);
    }
    fragment.append(card);
  }
  ui.diagnosticList.append(fragment);
  const problemCount = state.diagnostics.filter((check) => check.level === "fail" || check.level === "warning").length;
  ui.diagnosticCount.hidden = problemCount === 0;
  ui.diagnosticCount.textContent = String(problemCount);
}

function renderLogs(state: AppSnapshot): void {
  const shouldStick =
    ui.logOutput.scrollHeight - ui.logOutput.scrollTop - ui.logOutput.clientHeight < 60;
  ui.logOutput.replaceChildren();
  if (state.logs.length === 0) {
    const empty = document.createElement("div");
    empty.className = "log-empty";
    empty.textContent = "Connection events and errors will appear here.";
    ui.logOutput.append(empty);
    return;
  }
  const fragment = document.createDocumentFragment();
  for (const entry of state.logs.slice(-160)) {
    const row = document.createElement("div");
    row.className = `log-row log-row--${entry.level}`;
    const time = document.createElement("time");
    time.textContent = new Date(entry.timestamp).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    const source = document.createElement("span");
    source.className = "log-source";
    source.textContent = entry.source;
    const message = document.createElement("span");
    message.className = "log-message";
    message.textContent = entry.message;
    row.append(time, source, message);
    fragment.append(row);
  }
  ui.logOutput.append(fragment);
  if (shouldStick) ui.logOutput.scrollTop = ui.logOutput.scrollHeight;
}

function render(state: AppSnapshot): void {
  snapshot = state;
  ui.appVersion.textContent = `v${state.version}`;
  renderAdb(state);
  renderDevices(state);
  renderReadiness(state);
  renderTunnel(state);
  renderSettings(state.settings);
  renderDiagnostics(state);
  renderLogs(state);
}

function scheduleSettingsSave(): void {
  if (settingsTimer) window.clearTimeout(settingsTimer);
  settingsTimer = window.setTimeout(async () => {
    const port = Number.parseInt(ui.portInput.value, 10);
    const state = await window.revbridge.saveSettings({
      selectedSerial: ui.deviceSelect.value || undefined,
      dnsServers: ui.dnsInput.value.trim(),
      routes: ui.routesInput.value.trim(),
      port: Number.isNaN(port) ? 31416 : port,
      autoReconnect: ui.reconnectInput.checked,
    });
    render(state);
  }, 350);
}

async function runDiagnostics(): Promise<void> {
  setBusy(ui.runDiagnosticsButton, true);
  try {
    render(await window.revbridge.runDiagnostics());
  } finally {
    setBusy(ui.runDiagnosticsButton, false);
  }
}

async function exportLogs(): Promise<void> {
  const filePath = await window.revbridge.exportLogs();
  if (filePath) showToast("Diagnostic log exported.");
}

document.querySelectorAll<HTMLButtonElement>("[data-page], [data-go-page]").forEach((button) => {
  button.addEventListener("click", () => switchPage(button.dataset.page ?? button.dataset.goPage ?? "dashboard"));
});

document.querySelectorAll<HTMLButtonElement>("[data-external-url]").forEach((button) => {
  button.addEventListener("click", () => void window.revbridge.openExternal(button.dataset.externalUrl!));
});

ui.deviceSelect.addEventListener("change", () => {
  if (snapshot) {
    renderSelectedDevice(snapshot);
    renderTunnel(snapshot);
  }
  scheduleSettingsSave();
});

for (const input of [ui.dnsInput, ui.routesInput, ui.portInput, ui.reconnectInput]) {
  input.addEventListener("input", scheduleSettingsSave);
  input.addEventListener("change", scheduleSettingsSave);
}

ui.connectButton.addEventListener("click", async () => {
  if (!snapshot) return;
  const active = ["starting", "waiting-permission", "connected", "stopping"].includes(snapshot.tunnel.phase);
  setBusy(ui.connectButton, true);
  try {
    if (active) {
      render(await window.revbridge.stopTunnel());
    } else {
      const port = Number.parseInt(ui.portInput.value, 10);
      render(
        await window.revbridge.startTunnel({
          serial: ui.deviceSelect.value,
          dnsServers: ui.dnsInput.value.trim(),
          routes: ui.routesInput.value.trim(),
          port,
          autoReconnect: ui.reconnectInput.checked,
        }),
      );
    }
  } finally {
    ui.connectButton.classList.remove("is-busy");
  }
});

ui.refreshButton.addEventListener("click", async () => {
  setBusy(ui.refreshButton, true);
  try {
    render(await window.revbridge.refreshDevices());
  } finally {
    setBusy(ui.refreshButton, false);
  }
});

ui.runDiagnosticsButton.addEventListener("click", () => void runDiagnostics());
ui.chooseAdbButton.addEventListener("click", async () => render(await window.revbridge.chooseAdb()));
ui.exportLogsButton.addEventListener("click", () => void exportLogs());
ui.helpExportButton.addEventListener("click", () => void exportLogs());

window.revbridge.onSnapshot(render);
void window.revbridge.getSnapshot().then(render);

window.addEventListener("keydown", (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "r") {
    event.preventDefault();
    void ui.refreshButton.click();
  }
  if (event.key === "Escape" && activePage !== "dashboard") switchPage("dashboard");
});
