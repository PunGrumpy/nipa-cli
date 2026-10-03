import pc from "picocolors";

import { formatElapsed } from "./ui";

export const isDebug = (): boolean => process.env.NIPA_DEBUG === "1";

export const debug = (message: string): void => {
  if (isDebug()) {
    console.error(pc.dim(`> [debug] [${new Date().toISOString()}] ${message}`));
  }
};

export class NetworkError extends Error {
  readonly url: string;

  constructor(url: string, cause: string) {
    super(`can't reach ${new URL(url).host}: ${cause}`);
    this.name = "NetworkError";
    this.url = url;
  }
}

// Never log headers or bodies. They hold tokens and passwords.
export const request = async (
  url: string,
  init: RequestInit = {}
): Promise<Response> => {
  const method = init.method ?? "GET";
  const started = performance.now();
  debug(`${method} ${url}`);
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (error) {
    throw new NetworkError(
      url,
      error instanceof Error ? error.message : String(error)
    );
  }
  debug(
    `${res.status} ${method} ${url} [${formatElapsed(performance.now() - started)}]`
  );
  return res;
};
