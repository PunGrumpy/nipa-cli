import { describe, expect, test } from "bun:test";

import { childEnv, detectShell, formatEnv, sessionEnv } from "../src/lib/env";
import { isActive } from "../src/lib/store";
import type { Profile, Session } from "../src/lib/store";
import { formatDuration, formatElapsed } from "../src/lib/ui";

const profile: Profile = {
  authUrl: "https://id.example/v3",
  region: "NCP-TH",
  userDomain: "nipacloud",
};

const session: Session = {
  expiresAt: "2030-01-01T00:00:00.000000Z",
  project: { domainId: "d1", id: "p1", name: "Alpha" },
  token: "tok",
  user: { id: "u1", name: "me@example.com" },
};

const vars = sessionEnv({ profile, session });

describe("sessionEnv", () => {
  test("uses the token, the profile's Keystone and the project ID", () => {
    expect(vars).toMatchObject({
      OS_AUTH_TYPE: "v3token",
      OS_AUTH_URL: "https://id.example/v3",
      OS_PROJECT_ID: "p1",
      OS_REGION_NAME: "NCP-TH",
      OS_TOKEN: "tok",
    });
  });
});

describe("childEnv", () => {
  test("drops OS_* from the parent and keeps everything else", () => {
    const env = childEnv(
      { HOME: "/home/me", OS_CLOUD: "old", OS_PASSWORD: "stale", PATH: "/bin" },
      vars
    );
    expect(env.OS_PASSWORD).toBeUndefined();
    expect(env.OS_CLOUD).toBeUndefined();
    expect(env.PATH).toBe("/bin");
    expect(env.OS_TOKEN).toBe("tok");
  });
});

describe("formatEnv", () => {
  const quoted = { ...vars, OS_PROJECT_NAME: "it's" };

  test("bash quotes with '\\''", () => {
    expect(formatEnv(quoted, "bash")).toContain(
      String.raw`export OS_PROJECT_NAME='it'\''s'`
    );
  });

  test("fish uses set -gx and escapes '", () => {
    expect(formatEnv(quoted, "fish")).toContain(
      String.raw`set -gx OS_PROJECT_NAME 'it\'s'`
    );
  });

  test("detectShell falls back to bash", () => {
    expect(detectShell("/opt/homebrew/bin/fish")).toBe("fish");
    expect(detectShell("/bin/zsh")).toBe("zsh");
    expect(detectShell("/bin/tcsh")).toBe("bash");
    expect(detectShell()).toBe("bash");
  });
});

describe("time", () => {
  const now = Date.parse("2030-01-01T00:00:00Z");

  test("a session is active until one minute before it expires", () => {
    expect(isActive(session, now - 120_000)).toBe(true);
    expect(isActive(session, now - 30_000)).toBe(false);
    expect(isActive(undefined, now)).toBe(false);
  });

  test("formatDuration", () => {
    expect(formatDuration(59_000)).toBe("0m");
    expect(formatDuration(45 * 60_000)).toBe("45m");
    expect(formatDuration((23 * 60 + 59) * 60_000)).toBe("23h 59m");
    expect(formatDuration(-1)).toBe("0m");
  });

  test("formatElapsed", () => {
    expect(formatElapsed(278.4)).toBe("278ms");
    expect(formatElapsed(2600)).toBe("3s");
  });
});
