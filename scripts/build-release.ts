#!/usr/bin/env bun

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const TARGETS = [
  { name: "darwin-arm64", target: "bun-darwin-arm64" },
  { name: "darwin-x64", target: "bun-darwin-x64" },
  { name: "linux-arm64", target: "bun-linux-arm64" },
  { name: "linux-x64", target: "bun-linux-x64" },
  { name: "windows-x64.exe", target: "bun-windows-x64" },
] as const;

const root = path.join(import.meta.dir, "..");
const dist = path.join(root, "dist");
await mkdir(dist, { recursive: true });

// One target at a time, so the build log stays in order.
/* oxlint-disable no-await-in-loop */
const sums: string[] = [];
for (const { name, target } of TARGETS) {
  const file = `nipa-${name}`;
  const outfile = path.join(dist, file);
  const proc = Bun.spawn(
    [
      "bun",
      "build",
      "src/index.ts",
      "--compile",
      "--minify",
      `--target=${target}`,
      `--outfile=${outfile}`,
    ],
    { cwd: root, stderr: "inherit", stdout: "ignore" }
  );
  if ((await proc.exited) !== 0) {
    throw new Error(`build failed for ${target}`);
  }
  const digest = createHash("sha256")
    .update(await readFile(outfile))
    .digest("hex");
  sums.push(`${digest}  ${file}`);
  console.log(`built ${file}`);
}
/* oxlint-enable no-await-in-loop */

await writeFile(path.join(dist, "SHA256SUMS"), `${sums.join("\n")}\n`);
