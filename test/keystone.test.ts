import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import {
  continueWithTotp,
  errorMessage,
  identityUrl,
  KeystoneError,
  listProjects,
  loginWithPassword,
  passwordBody,
  probe,
  rescope,
  rescopeBody,
  revoke,
  totpBody,
} from "../src/lib/keystone";
import type { Account } from "../src/lib/keystone";
import {
  ALPHA_ID,
  FAKE_PASSCODE,
  FAKE_PASSWORD,
  FAKE_USER,
  PLAIN_USER,
  startFakeKeystone,
} from "./fake-keystone";
import type { FakeKeystone } from "./fake-keystone";

describe("identityUrl", () => {
  test.each([
    ["https://id.example", "https://id.example/v3"],
    ["https://id.example/", "https://id.example/v3"],
    ["https://id.example/v3", "https://id.example/v3"],
    ["https://id.example/v3/", "https://id.example/v3"],
    ["https://h/identity", "https://h/identity/v3"],
  ])("%s -> %s", (input, expected) => {
    expect(identityUrl(input)).toBe(expected);
  });
});

describe("request bodies", () => {
  const account: Account = {
    authUrl: "https://id.example",
    userDomain: "nipacloud",
    username: "me@example.com",
  };

  test("password, unscoped without a project", () => {
    expect(passwordBody(account, "pw")).toEqual({
      auth: {
        identity: {
          methods: ["password"],
          password: {
            user: {
              domain: { name: "nipacloud" },
              name: "me@example.com",
              password: "pw",
            },
          },
        },
      },
    });
  });

  test("totp, scoped to a project", () => {
    const body = totpBody({ ...account, projectId: "p1" }, "123456");
    expect(body.auth.identity.methods).toEqual(["totp"]);
    expect(body.auth.scope).toEqual({ project: { id: "p1" } });
  });

  test("rescope uses the token method", () => {
    expect(rescopeBody("tok", "p2")).toEqual({
      auth: {
        identity: { methods: ["token"], token: { id: "tok" } },
        scope: { project: { id: "p2" } },
      },
    });
  });
});

describe("errorMessage", () => {
  const unauthorized = "wrong email or password";

  test("auth receipt with required methods", () => {
    const body = { receipt: {}, required_auth_methods: [["password", "totp"]] };
    expect(errorMessage({ body, status: 401, unauthorized })).toBe(
      "this account needs password + totp to log in"
    );
  });

  test("auth receipt with empty rules (application credential under MFA)", () => {
    const body = { receipt: {}, required_auth_methods: [] };
    expect(errorMessage({ body, status: 401, unauthorized })).toBe(
      "this account's MFA rules don't allow this login method"
    );
  });

  test("a plain 401 uses the caller's message", () => {
    expect(errorMessage({ body: {}, status: 401, unauthorized })).toBe(
      unauthorized
    );
  });

  test("other errors use Keystone's message", () => {
    expect(
      errorMessage({
        body: { error: { message: "nope" } },
        status: 403,
        unauthorized,
      })
    ).toBe("nope");
    expect(errorMessage({ body: {}, status: 500, unauthorized })).toBe(
      "Keystone returned HTTP 500"
    );
  });
});

describe("against a fake Keystone", () => {
  let keystone: FakeKeystone;
  let mfa: Account;
  let plain: Account;

  beforeAll(() => {
    keystone = startFakeKeystone();
    mfa = {
      authUrl: keystone.url,
      userDomain: "nipacloud",
      username: FAKE_USER.name,
    };
    plain = { ...mfa, username: PLAIN_USER.name };
  });

  afterAll(() => {
    keystone.stop();
  });

  test("an account without MFA gets a token from the password", async () => {
    const result = await loginWithPassword(
      { ...plain, projectId: ALPHA_ID },
      FAKE_PASSWORD
    );
    expect(result.kind).toBe("token");
  });

  test("an account with MFA gets a receipt, then a token from the OTP code", async () => {
    const account = { ...mfa, projectId: ALPHA_ID };
    const first = await loginWithPassword(account, FAKE_PASSWORD);
    if (first.kind !== "mfa") {
      throw new Error("expected an auth receipt");
    }
    const token = await continueWithTotp({
      account,
      passcode: FAKE_PASSCODE,
      receipt: first.receipt,
    });
    expect(token.value).toStartWith("tok-");
    expect(token.user).toEqual(FAKE_USER);
    expect(token.project).toEqual({
      domainId: "d1",
      id: ALPHA_ID,
      name: "Alpha",
    });
  });

  test("the receipt still works after a wrong code", async () => {
    const first = await loginWithPassword(mfa, FAKE_PASSWORD);
    if (first.kind !== "mfa") {
      throw new Error("expected an auth receipt");
    }
    const wrong = continueWithTotp({
      account: mfa,
      passcode: "000000",
      receipt: first.receipt,
    });
    await expect(wrong).rejects.toThrow("wrong OTP code");
    const token = await continueWithTotp({
      account: mfa,
      passcode: FAKE_PASSCODE,
      receipt: first.receipt,
    });
    expect(token.project).toBeUndefined();
  });

  test("a wrong password says so", async () => {
    const attempt = loginWithPassword(mfa, "nope");
    await expect(attempt).rejects.toThrow(KeystoneError);
    await expect(attempt).rejects.toThrow("wrong email or password");
  });

  test("lists enabled projects sorted by name, then rescopes", async () => {
    const first = await loginWithPassword(plain, FAKE_PASSWORD);
    if (first.kind !== "token") {
      throw new Error("expected a token");
    }
    const token = first.token.value;
    const projects = await listProjects({ authUrl: keystone.url, token });
    expect(projects.map((p) => p.name)).toEqual(["Alpha", "Beta"]);
    const scoped = await rescope({
      authUrl: keystone.url,
      projectId: projects[1]?.id ?? "",
      token,
    });
    expect(scoped.project?.name).toBe("Beta");
  });

  test("revoked tokens stop working, and revoking twice is fine", async () => {
    const first = await loginWithPassword(plain, FAKE_PASSWORD);
    if (first.kind !== "token") {
      throw new Error("expected a token");
    }
    const request = { authUrl: keystone.url, token: first.token.value };
    await revoke(request);
    await expect(listProjects(request)).rejects.toThrow(
      "the session expired or was revoked"
    );
    await expect(revoke(request)).resolves.toBeUndefined();
  });

  test("probe reads the Keystone version", async () => {
    expect(await probe(keystone.url)).toBe("v3.14");
    await expect(probe(`${keystone.url}/not-keystone`)).rejects.toThrow(
      "doesn't answer like Keystone v3"
    );
  });
});
