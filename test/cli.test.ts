import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import pkg from "../package.json" with { type: "json" };
import { FAKE_USER, startFakeKeystone } from "./fake-keystone";
import type { FakeKeystone } from "./fake-keystone";
import {
  ENTRY,
  runProcess,
  seedLegacySession,
  seedSession,
  testEnv,
} from "./helpers";

let dir: string;
let keystone: FakeKeystone;

const run = (args: string[], extraEnv: Record<string, string> = {}) =>
  runProcess(["bun", ENTRY, ...args], { ...testEnv(dir), ...extraEnv });

const exitCode = async (args: string[]): Promise<number> => {
  const { code } = await run(args);
  return code;
};

const readJsonFile = async (name: string) =>
  JSON.parse(await readFile(path.join(dir, name), "utf-8"));

const freshDir = async () => {
  await rm(dir, { force: true, recursive: true });
  dir = await mkdtemp(path.join(tmpdir(), "nipa-test-"));
};

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "nipa-test-"));
  keystone = startFakeKeystone();
});

afterAll(async () => {
  keystone.stop();
  await rm(dir, { force: true, recursive: true });
});

describe("help and usage", () => {
  test("--help groups the commands and lists the global options", async () => {
    const { code, stdout } = await run(["--help"]);
    expect(code).toBe(0);
    for (const text of [
      "Session:",
      "Run tools:",
      "Setup:",
      "Global options:",
      "--profile <name>",
      "profile",
    ]) {
      expect(stdout).toContain(text);
    }
    expect(stdout).not.toContain("__complete");
  });

  test("help for one command, as `help <command>` or `<command> --help`", async () => {
    const a = await run(["help", "login"]);
    const b = await run(["login", "--help"]);
    expect(a.stdout).toContain("Usage: nipa login [options]");
    expect(a.stdout).toContain("--username <email>");
    expect(b.stdout).toBe(a.stdout);
  });

  test("--version", async () => {
    const { stdout } = await run(["--version"]);
    expect(stdout.trim()).toBe(pkg.version);
  });

  test("a mistyped command suggests the closest one", async () => {
    const { code, stderr } = await run(["logn"]);
    expect(code).toBe(2);
    expect(stderr).toContain('unknown command "logn"');
    expect(stderr).toContain("Did you mean `nipa login`?");
  });

  test("bad options exit 2", async () => {
    expect(await exitCode(["--nope"])).toBe(2);
    expect(await exitCode(["whoami", "--nope"])).toBe(2);
    expect(await exitCode(["-P"])).toBe(2);
  });
});

describe("without a session", () => {
  beforeEach(freshDir);

  test("whoami says how to log in", async () => {
    const { code, stderr } = await run(["whoami"]);
    expect(code).toBe(1);
    expect(stderr).toContain("aren't logged in to prod");
    expect(stderr).toContain("nipa login");
  });

  test("whoami --json reports loggedIn false", async () => {
    const { stdout } = await run(["whoami", "--json"]);
    expect(JSON.parse(stdout)).toEqual({ loggedIn: false, profile: "prod" });
  });

  test("exec doesn't prompt without a terminal", async () => {
    const { code, stderr } = await run(["exec", "true"]);
    expect(code).toBe(1);
    expect(stderr).toContain("aren't logged in");
  });

  test("login fails fast without a terminal", async () => {
    const { code, stderr } = await run(["login"]);
    expect(code).toBe(1);
    expect(stderr).toContain("needs a terminal");
  });

  test("logout is a no-op", async () => {
    const { code, stderr } = await run(["logout"]);
    expect(code).toBe(0);
    expect(stderr).toContain("Not logged in to prod");
  });

  test("an unknown profile names the known ones", async () => {
    const { code, stderr } = await run(["-P", "nope", "whoami"]);
    expect(code).toBe(1);
    expect(stderr).toContain('no profile named "nope"');
    expect(stderr).toContain("nipa profile add nope");
  });
});

describe("profiles", () => {
  beforeAll(freshDir);

  test("prod is there from the start and is current", async () => {
    const { stderr } = await run(["profile", "ls"]);
    expect(stderr).toContain("1 profile");
    expect(stderr).toMatch(/✔ prod\s+identity-api\.nipa\.cloud\s+NCP-TH/u);
  });

  test("add checks that the URL is Keystone v3", async () => {
    const { code, stderr } = await run([
      "profile",
      "add",
      "staging",
      "--auth-url",
      keystone.url,
    ]);
    expect(code).toBe(0);
    expect(stderr).toContain("Added profile staging (Keystone v3.14)");
    expect(stderr).toContain("nipa login -P staging");
  });

  test("add refuses a duplicate name, a bad name and a URL that isn't Keystone", async () => {
    expect(
      await exitCode(["profile", "add", "staging", "--auth-url", keystone.url])
    ).toBe(2);
    expect(
      await exitCode(["profile", "add", "Bad_Name", "--auth-url", keystone.url])
    ).toBe(2);
    const notKeystone = await run([
      "profile",
      "add",
      "other",
      "--auth-url",
      `${keystone.url}/nope`,
    ]);
    expect(notKeystone.code).toBe(1);
    expect(notKeystone.stderr).toContain("doesn't answer like Keystone v3");
  });

  test("add without a terminal needs --auth-url", async () => {
    const { code, stderr } = await run(["profile", "add", "dev"]);
    expect(code).toBe(2);
    expect(stderr).toContain("missing --auth-url");
  });

  test("use switches the current profile", async () => {
    const { stderr } = await run(["profile", "use", "staging"]);
    expect(stderr).toContain("Now using profile staging");
    const ls = await run(["profile", "ls", "--json"]);
    const current = JSON.parse(ls.stdout).find(
      (p: { current: boolean }) => p.current
    );
    expect(current.name).toBe("staging");
  });

  test("NIPA_PROFILE and -P override the current profile", async () => {
    const env = await run(["whoami", "--json"], { NIPA_PROFILE: "prod" });
    expect(JSON.parse(env.stdout).profile).toBe("prod");
    const flag = await run(["whoami", "--json", "-P", "prod"]);
    expect(JSON.parse(flag.stdout).profile).toBe("prod");
  });

  test("rm refuses prod, and needs --yes without a terminal", async () => {
    expect(await exitCode(["profile", "rm", "prod", "--yes"])).toBe(1);
    expect(await exitCode(["profile", "rm", "staging"])).toBe(2);
  });

  test("rm --yes removes the profile and goes back to prod", async () => {
    const { code, stderr } = await run(["profile", "rm", "staging", "--yes"]);
    expect(code).toBe(0);
    expect(stderr).toContain("Removed profile staging");
    expect(stderr).toContain("Now using prod");
    const config = await readJsonFile("config.json");
    expect(config.currentProfile).toBe("prod");
  });
});

describe("with a session", () => {
  beforeAll(async () => {
    await freshDir();
    await seedSession(dir, keystone.url);
  });

  test("whoami in a pipe prints only the user", async () => {
    const { code, stdout } = await run(["whoami"]);
    expect(code).toBe(0);
    expect(stdout.trim()).toBe(FAKE_USER.name);
  });

  test("whoami --json", async () => {
    const { stdout } = await run(["whoami", "--json"]);
    expect(JSON.parse(stdout)).toMatchObject({
      loggedIn: true,
      profile: "prod",
      project: { name: "Alpha" },
      user: FAKE_USER,
    });
  });

  test("global options work before and after the command", async () => {
    const before = await run(["-P", "prod", "whoami"]);
    const after = await run(["whoami", "--profile=prod"]);
    expect(before.stdout).toBe(after.stdout);
  });

  test("words after -- go to the command, not to nipa", async () => {
    const { code, stderr } = await run(["switch", "--", "--help"]);
    expect(code).toBe(1);
    expect(stderr).toContain('no project named or with ID "--help"');
  });

  test("env --shell fish", async () => {
    const { stdout } = await run(["env", "--shell", "fish"]);
    expect(stdout).toContain("set -gx OS_PROJECT_NAME 'Alpha'");
    expect(stdout).toContain("set -gx OS_AUTH_TYPE 'v3token'");
  });

  test("exec passes the session and drops stale OS_*", async () => {
    const { code, stdout } = await run(["exec", "env"], {
      OS_PASSWORD: "stale",
    });
    expect(code).toBe(0);
    expect(stdout).toContain("OS_PROJECT_ID=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
    expect(stdout).not.toContain("OS_PASSWORD");
  });

  test("--help after exec goes to the command, not to nipa", async () => {
    // sh's builtin echo, because GNU echo answers --help itself
    const { stdout } = await run([
      "exec",
      "sh",
      "-c",
      'echo "$1"',
      "sh",
      "--help",
    ]);
    expect(stdout.trim()).toBe("--help");
  });

  test("exec returns the command's exit code", async () => {
    const { code } = await run(["exec", "sh", "-c", "exit 7"]);
    expect(code).toBe(7);
  });

  test("exec reports a missing command", async () => {
    const { code, stderr } = await run(["exec", "no-such-tool-xyz"]);
    expect(code).toBe(127);
    expect(stderr).toContain("command not found");
  });

  test("switch by name needs no password and shows how long it took", async () => {
    const { code, stderr } = await run(["switch", "Beta"]);
    expect(code).toBe(0);
    expect(stderr).toMatch(/Success! Switched to Beta \[\d+(?:ms|s)\]/u);
    const auth = await readJsonFile("auth.json");
    expect(auth.sessions.prod.project.name).toBe("Beta");
  });

  test("switch without a project and without a terminal lists the projects", async () => {
    const { code, stderr } = await run(["switch"]);
    expect(code).toBe(2);
    expect(stderr).toContain("Alpha, Beta");
  });

  test("files are private", async () => {
    const info = await stat(path.join(dir, "auth.json"));
    expect(info.mode.toString(8).slice(-3)).toBe("600");
  });

  test("--debug logs each request without tokens", async () => {
    const { stderr } = await run(["--debug", "switch", "Alpha"]);
    expect(stderr).toContain("[debug]");
    expect(stderr).toMatch(
      /201 POST http:\/\/localhost:\d+\/v3\/auth\/tokens/u
    );
    expect(stderr).not.toContain("tok-");
  });

  test("logout revokes and deletes the session", async () => {
    const { code, stderr } = await run(["logout"]);
    expect(code).toBe(0);
    expect(stderr).toContain("Logged out of prod");
    const after = await run(["whoami"]);
    expect(after.code).toBe(1);
  });
});

describe("files from nipa 0.1", () => {
  beforeAll(async () => {
    await freshDir();
    await seedLegacySession(dir, keystone.url);
  });

  test("load as the prod profile", async () => {
    const { stdout } = await run(["whoami", "--json"]);
    expect(JSON.parse(stdout)).toMatchObject({
      profile: "prod",
      project: { name: "Alpha" },
    });
  });

  test("are rewritten in the new format on the next save", async () => {
    await run(["switch", "Beta"]);
    const config = await readJsonFile("config.json");
    const auth = await readJsonFile("auth.json");
    expect(config.currentProfile).toBe("prod");
    expect(config.profiles.prod.authUrl).toBe(keystone.url);
    expect(auth.sessions.prod.project.name).toBe("Beta");
  });
});

describe("broken files", () => {
  beforeAll(freshDir);

  test("an invalid auth.json gives a clear error", async () => {
    await writeFile(path.join(dir, "auth.json"), '{"token": 1}');
    const { code, stderr } = await run(["whoami"]);
    expect(code).toBe(1);
    expect(stderr).toContain("auth.json");
    expect(stderr).toContain("delete it");
  });
});
