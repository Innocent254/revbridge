import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AppSettings } from "../../shared/types";

export const DEFAULT_SETTINGS: AppSettings = {
  dnsServers: "1.1.1.1,8.8.8.8",
  routes: "0.0.0.0/0",
  port: 31416,
  autoReconnect: true,
  theme: "system",
};

export class SettingsStore {
  constructor(private readonly filePath: string) {}

  async load(): Promise<AppSettings> {
    try {
      const raw = await readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as Partial<AppSettings>;
      return { ...DEFAULT_SETTINGS, ...parsed };
    } catch {
      return { ...DEFAULT_SETTINGS };
    }
  }

  async save(settings: AppSettings): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
  }
}
