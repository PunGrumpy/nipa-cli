// Everything except a command's result goes to stderr, so pipes get only data.

import { confirm, input, password, select } from "@inquirer/prompts";
import pc from "picocolors";

export class CliError extends Error {
  readonly hint?: string;
  readonly exitCode: number;

  constructor(
    message: string,
    options: { hint?: string; exitCode?: number } = {}
  ) {
    super(message);
    this.name = "CliError";
    this.hint = options.hint;
    this.exitCode = options.exitCode ?? 1;
  }
}

export const formatElapsed = (ms: number): string =>
  ms < 1000 ? `${Math.round(ms)}ms` : `${Math.round(ms / 1000)}s`;

export const formatDuration = (ms: number): string => {
  const minutes = Math.max(0, Math.floor(ms / 60_000));
  const hours = Math.floor(minutes / 60);
  return hours > 0 ? `${hours}h ${minutes % 60}m` : `${minutes}m`;
};

export const log = (message: string): void => {
  console.error(`${pc.dim(">")} ${message}`);
};

export const success = (message: string, elapsedMs?: number): void => {
  const time = elapsedMs === undefined ? "" : `[${formatElapsed(elapsedMs)}]`;
  const elapsed = time ? ` ${pc.dim(time)}` : "";
  console.error(`${pc.cyan("> Success!")} ${message}${elapsed}`);
};

export const note = (message: string): void => {
  console.error(`${pc.bold(pc.yellow("> NOTE:"))} ${message}`);
};

export const printError = (error: CliError): void => {
  console.error(`${pc.bold(pc.red("Error:"))} ${error.message}`);
  if (error.hint) {
    console.error(`${pc.dim(">")} ${error.hint}`);
  }
};

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const SPINNER_DELAY_MS = 300;
const ERASE_LINE = "\r\u001B[2K";

export const withSpinner = async <T>(
  message: string,
  task: () => Promise<T>
): Promise<T> => {
  if (!process.stderr.isTTY) {
    return task();
  }
  let frame = 0;
  let drawn = false;
  let interval: ReturnType<typeof setInterval> | undefined;
  const draw = () => {
    drawn = true;
    const symbol = FRAMES[frame % FRAMES.length] ?? "";
    frame += 1;
    process.stderr.write(`\r${pc.dim(symbol)} ${message}`);
  };
  const delay = setTimeout(() => {
    draw();
    interval = setInterval(draw, 80);
  }, SPINNER_DELAY_MS);
  try {
    return await task();
  } finally {
    clearTimeout(delay);
    clearInterval(interval);
    if (drawn) {
      process.stderr.write(ERASE_LINE);
    }
  }
};

export const canPrompt = (): boolean =>
  process.stdin.isTTY === true && process.stderr.isTTY === true;

const promptContext = { output: process.stderr };

// inquirer throws ExitPromptError on Ctrl-C.
const prompt = async <T>(ask: () => Promise<T>): Promise<T> => {
  try {
    return await ask();
  } catch (error) {
    if (error instanceof Error && error.name === "ExitPromptError") {
      throw new CliError("Canceled", { exitCode: 130 });
    }
    throw error;
  }
};

interface TextPrompt {
  message: string;
  default?: string;
  validate?: (value: string) => string | true;
}

export const askText = (options: TextPrompt): Promise<string> =>
  prompt(() => input({ ...options, required: true }, promptContext));

export const askSecret = (message: string): Promise<string> =>
  prompt(() => password({ mask: "*", message }, promptContext));

interface Choice<T> {
  name: string;
  value: T;
  description?: string;
}

export const askChoice = <T>(options: {
  message: string;
  choices: readonly Choice<T>[];
  default?: T;
}): Promise<T> => prompt(() => select(options, promptContext));

export const askConfirm = (options: {
  message: string;
  default: boolean;
}): Promise<boolean> => prompt(() => confirm(options, promptContext));

/** Pass plain text. Color codes would count toward the width. */
export const columns = (rows: readonly (readonly string[])[]): string[][] => {
  const widths: number[] = [];
  for (const row of rows) {
    for (const [index, cell] of row.entries()) {
      widths[index] = Math.max(widths[index] ?? 0, cell.length);
    }
  }
  return rows.map((row) =>
    row.map((cell, index) => cell.padEnd(widths[index] ?? 0))
  );
};

export const { bold, cyan, dim, green } = pc;
