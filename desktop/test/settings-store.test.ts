import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, SettingsStore } from "../src/main/services/settings-store";

describe("SettingsStore", () => {
  it("returns safe defaults when no file exists", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "revbridge-settings-"));
    const store = new SettingsStore(path.join(directory, "missing", "settings.json"));
    expect(await store.load()).toEqual(DEFAULT_SETTINGS);
  });

  it("round-trips settings as readable JSON", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "revbridge-settings-"));
    const filePath = path.join(directory, "nested", "settings.json");
    const store = new SettingsStore(filePath);
    const settings = { ...DEFAULT_SETTINGS, port: 32000, theme: "dark" as const };

    await store.save(settings);

    expect(await store.load()).toEqual(settings);
    expect(await readFile(filePath, "utf8")).toContain('"port": 32000');
  });
});
