import { existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

import type { Profile, Session } from "./store";

// pipx installs openstack in ~/.local/bin, which isn't always on PATH.
export const findCommand = (command: string): string | undefined => {
  const found = Bun.which(command);
  if (found) {
    return found;
  }
  const local = path.join(homedir(), ".local", "bin", command);
  return existsSync(local) ? local : undefined;
};

export const sessionEnv = (input: { profile: Profile; session: Session }) => ({
  OS_AUTH_TYPE: "v3token",
  OS_AUTH_URL: input.profile.authUrl,
  OS_IDENTITY_API_VERSION: "3",
  OS_INTERFACE: "public",
  OS_PROJECT_DOMAIN_ID: input.session.project.domainId ?? "",
  OS_PROJECT_ID: input.session.project.id,
  OS_PROJECT_NAME: input.session.project.name,
  OS_REGION_NAME: input.profile.region,
  OS_TOKEN: input.session.token,
});

type SessionEnv = ReturnType<typeof sessionEnv>;

// A stale OS_PASSWORD or OS_CLOUD from an old openrc would win over the token.
export const childEnv = (
  parent: NodeJS.ProcessEnv,
  session: SessionEnv
): NodeJS.ProcessEnv => ({
  ...Object.fromEntries(
    Object.entries(parent).filter(([key]) => !key.startsWith("OS_"))
  ),
  ...session,
});

export const SHELLS = ["bash", "zsh", "fish"] as const;

export type Shell = (typeof SHELLS)[number];

export const isShell = (value: string): value is Shell =>
  SHELLS.some((shell) => shell === value);

const quote = (value: string, shell: Shell): string => {
  const escaped =
    shell === "fish"
      ? value.replaceAll("\\", "\\\\").replaceAll("'", "\\'")
      : value.replaceAll("'", "'\\''");
  return `'${escaped}'`;
};

export const formatEnv = (vars: SessionEnv, shell: Shell): string =>
  Object.entries(vars)
    .map(([key, value]) =>
      shell === "fish"
        ? `set -gx ${key} ${quote(value, shell)}`
        : `export ${key}=${quote(value, shell)}`
    )
    .join("\n");

export const detectShell = (shellPath?: string): Shell => {
  const name = shellPath?.split("/").at(-1) ?? "";
  return isShell(name) ? name : "bash";
};
