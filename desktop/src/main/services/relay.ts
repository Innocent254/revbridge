import { EventEmitter } from "node:events";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import readline from "node:readline";

export interface RelayLine {
  source: "stdout" | "stderr";
  text: string;
}

export class RelayService extends EventEmitter {
  private child?: ChildProcessWithoutNullStreams;

  isRunning(): boolean {
    return Boolean(this.child && this.child.exitCode === null && !this.child.killed);
  }

  async start(relayPath: string, port: number): Promise<void> {
    if (this.isRunning()) {
      return;
    }

    await new Promise<void>((resolve, reject) => {
      const child = spawn(relayPath, ["relay", "-p", String(port)], {
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
      });
      child.stdin.end();
      this.child = child;
      let settled = false;

      const readyTimeout = setTimeout(() => {
        if (!settled) {
          settled = true;
          reject(new Error("The relay did not become ready within 15 seconds."));
        }
      }, 15_000);

      const attachLines = (source: "stdout" | "stderr") => {
        const input = source === "stdout" ? child.stdout : child.stderr;
        const reader = readline.createInterface({ input });
        reader.on("line", (text) => {
          const line: RelayLine = { source, text };
          this.emit("line", line);
          if (!settled && text.includes("Relay server started")) {
            settled = true;
            clearTimeout(readyTimeout);
            resolve();
          }
        });
      };

      attachLines("stdout");
      attachLines("stderr");

      child.once("error", (error) => {
        this.emit("error", error);
        if (!settled) {
          settled = true;
          clearTimeout(readyTimeout);
          reject(error);
        }
      });

      child.once("exit", (code, signal) => {
        this.child = undefined;
        this.emit("exit", { code, signal });
        if (!settled) {
          settled = true;
          clearTimeout(readyTimeout);
          reject(new Error(`Relay exited before startup (code ${code ?? "unknown"}).`));
        }
      });
    });
  }

  async stop(): Promise<void> {
    const child = this.child;
    if (!child || child.exitCode !== null) {
      this.child = undefined;
      return;
    }

    await new Promise<void>((resolve) => {
      const finish = () => {
        clearTimeout(forceTimeout);
        resolve();
      };
      const forceTimeout = setTimeout(() => {
        if (child.exitCode === null) {
          child.kill("SIGKILL");
        }
        resolve();
      }, 2_500);

      child.once("exit", finish);
      child.kill("SIGTERM");
    });
    this.child = undefined;
  }
}
