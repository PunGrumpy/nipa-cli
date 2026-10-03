import { stat } from "node:fs/promises";

import { z } from "zod";

import { findCommand } from "./env";
import { readCache, writeCache } from "./store";

const CACHE_FILE = "openstack.json";
const GENERATE_TIMEOUT_MS = 20_000;

const TableSchema = z.record(z.string(), z.array(z.string()));

type Table = z.infer<typeof TableSchema>;

const CacheSchema = z.object({
  bin: z.string(),
  mtimeMs: z.number(),
  table: TableSchema,
});

// `openstack complete --shell none` prints `cmds='server ...'` for the top
// level and `cmds_server_list='-h --help ...'` below it.
const TABLE_LINE = /^\s*cmds(?:_(?<key>\S+))?='(?<words>[^']*)'$/u;

const parseTable = (text: string): Table =>
  Object.fromEntries(
    text.split("\n").flatMap((line): [string, string[]][] => {
      const groups = TABLE_LINE.exec(line)?.groups;
      if (!groups) {
        return [];
      }
      const words = groups.words?.split(" ").filter(Boolean) ?? [];
      return [[groups.key ?? "", words]];
    })
  );

// Walks the table the way the bash script from `openstack complete` does, and
// offers a command's options only once the word being typed starts with "-".
const candidates = (table: Table, words: readonly string[]): string[] => {
  const typed = words.at(-1) ?? "";
  let key = "";
  for (const word of words.slice(0, -1)) {
    const next = (key ? `${key}_${word}` : word).replaceAll("-", "_");
    if (word.startsWith("-") || !Object.hasOwn(table, next)) {
      break;
    }
    key = next;
  }
  const values = table[key] ?? [];
  if (typed.startsWith("-")) {
    return values.filter((value) => value.startsWith(typed));
  }
  // A command with subcommands, such as `server resize`, lists them after its
  // options. Its parent also lists `resize_confirm`, which isn't a command.
  return values.filter(
    (value) =>
      value.startsWith(typed) && !value.startsWith("-") && !value.includes("_")
  );
};

// Generating the table starts Python and loads every plugin, which takes
// seconds, so nipa keeps it until the openstack executable changes.
const loadTable = async (bin: string): Promise<Table | undefined> => {
  const { mtimeMs } = await stat(bin);
  const cached = await readCache(CACHE_FILE, CacheSchema);
  if (cached?.bin === bin && cached.mtimeMs === mtimeMs) {
    return cached.table;
  }
  const proc = Bun.spawn([bin, "complete", "--shell", "none"], {
    stderr: "ignore",
    stdin: "ignore",
    stdout: "pipe",
    timeout: GENERATE_TIMEOUT_MS,
  });
  const [text, code] = await Promise.all([
    new Response(proc.stdout).text(),
    proc.exited,
  ]);
  if (code !== 0) {
    return undefined;
  }
  const table = parseTable(text);
  await writeCache(CACHE_FILE, { bin, mtimeMs, table });
  return table;
};

/** Candidates for the last word, which is the one being typed. */
export const openstackCompletions = async (
  words: readonly string[]
): Promise<string[]> => {
  const bin = findCommand("openstack");
  if (!bin) {
    return [];
  }
  const table = await loadTable(bin);
  return table ? candidates(table, words) : [];
};
