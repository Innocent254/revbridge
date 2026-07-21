import { execFile, type ExecFileOptions } from "node:child_process";

export interface CommandResult {
  command: string;
  args: string[];
  stdout: string;
  stderr: string;
  exitCode: number;
}

export class CommandError extends Error {
  public readonly result: CommandResult;

  constructor(message: string, result: CommandResult) {
    super(message);
    this.name = "CommandError";
    this.result = result;
  }
}

export interface RunCommandOptions {
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
}

export class CommandRunner {
  async run(
    command: string,
    args: string[] = [],
    options: RunCommandOptions = {},
  ): Promise<CommandResult> {
    const execOptions: ExecFileOptions = {
      encoding: "utf8",
      timeout: options.timeoutMs ?? 15_000,
      maxBuffer: 4 * 1024 * 1024,
      windowsHide: true,
      env: options.env ?? process.env,
    };

    return await new Promise<CommandResult>((resolve, reject) => {
      execFile(command, args, execOptions, (error, stdout, stderr) => {
        const result: CommandResult = {
          command,
          args,
          stdout: String(stdout ?? ""),
          stderr: String(stderr ?? ""),
          exitCode:
            typeof (error as NodeJS.ErrnoException | null)?.code === "number"
              ? Number((error as NodeJS.ErrnoException).code)
              : error
                ? 1
                : 0,
        };

        if (error) {
          reject(
            new CommandError(
              result.stderr.trim() || error.message || `Command failed: ${command}`,
              result,
            ),
          );
          return;
        }

        resolve(result);
      });
    });
  }
}
