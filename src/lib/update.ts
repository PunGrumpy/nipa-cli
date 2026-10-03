import pc from "picocolors";
import { z } from "zod";

import { debug, request } from "./http";
import { readCache, writeCache } from "./store";

const RELEASES = "https://github.com/PunGrumpy/nipa-cli/releases";
const LATEST_API =
  "https://api.github.com/repos/PunGrumpy/nipa-cli/releases/latest";
const CHECK_EVERY_MS = 24 * 60 * 60 * 1000;

const CacheSchema = z.object({
  checkedAt: z.iso.datetime(),
  latest: z.string(),
});

type Cache = z.infer<typeof CacheSchema>;

const CACHE_FILE = "update.json";

const ReleaseSchema = z.object({ tag_name: z.string() });

const parts = (version: string): number[] =>
  version.replace(/^v/u, "").split("-")[0]?.split(".").map(Number) ?? [];

export const isNewer = (latest: string, current: string): boolean => {
  const a = parts(latest);
  const b = parts(current);
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff !== 0) {
      return diff > 0;
    }
  }
  return false;
};

export const shouldCheck = (input: {
  version: string;
  env: NodeJS.ProcessEnv;
  isTTY: boolean;
}): boolean =>
  input.isTTY &&
  input.version !== "0.0.0" &&
  !input.env.CI &&
  !input.env.NIPA_NO_UPDATE_CHECK;

const fetchLatest = async (): Promise<string | undefined> => {
  try {
    const res = await request(LATEST_API, {
      signal: AbortSignal.timeout(1500),
    });
    const parsed = ReleaseSchema.safeParse(await res.json());
    return parsed.success ? parsed.data.tag_name.replace(/^v/u, "") : undefined;
  } catch (error) {
    debug(
      `update check failed: ${error instanceof Error ? error.message : String(error)}`
    );
    return undefined;
  }
};

export const updateNotice = (latest: string, current: string): string => {
  const notes = `${RELEASES}/tag/v${latest}`;
  const from = pc.dim(`v${current}`);
  const to = pc.green(`v${latest}`);
  const lines = [
    `Update available! ${from} ≫ ${to}`,
    `Release notes: ${pc.cyan(notes)}`,
  ];
  // Width without color codes, so the box lines up.
  const plain = [
    `Update available! v${current} ≫ v${latest}`,
    `Release notes: ${RELEASES}/tag/v${latest}`,
  ];
  const width = Math.max(...plain.map((line) => line.length));
  const row = (line: string, plainLine: string) =>
    `  │  ${line}${" ".repeat(width - plainLine.length)}  │`;
  return [
    "",
    `  ╭${"─".repeat(width + 4)}╮`,
    ...lines.map((line, index) => row(line, plain[index] ?? line)),
    `  ╰${"─".repeat(width + 4)}╯`,
    "",
  ].join("\n");
};

// Prints the answer from the last check and refreshes it for the next run, so
// no command waits on GitHub.
export const checkForUpdate = async (version: string): Promise<void> => {
  if (
    !shouldCheck({
      env: process.env,
      isTTY: process.stderr.isTTY === true,
      version,
    })
  ) {
    return;
  }
  const cache = await readCache(CACHE_FILE, CacheSchema);
  if (cache && isNewer(cache.latest, version)) {
    console.error(updateNotice(cache.latest, version));
  }
  if (cache && Date.now() - Date.parse(cache.checkedAt) < CHECK_EVERY_MS) {
    return;
  }
  const latest = await fetchLatest();
  if (latest) {
    const next: Cache = { checkedAt: new Date().toISOString(), latest };
    await writeCache(CACHE_FILE, next);
  }
};
