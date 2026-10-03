import { constants } from "node:os";

import { childEnv, findCommand, sessionEnv } from "../lib/env";
import { DEFAULT_PROFILE } from "../lib/store";
import { bold, CliError, dim, log } from "../lib/ui";
import { requireSession } from "./login";
import type { Globals } from "./login";

const INSTALL_HINTS = new Map([
  ["openstack", "Install it with `pipx install python-openstackclient`."],
  ["terraform", "Install it with `brew install hashicorp/tap/terraform`."],
]);

export const exec = async (input: {
  args: string[];
  globals: Globals;
}): Promise<number> => {
  const [command, ...rest] = input.args;
  if (!command) {
    throw new CliError("missing command", {
      exitCode: 2,
      hint: "Usage: nipa exec <command> [args...]",
    });
  }
  const bin = findCommand(command);
  if (!bin) {
    throw new CliError(`command not found: ${command}`, {
      exitCode: 127,
      hint: INSTALL_HINTS.get(command),
    });
  }
  const { active, session } = await requireSession(input.globals);
  if (active.name !== DEFAULT_PROFILE) {
    const host = dim(`(${new URL(active.profile.authUrl).host})`);
    log(`Using profile ${bold(active.name)} ${host}`);
  }

  const child = Bun.spawn([bin, ...rest], {
    env: childEnv(
      process.env,
      sessionEnv({ profile: active.profile, session })
    ),
    stdio: ["inherit", "inherit", "inherit"],
  });
  // The terminal already sends Ctrl-C to the child. Handling SIGINT here keeps
  // nipa alive until the child exits, so terraform can finish cleanly.
  let interrupted = false;
  const onInterrupt = () => {
    interrupted = true;
  };
  const onTerminate = () => child.kill("SIGTERM");
  process.on("SIGINT", onInterrupt);
  process.on("SIGTERM", onTerminate);
  const code = await child.exited;
  process.off("SIGINT", onInterrupt);
  process.off("SIGTERM", onTerminate);

  if (child.signalCode) {
    return 128 + constants.signals[child.signalCode];
  }
  return interrupted && code === 0 ? 128 + constants.signals.SIGINT : code;
};
