import type {
  AndroidDevice,
  AppSettings,
  AppSnapshot,
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
  appVersion: $("#app-version"),
  usbStatus: $("#usb-status"),
  connectionPanel: $("#connection-panel"),
  connectionBadge: $("#connection-badge"),
  deviceTitle: $("#device-title"),
  deviceSubtitle: $("#device-subtitle"),
  phoneEndpointLabel: $("#phone-endpoint-label"),
  phonePrompt: $("#phone-prompt"),
  devicePicker: $("#device-picker"),
  deviceSelect: $("#device-select") as HTMLSelectElement,
  connectButton: $("#connect-button") as HTMLButtonElement,
  connectButtonLabel: $("#connect-button-label"),
  setupCard: $("#setup-card"),
  refreshButton: $("#refresh-button") as HTMLButtonElement,
  diagnosticsList: $("#diagnostics-list"),
  dnsInput: $("#dns-input") as HTMLInputElement,
  routesInput: $("#routes-input") as HTMLInputElement,
  portInput: $("#port-input") as HTMLInputElement,
  reconnectInput: $("#reconnect-input") as HTMLInputElement,
  exportLogsButton: $("#export-logs-button") as HTMLButtonElement,
  logOutput: $("#log-output"),
};

let snapshot: AppSnapshot | undefined;
let settingsTimer: number | undefined;
let refreshInFlight = false;

function selectedDevice(state: AppSnapshot): AndroidDevice | undefined {
  const serial = ui.deviceSelect.value || state.settings.selectedSerial;
  return state.devices.find((device) => device.serial === serial) ?? state.devices[0];
}

function renderDeviceOptions(state: AppSnapshot): void {
  const previous = ui.deviceSelect.value;
  ui.deviceSelect.replaceChildren();

  for (const device of state.devices) {
    const suffix = device.androidVersion ? ` · Android ${device.androidVersion}` : "";
    ui.deviceSelect.add(new Option(`${device.model ?? "Android phone"}${suffix}`, device.serial));
  }

  const preferred =
    state.devices.find((device) => device.serial === previous)?.serial ??
    state.devices.find((device) => device.serial === state.settings.selectedSerial)?.serial ??
    state.devices[0]?.serial ??
    "";
  ui.deviceSelect.value = preferred;
  ui.devicePicker.hidden = state.devices.length < 2;
}

function setHeaderStatus(
  kind: "searching" | "ready" | "working" | "connected" | "error",
  label: string,
): void {
  ui.usbStatus.className = `status-chip status-chip--${kind}`;
  ui.usbStatus.replaceChildren();
  const dot = document.createElement("span");
  dot.className = "status-dot";
  ui.usbStatus.append(dot, document.createTextNode(label));
}

function setConnectionState(className: string): void {
  ui.connectionPanel.className = `connection-panel ${className}`;
}

function renderConnection(state: AppSnapshot): void {
  const device = selectedDevice(state);
  const model = device?.model ?? "Android phone";
  const version = device?.androidVersion ? `Android ${device.androidVersion}` : "Connected by USB";
  const assetsReady = state.dependencies.relay.available && state.dependencies.client.available;
  const { phase, message } = state.tunnel;

  ui.phoneEndpointLabel.textContent = device ? model : "Android phone";
  ui.setupCard.hidden = Boolean(device) && phase !== "error";
  ui.connectButton.classList.remove("is-loading", "is-disconnect");
  ui.phonePrompt.textContent =
    "No root required. The first connection may ask for USB debugging and VPN permission on the phone.";

  if (phase === "starting") {
    setConnectionState("state-starting");
    setHeaderStatus("working", "Connecting");
    ui.connectionBadge.textContent = "Securing USB connection";
    ui.deviceTitle.textContent = `Connecting to ${model}`;
    ui.deviceSubtitle.textContent = message;
    ui.connectButtonLabel.textContent = "Connecting…";
    ui.connectButton.classList.add("is-loading");
    ui.connectButton.disabled = true;
    return;
  }

  if (phase === "waiting-permission") {
    setConnectionState("state-waiting-permission");
    setHeaderStatus("working", "Waiting for phone");
    ui.connectionBadge.textContent = "One last step";
    ui.deviceTitle.textContent = "Finish on your phone";
    ui.deviceSubtitle.textContent = message;
    ui.connectButtonLabel.textContent = "Disconnect";
    ui.connectButton.classList.add("is-disconnect");
    ui.connectButton.disabled = false;
    ui.phonePrompt.textContent = "Accept Android’s VPN connection prompt. RevBridge will continue automatically.";
    return;
  }

  if (phase === "connected") {
    setConnectionState("state-connected");
    setHeaderStatus("connected", "Connected");
    ui.connectionBadge.textContent = "Internet sharing is active";
    ui.deviceTitle.textContent = `${model} is connected`;
    ui.deviceSubtitle.textContent = message;
    ui.connectButtonLabel.textContent = "Disconnect";
    ui.connectButton.classList.add("is-disconnect");
    ui.connectButton.disabled = false;
    ui.phonePrompt.textContent = "Keep the USB cable connected. All traffic stays between this phone and computer.";
    return;
  }

  if (phase === "stopping") {
    setConnectionState("state-starting");
    setHeaderStatus("working", "Disconnecting");
    ui.connectionBadge.textContent = "Closing connection";
    ui.deviceTitle.textContent = `Disconnecting ${model}`;
    ui.deviceSubtitle.textContent = message;
    ui.connectButtonLabel.textContent = "Disconnecting…";
    ui.connectButton.classList.add("is-loading");
    ui.connectButton.disabled = true;
    return;
  }

  if (phase === "error") {
    setConnectionState("state-error");
    setHeaderStatus("error", "Needs attention");
    ui.connectionBadge.textContent = "Connection needs attention";
    ui.deviceTitle.textContent = device ? `Couldn’t connect ${model}` : "Phone not available";
    ui.deviceSubtitle.textContent = message;
    ui.connectButtonLabel.textContent = device ? "Try again" : "Connect";
    ui.connectButton.disabled = !device || !assetsReady;
    return;
  }

  if (device) {
    setConnectionState("state-ready");
    setHeaderStatus("ready", "Phone detected");
    ui.connectionBadge.textContent = "Ready to connect";
    ui.deviceTitle.textContent = model;
    ui.deviceSubtitle.textContent = `${version} · Click Connect to share this computer’s internet.`;
    ui.connectButtonLabel.textContent = "Connect";
    ui.connectButton.disabled = !assetsReady;
  } else {
    setConnectionState("state-waiting");
    setHeaderStatus("searching", "Looking for phone");
    ui.connectionBadge.textContent = "Waiting for USB";
    ui.deviceTitle.textContent = "Connect your Android phone";
    ui.deviceSubtitle.textContent =
      "Use a USB data cable. RevBridge will recognize the phone automatically.";
    ui.connectButtonLabel.textContent = "Connect";
    ui.connectButton.disabled = true;
  }
}

function renderDiagnostics(state: AppSnapshot): void {
  ui.diagnosticsList.replaceChildren();
  const fragment = document.createDocumentFragment();

  for (const check of state.diagnostics) {
    const item = document.createElement("article");
    item.className = "diagnostic-item";
    item.dataset.level = check.level;

    const marker = document.createElement("span");
    marker.className = "diagnostic-marker";

    const copy = document.createElement("div");
    copy.className = "diagnostic-copy";
    const title = document.createElement("strong");
    title.textContent = check.title;
    const detail = document.createElement("small");
    detail.textContent = check.detail;
    copy.append(title, detail);
    item.append(marker, copy);

    if (check.actionLabel && check.actionUrl) {
      item.tabIndex = 0;
      item.title = check.actionLabel;
      item.addEventListener("click", () => void window.revbridge.openExternal(check.actionUrl!));
    }
    fragment.append(item);
  }

  ui.diagnosticsList.append(fragment);
}

function renderSettings(settings: AppSettings): void {
  if (document.activeElement !== ui.dnsInput) ui.dnsInput.value = settings.dnsServers;
  if (document.activeElement !== ui.routesInput) ui.routesInput.value = settings.routes;
  if (document.activeElement !== ui.portInput) ui.portInput.value = String(settings.port);
  ui.reconnectInput.checked = settings.autoReconnect;
}

function renderLogs(state: AppSnapshot): void {
  const stickToBottom =
    ui.logOutput.scrollHeight - ui.logOutput.scrollTop - ui.logOutput.clientHeight < 50;
  ui.logOutput.replaceChildren();

  if (state.logs.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty-log";
    empty.textContent = "Connection events will appear here.";
    ui.logOutput.append(empty);
    return;
  }

  const fragment = document.createDocumentFragment();
  for (const entry of state.logs.slice(-140)) {
    const line = document.createElement("p");
    line.className = "log-line";
    line.dataset.level = entry.level;
    const time = new Date(entry.timestamp).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    line.textContent = `${time}  [${entry.source}]  ${entry.message}`;
    fragment.append(line);
  }
  ui.logOutput.append(fragment);
  if (stickToBottom) ui.logOutput.scrollTop = ui.logOutput.scrollHeight;
}

function render(state: AppSnapshot): void {
  snapshot = state;
  ui.appVersion.textContent = `v${state.version}`;
  renderDeviceOptions(state);
  renderConnection(state);
  renderDiagnostics(state);
  renderSettings(state.settings);
  renderLogs(state);
}

function settingsFromUi(): Partial<AppSettings> {
  const port = Number.parseInt(ui.portInput.value, 10);
  return {
    selectedSerial: ui.deviceSelect.value || undefined,
    dnsServers: ui.dnsInput.value.trim(),
    routes: ui.routesInput.value.trim(),
    port: Number.isNaN(port) ? 31416 : port,
    autoReconnect: ui.reconnectInput.checked,
  };
}

function scheduleSettingsSave(): void {
  if (settingsTimer) window.clearTimeout(settingsTimer);
  settingsTimer = window.setTimeout(async () => {
    render(await window.revbridge.saveSettings(settingsFromUi()));
  }, 300);
}

async function refreshDevices(): Promise<void> {
  if (refreshInFlight) return;
  refreshInFlight = true;
  ui.refreshButton.disabled = true;
  try {
    render(await window.revbridge.refreshDevices());
  } finally {
    refreshInFlight = false;
    ui.refreshButton.disabled = false;
  }
}

ui.deviceSelect.addEventListener("change", () => {
  if (snapshot) renderConnection(snapshot);
  scheduleSettingsSave();
});

for (const input of [ui.dnsInput, ui.routesInput, ui.portInput, ui.reconnectInput]) {
  input.addEventListener("change", scheduleSettingsSave);
  input.addEventListener("input", scheduleSettingsSave);
}

ui.connectButton.addEventListener("click", async () => {
  if (!snapshot) return;
  const phase = snapshot.tunnel.phase;
  const active = phase === "waiting-permission" || phase === "connected";
  let actionError: string | undefined;
  ui.connectButton.disabled = true;

  try {
    if (active) {
      render(await window.revbridge.stopTunnel());
      return;
    }

    const device = selectedDevice(snapshot);
    if (!device) return;
    const settings = settingsFromUi();
    render(
      await window.revbridge.startTunnel({
        serial: device.serial,
        dnsServers: settings.dnsServers!,
        routes: settings.routes!,
        port: settings.port!,
        autoReconnect: settings.autoReconnect!,
      }),
    );
  } catch (error) {
    actionError =
      error instanceof Error ? error.message : "RevBridge could not complete that action.";
  } finally {
    if (snapshot) {
      renderConnection(snapshot);
      if (actionError) ui.deviceSubtitle.textContent = actionError;
    }
  }
});

ui.refreshButton.addEventListener("click", () => void refreshDevices());
ui.exportLogsButton.addEventListener("click", () => void window.revbridge.exportLogs());

window.revbridge.onSnapshot(render);
void window.revbridge.getSnapshot().then(render);

window.setInterval(() => {
  if (
    !document.hidden &&
    snapshot &&
    (snapshot.tunnel.phase === "idle" || snapshot.tunnel.phase === "error")
  ) {
    void refreshDevices();
  }
}, 2_000);

window.addEventListener("keydown", (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "r") {
    event.preventDefault();
    void refreshDevices();
  }
});
