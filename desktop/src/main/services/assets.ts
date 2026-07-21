import { constants as fsConstants } from "node:fs";
import { access } from "node:fs/promises";
import path from "node:path";

export interface AppAssets {
  directory: string;
  relayPath: string;
  clientApkPath: string;
}

export function locateAssets(
  isPackaged: boolean,
  resourcesPath: string,
  appPath: string,
): AppAssets {
  const directory = isPackaged
    ? path.join(resourcesPath, "assets")
    : path.join(appPath, "resources", "staged");
  const relayName = process.platform === "win32" ? "revbridge-relay.exe" : "revbridge-relay";

  return {
    directory,
    relayPath: process.env.REVBRIDGE_RELAY ?? path.join(directory, relayName),
    clientApkPath:
      process.env.REVBRIDGE_APK ?? path.join(directory, "revbridge-client.apk"),
  };
}

export async function fileExists(filePath: string, executable = false): Promise<boolean> {
  try {
    await access(
      filePath,
      executable && process.platform !== "win32" ? fsConstants.X_OK : fsConstants.F_OK,
    );
    return true;
  } catch {
    return false;
  }
}
