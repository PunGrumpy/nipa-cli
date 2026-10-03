import { parseArgs } from "node:util";

import {
  completionScript,
  COMPLETION_SHELLS,
  isCompletionShell,
} from "../lib/completion";
import { listProjects } from "../lib/keystone";
import { openstackCompletions } from "../lib/openstack";
import type { CommandSpec } from "../lib/spec";
import { isActive, loadSession } from "../lib/store";
import { CliError } from "../lib/ui";
import { activeProfile } from "./login";
import type { Globals } from "./login";
import { profileNames } from "./profile";

export const completion = (input: {
  args: string[];
  specs: readonly CommandSpec[];
}): Promise<number> => {
  const [shell] = input.args;
  if (shell === undefined || !isCompletionShell(shell)) {
    throw new CliError(shell ? `unknown shell "${shell}"` : "missing shell", {
      exitCode: 2,
      hint: `Use one of: ${COMPLETION_SHELLS.join(", ")}.`,
    });
  }
  process.stdout.write(completionScript(shell, input.specs));
  return Promise.resolve(0);
};

const projectNames = async (globals: Globals): Promise<string[]> => {
  const active = await activeProfile(globals);
  const session = await loadSession(active.name);
  if (!isActive(session)) {
    return [];
  }
  const projects = await listProjects({
    authUrl: active.profile.authUrl,
    token: session.token,
  });
  return projects.map((p) => p.name);
};

/** Never prompts, so a Tab press can't hang. */
export const complete = async (input: {
  args: string[];
  globals: Globals;
}): Promise<number> => {
  const [kind, ...rest] = input.args;
  let values: string[];
  switch (kind) {
    case "projects": {
      values = await projectNames(input.globals);
      break;
    }
    case "profiles": {
      values = await profileNames();
      break;
    }
    case "openstack": {
      const { positionals } = parseArgs({
        allowPositionals: true,
        args: rest,
        options: {},
      });
      values = await openstackCompletions(positionals);
      break;
    }
    default: {
      return 2;
    }
  }
  process.stdout.write(values.map((value) => `${value}\n`).join(""));
  return 0;
};
