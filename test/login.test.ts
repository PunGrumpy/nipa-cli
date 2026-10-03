import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { authenticate } from "../src/commands/login";
import type { LoginPrompts } from "../src/commands/login";
import type { Project } from "../src/lib/keystone";
import type { Profile } from "../src/lib/store";
import {
  ALPHA_ID,
  FAKE_PASSCODE,
  FAKE_PASSWORD,
  FAKE_USER,
  PLAIN_USER,
  startFakeKeystone,
} from "./fake-keystone";
import type { FakeKeystone } from "./fake-keystone";

let keystone: FakeKeystone;
let profile: Profile;

beforeAll(() => {
  keystone = startFakeKeystone();
  profile = {
    authUrl: keystone.url,
    region: "NCP-TH",
    userDomain: "nipacloud",
  };
});

afterAll(() => {
  keystone.stop();
});

const answers = (input: {
  email?: string;
  codes?: string[];
  project?: string;
}) => {
  const asked: string[] = [];
  const codes = [...(input.codes ?? [])];
  const prompts: LoginPrompts = {
    email: (previous) => {
      asked.push(`email (default ${previous ?? "none"})`);
      return Promise.resolve(input.email ?? FAKE_USER.name);
    },
    otp: (attempt) => {
      asked.push(`otp ${attempt}`);
      return Promise.resolve(codes.shift() ?? FAKE_PASSCODE);
    },
    password: () => {
      asked.push("password");
      return Promise.resolve(FAKE_PASSWORD);
    },
    project: (projects: readonly Project[]) => {
      asked.push(`project of ${projects.map((p) => p.name).join(",")}`);
      const match =
        projects.find((p) => p.name === input.project) ?? projects[0];
      return match
        ? Promise.resolve(match)
        : Promise.reject(new Error("no projects"));
    },
  };
  return { asked, prompts };
};

describe("authenticate", () => {
  test("MFA account: email, password, OTP code, then a project from the list", async () => {
    const { asked, prompts } = answers({ project: "Beta" });
    const session = await authenticate({ profile, prompts });
    expect(asked).toEqual([
      "email (default none)",
      "password",
      "otp 1",
      "project of Alpha,Beta",
    ]);
    expect(session.project.name).toBe("Beta");
    expect(session.user).toEqual(FAKE_USER);
  });

  test("account without MFA: no OTP prompt", async () => {
    const { asked, prompts } = answers({
      email: PLAIN_USER.name,
      project: "Alpha",
    });
    const session = await authenticate({ profile, prompts });
    expect(asked).not.toContain("otp 1");
    expect(session.user).toEqual(PLAIN_USER);
  });

  test("the last project is scoped in the login request, without a project prompt", async () => {
    const { asked, prompts } = answers({});
    const last: Profile = {
      ...profile,
      project: { id: ALPHA_ID, name: "Alpha" },
      username: FAKE_USER.name,
    };
    const session = await authenticate({ profile: last, prompts });
    expect(asked).toEqual([
      `email (default ${FAKE_USER.name})`,
      "password",
      "otp 1",
    ]);
    expect(session.project.name).toBe("Alpha");
  });

  test("--project by name skips the project prompt", async () => {
    const { asked, prompts } = answers({});
    const session = await authenticate({
      profile,
      prompts,
      username: FAKE_USER.name,
      wantedProject: "Beta",
    });
    expect(asked).toEqual(["password", "otp 1"]);
    expect(session.project.name).toBe("Beta");
  });

  test("a wrong OTP code asks for the next one", async () => {
    const { asked, prompts } = answers({
      codes: ["000000", FAKE_PASSCODE],
      project: "Alpha",
    });
    await authenticate({ profile, prompts });
    expect(asked.filter((a) => a.startsWith("otp"))).toEqual([
      "otp 1",
      "otp 2",
    ]);
  });

  test("three wrong codes give up", async () => {
    const { prompts } = answers({ codes: ["000000", "000000", "000000"] });
    await expect(authenticate({ profile, prompts })).rejects.toThrow(
      "wrong OTP code"
    );
  });

  test("an unknown --project lists the real ones", async () => {
    const { prompts } = answers({});
    const attempt = authenticate({
      profile,
      prompts,
      username: PLAIN_USER.name,
      wantedProject: "Nope",
    });
    await expect(attempt).rejects.toThrow('no project named or with ID "Nope"');
  });
});
