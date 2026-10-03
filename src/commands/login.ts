import { parseArgs } from "node:util";

import {
  continueWithTotp,
  KeystoneError,
  listProjects,
  loginWithPassword,
  rescope,
} from "../lib/keystone";
import type { Account, Project, Token } from "../lib/keystone";
import {
  DEFAULT_PROFILE,
  isActive,
  loadConfig,
  loadSession,
  saveConfig,
  saveSession,
} from "../lib/store";
import type { Config, Profile, Session } from "../lib/store";
import {
  askChoice,
  askSecret,
  askText,
  bold,
  canPrompt,
  CliError,
  dim,
  log,
  success,
  withSpinner,
} from "../lib/ui";

export interface Globals {
  profile?: string;
}

interface ActiveProfile {
  config: Config;
  name: string;
  profile: Profile;
}

export const activeProfile = async (
  globals: Globals
): Promise<ActiveProfile> => {
  const config = await loadConfig();
  const name =
    globals.profile ?? process.env.NIPA_PROFILE ?? config.currentProfile;
  const profile = config.profiles[name];
  if (!profile) {
    const known = Object.keys(config.profiles).join(", ");
    throw new CliError(`no profile named "${name}"`, {
      hint: `Your profiles: ${known}. Add one with \`nipa profile add ${name}\`.`,
    });
  }
  return { config, name, profile };
};

export const loginCommand = (profile: string): string =>
  profile === DEFAULT_PROFILE ? "nipa login" : `nipa login -P ${profile}`;

export interface LoginPrompts {
  email: (previous?: string) => Promise<string>;
  password: () => Promise<string>;
  otp: (attempt: number) => Promise<string>;
  project: (projects: readonly Project[]) => Promise<Project>;
}

const OTP_PATTERN = /^\d{6}$/u;
const PROJECT_ID_PATTERN = /^[\da-f]{32}$/u;
const OTP_ATTEMPTS = 3;

const terminalPrompts: LoginPrompts = {
  email: (previous) =>
    askText({
      default: previous,
      message: "Email",
      validate: (value) =>
        value.includes("@") || "Enter the email you log in to the portal with",
    }),
  otp: (attempt) =>
    askText({
      message: attempt === 1 ? "OTP code" : "Next OTP code",
      validate: (value) =>
        OTP_PATTERN.test(value) ||
        "Enter the 6-digit code from your authenticator app",
    }),
  password: () => askSecret("Password"),
  project: (projects) =>
    askChoice({
      choices: projects.map((p) => ({
        description: p.id,
        name: p.name,
        value: p,
      })),
      message: "Which project?",
    }),
};

export const pickProject = (input: {
  projects: readonly Project[];
  wanted?: string;
  ask: LoginPrompts["project"];
}): Promise<Project> => {
  const { projects, wanted } = input;
  if (wanted) {
    const match = projects.find((p) => p.id === wanted || p.name === wanted);
    if (!match) {
      throw new CliError(`no project named or with ID "${wanted}"`, {
        hint: `Your projects: ${projects.map((p) => p.name).join(", ")}`,
      });
    }
    return Promise.resolve(match);
  }
  const [first, ...rest] = projects;
  if (!first) {
    throw new CliError("your account has no projects you can use");
  }
  return rest.length === 0 ? Promise.resolve(first) : input.ask(projects);
};

export const toSession = (token: Token, project: Project): Session => ({
  expiresAt: token.expiresAt,
  project: token.project ?? project,
  token: token.value,
  user: token.user,
});

const verifyOtp = async (input: {
  account: Account;
  receipt: string;
  ask: LoginPrompts["otp"];
}): Promise<Token> => {
  // Each attempt waits for the person's next code.
  /* oxlint-disable no-await-in-loop */
  for (let attempt = 1; ; attempt += 1) {
    const passcode = await input.ask(attempt);
    try {
      return await withSpinner("Checking the code…", () =>
        continueWithTotp({
          account: input.account,
          passcode,
          receipt: input.receipt,
        })
      );
    } catch (error) {
      const wrongCode = error instanceof KeystoneError && error.status === 401;
      if (!wrongCode || attempt === OTP_ATTEMPTS) {
        throw error;
      }
      log(
        "That code didn't work. Each code works once, so wait for the next one."
      );
    }
  }
  /* oxlint-enable no-await-in-loop */
};

export const authenticate = async (input: {
  profile: Profile;
  prompts: LoginPrompts;
  username?: string;
  wantedProject?: string;
}): Promise<Session> => {
  const { profile, prompts, wantedProject } = input;
  const username = input.username ?? (await prompts.email(profile.username));
  const password = await prompts.password();

  // With a known project ID, the login scopes the token in the same request.
  const known = wantedProject ?? profile.project?.id;
  const account: Account = {
    authUrl: profile.authUrl,
    projectId: known && PROJECT_ID_PATTERN.test(known) ? known : undefined,
    userDomain: profile.userDomain,
    username,
  };

  const first = await withSpinner("Checking your password…", () =>
    loginWithPassword(account, password)
  );
  const token =
    first.kind === "token"
      ? first.token
      : await verifyOtp({ account, ask: prompts.otp, receipt: first.receipt });
  if (token.project) {
    return toSession(token, token.project);
  }

  const projects = await withSpinner("Loading your projects…", () =>
    listProjects({ authUrl: profile.authUrl, token: token.value })
  );
  const project = await pickProject({
    ask: prompts.project,
    projects,
    wanted: known,
  });
  const scoped = await withSpinner(`Switching to ${project.name}…`, () =>
    rescope({
      authUrl: profile.authUrl,
      projectId: project.id,
      token: token.value,
    })
  );
  return toSession(scoped, project);
};

export const saveLogin = async (input: {
  active: ActiveProfile;
  session: Session;
}): Promise<void> => {
  const { active, session } = input;
  const profile = {
    ...active.profile,
    project: session.project,
    username: session.user.name,
  };
  await saveConfig({
    ...active.config,
    profiles: { ...active.config.profiles, [active.name]: profile },
  });
  await saveSession({ profile: active.name, session });
};

const interactiveLogin = async (input: {
  active: ActiveProfile;
  username?: string;
  wantedProject?: string;
}): Promise<Session> => {
  const { active } = input;
  if (!canPrompt()) {
    throw new CliError(
      "`nipa login` needs a terminal to ask for your password",
      {
        hint: "Run it in a terminal, then run this command again.",
      }
    );
  }
  const host = dim(`(${new URL(active.profile.authUrl).host})`);
  log(`Logging in to ${bold(active.name)} ${host}`);
  const session = await authenticate({
    ...input,
    profile: active.profile,
    prompts: terminalPrompts,
  });
  await saveLogin({ active, session });
  const who = bold(session.user.name);
  success(`Logged in as ${who}, project ${bold(session.project.name)}`);
  return session;
};

/** Logs in first when the session expired and nipa can prompt. */
export const requireSession = async (
  globals: Globals
): Promise<{ active: ActiveProfile; session: Session }> => {
  const active = await activeProfile(globals);
  const session = await loadSession(active.name);
  if (isActive(session)) {
    return { active, session };
  }
  const hint = `Run \`${loginCommand(active.name)}\`.`;
  if (!canPrompt()) {
    throw session
      ? new CliError(`your ${active.name} session expired`, { hint })
      : new CliError(`you aren't logged in to ${active.name}`, { hint });
  }
  log(session ? "Your session expired." : "You aren't logged in yet.");
  return { active, session: await interactiveLogin({ active }) };
};

export const login = async (input: {
  args: string[];
  globals: Globals;
}): Promise<number> => {
  const { values } = parseArgs({
    args: input.args,
    options: {
      project: { short: "p", type: "string" },
      username: { short: "u", type: "string" },
    },
  });
  await interactiveLogin({
    active: await activeProfile(input.globals),
    username: values.username,
    wantedProject: values.project,
  });
  return 0;
};
