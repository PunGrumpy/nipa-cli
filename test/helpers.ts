import { chmod, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  ALPHA_ID,
  FAKE_PASSCODE,
  FAKE_PASSWORD,
  FAKE_USER,
} from "./fake-keystone";

export const ENTRY = path.join(import.meta.dir, "..", "src", "index.ts");

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** stdin is closed, so nipa can't prompt. */
export const runProcess = async (
  cmd: string[],
  env: Record<string, string>
): Promise<RunResult> => {
  const proc = Bun.spawn(cmd, {
    env,
    stderr: "pipe",
    stdin: "ignore",
    stdout: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { code, stderr, stdout };
};

export const testEnv = (dir: string) => ({
  HOME: dir,
  NIPA_CONFIG_DIR: dir,
  NO_COLOR: "1",
  PATH: `${path.join(dir, "bin")}:${process.env.PATH ?? ""}`,
});

export const installNipaShim = async (dir: string): Promise<void> => {
  const bin = path.join(dir, "bin");
  await mkdir(bin, { recursive: true });
  const shim = path.join(bin, "nipa");
  await writeFile(shim, `#!/bin/sh\nexec bun "${ENTRY}" "$@"\n`);
  await chmod(shim, 0o755);
};

const issueToken = async (keystoneUrl: string): Promise<string> => {
  const res = await fetch(`${keystoneUrl}/v3/auth/tokens`, {
    body: JSON.stringify({
      auth: {
        identity: {
          methods: ["password", "totp"],
          password: { user: { name: FAKE_USER.name, password: FAKE_PASSWORD } },
          totp: { user: { name: FAKE_USER.name, passcode: FAKE_PASSCODE } },
        },
        scope: { project: { id: ALPHA_ID } },
      },
    }),
    method: "POST",
  });
  return res.headers.get("X-Subject-Token") ?? "";
};

const alpha = { domainId: "d1", id: ALPHA_ID, name: "Alpha" };

export const seedSession = async (
  dir: string,
  keystoneUrl: string
): Promise<void> => {
  const token = await issueToken(keystoneUrl);
  const prod = {
    authUrl: keystoneUrl,
    project: alpha,
    region: "NCP-TH",
    userDomain: "nipacloud",
    username: FAKE_USER.name,
  };
  await writeFile(
    path.join(dir, "config.json"),
    JSON.stringify({ currentProfile: "prod", profiles: { prod } })
  );
  const session = {
    expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    project: alpha,
    token,
    user: FAKE_USER,
  };
  await writeFile(
    path.join(dir, "auth.json"),
    JSON.stringify({ sessions: { prod: session } })
  );
};

export const seedLegacySession = async (
  dir: string,
  keystoneUrl: string
): Promise<void> => {
  const token = await issueToken(keystoneUrl);
  await writeFile(
    path.join(dir, "config.json"),
    JSON.stringify({
      authUrl: keystoneUrl,
      project: alpha,
      username: FAKE_USER.name,
    })
  );
  await writeFile(
    path.join(dir, "auth.json"),
    JSON.stringify({
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      project: alpha,
      token,
      user: FAKE_USER,
    })
  );
};
