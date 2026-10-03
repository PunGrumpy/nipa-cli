import { parseArgs } from "node:util";

import { probe, revoke } from "../lib/keystone";
import {
  clearSession,
  DEFAULT_PROFILE,
  isActive,
  loadConfig,
  loadSession,
  PROD_PROFILE,
  PROFILE_NAME,
  ProfileSchema,
  saveConfig,
} from "../lib/store";
import type { Config, Profile } from "../lib/store";
import {
  askChoice,
  askConfirm,
  askText,
  bold,
  canPrompt,
  CliError,
  columns,
  dim,
  green,
  log,
  note,
  success,
  withSpinner,
} from "../lib/ui";

interface CommandInput {
  args: string[];
}

const usageError = (message: string, hint: string) =>
  new CliError(message, { exitCode: 2, hint });

const host = (profile: Profile): string => new URL(profile.authUrl).host;

const list = async ({ args }: CommandInput): Promise<number> => {
  const { values } = parseArgs({
    args,
    options: { json: { type: "boolean" } },
  });
  const config = await loadConfig();
  const names = Object.keys(config.profiles).toSorted();
  const sessions = await Promise.all(names.map((name) => loadSession(name)));

  if (values.json) {
    const out = names.map((name, index) => {
      const session = sessions[index];
      return {
        current: name === config.currentProfile,
        loggedIn: isActive(session),
        name,
        ...config.profiles[name],
        user: isActive(session) ? session.user.name : undefined,
      };
    });
    console.log(JSON.stringify(out, null, 2));
    return 0;
  }

  const rows = names.map((name, index) => {
    const profile = config.profiles[name] ?? PROD_PROFILE;
    const session = sessions[index];
    const who = isActive(session)
      ? `${session.user.name} (${session.project.name})`
      : "-";
    return [name, host(profile), profile.region, who];
  });
  const [header, ...body] = columns([
    ["name", "keystone", "region", "logged in as"],
    ...rows,
  ]);
  log(`${names.length} ${names.length === 1 ? "profile" : "profiles"}`);
  const heading = `  ${header?.join("  ") ?? ""}`;
  console.error(dim(heading.trimEnd()));
  for (const [index, row] of body.entries()) {
    const current = names[index] === config.currentProfile;
    const line = `${current ? green("✔") : " "} ${row.join("  ")}`;
    console.error(line.trimEnd());
  }
  return 0;
};

const validateName =
  (config: Config) =>
  (name: string): string | true => {
    if (!PROFILE_NAME.test(name)) {
      return "Use lowercase letters, digits and hyphens, starting with a letter";
    }
    return config.profiles[name]
      ? `A profile named ${name} already exists`
      : true;
  };

const validateUrl = (value: string): string | true =>
  ProfileSchema.shape.authUrl.safeParse(value).success ||
  "Enter an http or https URL, such as https://keystone.example.com/v3";

const valueOrAsk = (input: {
  value: string | undefined;
  flag: string;
  ask: () => Promise<string>;
}): Promise<string> => {
  if (input.value !== undefined) {
    return Promise.resolve(input.value);
  }
  if (!canPrompt()) {
    throw usageError(
      `missing ${input.flag}`,
      "Pass every value as a flag when there is no terminal."
    );
  }
  return input.ask();
};

const add = async ({ args }: CommandInput): Promise<number> => {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    args,
    options: {
      "auth-url": { type: "string" },
      region: { type: "string" },
      use: { type: "boolean" },
      "user-domain": { type: "string" },
    },
  });
  const config = await loadConfig();
  const checkName = validateName(config);

  const name = await valueOrAsk({
    ask: () => askText({ message: "Profile name", validate: checkName }),
    flag: "<name>",
    value: positionals[0],
  });
  const nameProblem = checkName(name);
  if (nameProblem !== true) {
    throw usageError(`can't add profile "${name}"`, nameProblem);
  }
  const authUrl = await valueOrAsk({
    ask: () => askText({ message: "Keystone URL", validate: validateUrl }),
    flag: "--auth-url",
    value: values["auth-url"],
  });
  const urlProblem = validateUrl(authUrl);
  if (urlProblem !== true) {
    throw usageError(`invalid --auth-url "${authUrl}"`, urlProblem);
  }
  const interactive = canPrompt();
  const userDomain =
    values["user-domain"] ??
    (interactive
      ? await askText({
          default: PROD_PROFILE.userDomain,
          message: "User domain",
        })
      : PROD_PROFILE.userDomain);
  const region =
    values.region ??
    (interactive
      ? await askText({ default: PROD_PROFILE.region, message: "Region" })
      : PROD_PROFILE.region);

  const started = performance.now();
  const version = await withSpinner(`Checking ${authUrl}…`, () =>
    probe(authUrl)
  );
  const profile: Profile = { authUrl, region, userDomain };
  const use =
    values.use ??
    (interactive &&
      (await askConfirm({ default: true, message: `Use ${name} now?` })));
  await saveConfig({
    currentProfile: use ? name : config.currentProfile,
    profiles: { ...config.profiles, [name]: profile },
  });
  success(
    `Added profile ${bold(name)} (Keystone ${version})`,
    performance.now() - started
  );
  if (use) {
    log(`Now using ${bold(name)}. Run \`nipa login\` to log in to it.`);
  } else {
    log(`Run \`nipa login -P ${name}\` to log in to it.`);
  }
  return 0;
};

const use = async ({ args }: CommandInput): Promise<number> => {
  const { positionals } = parseArgs({
    allowPositionals: true,
    args,
    options: {},
  });
  const config = await loadConfig();
  const names = Object.keys(config.profiles).toSorted();
  let [name] = positionals;
  if (name === undefined) {
    if (!canPrompt()) {
      throw usageError("missing <name>", `Your profiles: ${names.join(", ")}`);
    }
    name = await askChoice({
      choices: names.map((n) => ({
        name: n === config.currentProfile ? `${n} ${bold("(current)")}` : n,
        value: n,
      })),
      default: config.currentProfile,
      message: "Use profile:",
    });
  }
  if (!config.profiles[name]) {
    throw new CliError(`no profile named "${name}"`, {
      hint: `Your profiles: ${names.join(", ")}`,
    });
  }
  if (name === config.currentProfile) {
    note(`You're already using ${bold(name)}`);
    return 0;
  }
  await saveConfig({ ...config, currentProfile: name });
  success(`Now using profile ${bold(name)}`);
  return 0;
};

const remove = async ({ args }: CommandInput): Promise<number> => {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    args,
    options: { yes: { short: "y", type: "boolean" } },
  });
  const [name] = positionals;
  if (name === undefined) {
    throw usageError("missing <name>", "Run `nipa profile rm <name>`.");
  }
  const config = await loadConfig();
  const profile = config.profiles[name];
  if (!profile) {
    throw new CliError(`no profile named "${name}"`);
  }
  if (name === DEFAULT_PROFILE) {
    throw new CliError(`can't remove ${DEFAULT_PROFILE}`, {
      hint: "nipa always has the Nipa Cloud production profile.",
    });
  }
  if (!values.yes) {
    if (!canPrompt()) {
      throw usageError(
        `removing ${name} needs confirmation`,
        "Add --yes to remove it without asking."
      );
    }
    const sure = await askConfirm({
      default: false,
      message: `Remove profile ${name} and log out of it?`,
    });
    if (!sure) {
      throw new CliError("Canceled", { exitCode: 130 });
    }
  }
  const session = await loadSession(name);
  if (isActive(session)) {
    try {
      await revoke({ authUrl: profile.authUrl, token: session.token });
    } catch {
      // The token expires on its own.
    }
  }
  await clearSession(name);
  const profiles = Object.fromEntries(
    Object.entries(config.profiles).filter(([key]) => key !== name)
  );
  const wasCurrent = config.currentProfile === name;
  await saveConfig({
    currentProfile: wasCurrent ? DEFAULT_PROFILE : config.currentProfile,
    profiles,
  });
  success(`Removed profile ${bold(name)}`);
  if (wasCurrent) {
    log(`Now using ${bold(DEFAULT_PROFILE)}`);
  }
  return 0;
};

const SUBCOMMANDS = new Map([
  ["add", add],
  ["ls", list],
  ["rm", remove],
  ["use", use],
]);

export const profile = async ({ args }: CommandInput): Promise<number> => {
  const [subcommand = "ls", ...rest] = args;
  const run = SUBCOMMANDS.get(subcommand);
  if (!run) {
    throw usageError(
      `unknown subcommand "profile ${subcommand}"`,
      "Use ls, add, use or rm."
    );
  }
  return await run({ args: rest });
};

export const profileNames = async (): Promise<string[]> => {
  const config = await loadConfig();
  return Object.keys(config.profiles).toSorted();
};
