import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

import { z } from "zod";

import { ProjectSchema } from "./keystone";

export const DEFAULT_PROFILE = "prod";

export const PROD_PROFILE = {
  authUrl: "https://identity-api.nipa.cloud/v3",
  region: "NCP-TH",
  userDomain: "nipacloud",
} as const;

export const ProfileSchema = z.object({
  authUrl: z.url({ protocol: /^https?$/u }),
  project: ProjectSchema.optional(),
  region: z.string().min(1),
  userDomain: z.string().min(1),
  username: z.string().optional(),
});

export type Profile = z.infer<typeof ProfileSchema>;

export const PROFILE_NAME = /^[a-z][\da-z-]{0,31}$/u;

const ProfilesSchema = z.record(z.string().regex(PROFILE_NAME), ProfileSchema);

type Profiles = z.infer<typeof ProfilesSchema>;

const withProd = (profiles: Profiles): Profiles => ({
  [DEFAULT_PROFILE]: PROD_PROFILE,
  ...profiles,
});

const ConfigSchema = z
  .object({
    currentProfile: z.string().default(DEFAULT_PROFILE),
    profiles: ProfilesSchema.default({}),
  })
  .strict()
  .transform((config) => ({ ...config, profiles: withProd(config.profiles) }));

export type Config = z.infer<typeof ConfigSchema>;

// nipa 0.1 files hold one profile or one session at the top level. They load
// as prod, and the next save writes them in the new format.
const LegacyConfigSchema = ProfileSchema.extend({
  authUrl: ProfileSchema.shape.authUrl.default(PROD_PROFILE.authUrl),
  region: ProfileSchema.shape.region.default(PROD_PROFILE.region),
  userDomain: ProfileSchema.shape.userDomain.default(PROD_PROFILE.userDomain),
}).transform((profile): Config => ({
  currentProfile: DEFAULT_PROFILE,
  profiles: withProd({ [DEFAULT_PROFILE]: profile }),
}));

const ConfigFileSchema = z.union([ConfigSchema, LegacyConfigSchema]);

const SessionSchema = z.object({
  expiresAt: z.iso.datetime({ offset: true }),
  project: ProjectSchema,
  token: z.string().min(1),
  user: z.object({ id: z.string(), name: z.string() }),
});

export type Session = z.infer<typeof SessionSchema>;

const SessionsSchema = z.record(z.string(), SessionSchema);

type Sessions = z.infer<typeof SessionsSchema>;

const AuthFileSchema = z.union([
  z
    .object({ sessions: SessionsSchema })
    .strict()
    .transform((file) => file.sessions),
  SessionSchema.transform((session): Sessions => ({
    [DEFAULT_PROFILE]: session,
  })),
]);

export class StoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StoreError";
  }
}

/** Tokens this close to expiry count as expired, so a command doesn't fail halfway. */
const EXPIRY_MARGIN_MS = 60_000;

const configDir = (env: NodeJS.ProcessEnv = process.env): string =>
  env.NIPA_CONFIG_DIR ??
  path.join(env.XDG_CONFIG_HOME ?? path.join(homedir(), ".config"), "nipa");

const configPath = () => path.join(configDir(), "config.json");
const authPath = () => path.join(configDir(), "auth.json");

const cachePath = (name: string, env: NodeJS.ProcessEnv = process.env) =>
  path.join(env.XDG_CACHE_HOME ?? path.join(homedir(), ".cache"), "nipa", name);

export const readCache = async <T>(
  name: string,
  schema: z.ZodType<T>
): Promise<T | undefined> => {
  try {
    const text = await readFile(cachePath(name), "utf-8");
    const parsed = schema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
};

export const writeCache = async (
  name: string,
  value: z.core.util.JSONType
): Promise<void> => {
  await mkdir(path.dirname(cachePath(name)), { recursive: true });
  await writeFile(cachePath(name), `${JSON.stringify(value)}\n`);
};

const readText = async (file: string): Promise<string | undefined> => {
  try {
    return await readFile(file, "utf-8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
};

const readJson = async <T>(
  file: string,
  schema: z.ZodType<T>
): Promise<T | undefined> => {
  const text = await readText(file);
  if (text === undefined) {
    return undefined;
  }
  let json: z.core.util.JSONType;
  try {
    json = JSON.parse(text);
  } catch {
    throw new StoreError(`${file} isn't valid JSON`);
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    throw new StoreError(`${file}: ${z.prettifyError(parsed.error)}`);
  }
  return parsed.data;
};

const writeJson = async (
  file: string,
  value: Config | { sessions: Sessions }
): Promise<void> => {
  await mkdir(configDir(), { mode: 0o700, recursive: true });
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  // mode only applies when the file is created
  await chmod(file, 0o600);
};

export const loadConfig = async (): Promise<Config> =>
  (await readJson(configPath(), ConfigFileSchema)) ?? {
    currentProfile: DEFAULT_PROFILE,
    profiles: withProd({}),
  };

export const saveConfig = (config: Config): Promise<void> =>
  writeJson(configPath(), config);

const loadSessions = async (): Promise<Sessions> =>
  (await readJson(authPath(), AuthFileSchema)) ?? {};

export const loadSession = async (
  profile: string
): Promise<Session | undefined> => {
  const sessions = await loadSessions();
  return sessions[profile];
};

export const saveSession = async (input: {
  profile: string;
  session: Session;
}): Promise<void> => {
  const sessions = await loadSessions();
  await writeJson(authPath(), {
    sessions: { ...sessions, [input.profile]: input.session },
  });
};

export const clearSession = async (profile: string): Promise<void> => {
  const sessions = await loadSessions();
  const rest = Object.fromEntries(
    Object.entries(sessions).filter(([key]) => key !== profile)
  );
  if (Object.keys(rest).length === 0) {
    await rm(authPath(), { force: true });
    return;
  }
  await writeJson(authPath(), { sessions: rest });
};

export const msUntilExpiry = (session: Session, now = Date.now()): number =>
  Date.parse(session.expiresAt) - now;

export const isActive = (
  session: Session | undefined,
  now = Date.now()
): session is Session =>
  session !== undefined && msUntilExpiry(session, now) > EXPIRY_MARGIN_MS;
