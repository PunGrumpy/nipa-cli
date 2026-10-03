import { parseArgs } from "node:util";

import {
  detectShell,
  formatEnv,
  isShell,
  sessionEnv,
  SHELLS,
} from "../lib/env";
import { listProjects, rescope, revoke } from "../lib/keystone";
import type { Project } from "../lib/keystone";
import {
  clearSession,
  isActive,
  loadSession,
  msUntilExpiry,
} from "../lib/store";
import {
  askChoice,
  bold,
  canPrompt,
  CliError,
  dim,
  formatDuration,
  log,
  note,
  success,
  withSpinner,
} from "../lib/ui";
import {
  activeProfile,
  loginCommand,
  pickProject,
  requireSession,
  saveLogin,
  toSession,
} from "./login";
import type { Globals } from "./login";

interface CommandInput {
  args: string[];
  globals: Globals;
}

export const whoami = async ({
  args,
  globals,
}: CommandInput): Promise<number> => {
  const { values } = parseArgs({
    args,
    options: { json: { type: "boolean" } },
  });
  const active = await activeProfile(globals);
  const session = await loadSession(active.name);
  if (!isActive(session)) {
    if (values.json) {
      console.log(JSON.stringify({ loggedIn: false, profile: active.name }));
    }
    throw new CliError(`you aren't logged in to ${active.name}`, {
      hint: `Run \`${loginCommand(active.name)}\`.`,
    });
  }
  if (values.json) {
    const out = {
      authUrl: active.profile.authUrl,
      expiresAt: session.expiresAt,
      loggedIn: true,
      profile: active.name,
      project: session.project,
      region: active.profile.region,
      user: session.user,
    };
    console.log(JSON.stringify(out, null, 2));
    return 0;
  }
  if (!process.stdout.isTTY) {
    console.log(session.user.name);
    return 0;
  }
  const { host } = new URL(active.profile.authUrl);
  const expiresIn = formatDuration(msUntilExpiry(session));
  log(`Logged in as ${bold(session.user.name)}`);
  const where = dim(`(${host}, ${active.profile.region})`);
  const projectId = dim(`(${session.project.id})`);
  log(`Profile: ${bold(active.name)} ${where}`);
  log(`Project: ${bold(session.project.name)} ${projectId}`);
  log(`The session expires in ${expiresIn}`);
  return 0;
};

const askProject = (current: Project) => (projects: readonly Project[]) =>
  askChoice({
    choices: projects.map((p) => ({
      description: p.id,
      name: p.id === current.id ? `${p.name} ${bold("(current)")}` : p.name,
      value: p,
    })),
    default: projects.find((p) => p.id === current.id),
    message: "Switch to:",
  });

export const switchProject = async ({
  args,
  globals,
}: CommandInput): Promise<number> => {
  const { positionals } = parseArgs({
    allowPositionals: true,
    args,
    options: {},
  });
  const [wanted] = positionals;
  const { active, session } = await requireSession(globals);
  const { authUrl } = active.profile;
  const projects = await withSpinner("Loading your projects…", () =>
    listProjects({ authUrl, token: session.token })
  );
  if (wanted === undefined && !canPrompt()) {
    throw new CliError("tell nipa which project to use", {
      exitCode: 2,
      hint: `Run \`nipa switch <project>\`. Your projects: ${projects.map((p) => p.name).join(", ")}`,
    });
  }
  const project = await pickProject({
    ask: askProject(session.project),
    projects,
    wanted,
  });
  if (project.id === session.project.id) {
    note(`You're already using ${bold(project.name)}`);
    return 0;
  }
  const started = performance.now();
  const token = await withSpinner(`Switching to ${project.name}…`, () =>
    rescope({ authUrl, projectId: project.id, token: session.token })
  );
  await saveLogin({ active, session: toSession(token, project) });
  success(`Switched to ${bold(project.name)}`, performance.now() - started);
  return 0;
};

export const logout = async ({ globals }: CommandInput): Promise<number> => {
  const active = await activeProfile(globals);
  const session = await loadSession(active.name);
  if (!session) {
    note(`Not logged in to ${active.name}, so \`nipa logout\` did nothing`);
    return 0;
  }
  if (isActive(session)) {
    try {
      await withSpinner("Logging out…", () =>
        revoke({ authUrl: active.profile.authUrl, token: session.token })
      );
    } catch {
      // The token expires on its own.
    }
  }
  await clearSession(active.name);
  success(`Logged out of ${bold(active.name)}`);
  return 0;
};

export const env = async ({ args, globals }: CommandInput): Promise<number> => {
  const { values } = parseArgs({
    args,
    options: { shell: { type: "string" } },
  });
  const shell = values.shell ?? detectShell(process.env.SHELL);
  if (!isShell(shell)) {
    throw new CliError(`unknown shell "${shell}"`, {
      exitCode: 2,
      hint: `Use one of: ${SHELLS.join(", ")}.`,
    });
  }
  const { active, session } = await requireSession(globals);
  console.log(
    formatEnv(sessionEnv({ profile: active.profile, session }), shell)
  );
  return 0;
};
