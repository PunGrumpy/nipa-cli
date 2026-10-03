// me@example.com has the MFA rule password + totp. plain@example.com has no MFA.

import { randomUUID } from "node:crypto";

import { z } from "zod";

export const FAKE_USER = { id: "u1", name: "me@example.com" };
export const PLAIN_USER = { id: "u2", name: "plain@example.com" };
export const FAKE_PASSWORD = "secret";
export const FAKE_PASSCODE = "123456";
export const ALPHA_ID = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

const PROJECTS = [
  {
    domain_id: "d1",
    enabled: true,
    id: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    name: "Beta",
  },
  {
    domain_id: "d1",
    enabled: false,
    id: "cccccccccccccccccccccccccccccccc",
    name: "Gone",
  },
  { domain_id: "d1", enabled: true, id: ALPHA_ID, name: "Alpha" },
];

const USERS = new Map([
  [FAKE_USER.name, { mfa: true, user: FAKE_USER }],
  [PLAIN_USER.name, { mfa: false, user: PLAIN_USER }],
]);

export interface FakeKeystone {
  url: string;
  requests: string[];
  stop: () => void;
}

const UserSchema = z.object({ name: z.string().optional() });

const AuthSchema = z.object({
  auth: z.object({
    identity: z.object({
      methods: z.array(z.string()),
      password: z
        .object({ user: UserSchema.extend({ password: z.string() }) })
        .optional(),
      token: z.object({ id: z.string() }).optional(),
      totp: z
        .object({ user: UserSchema.extend({ passcode: z.string() }) })
        .optional(),
    }),
    scope: z.object({ project: z.object({ id: z.string() }) }).optional(),
  }),
});

type Identity = z.infer<typeof AuthSchema>["auth"]["identity"];

const unauthorized = () =>
  Response.json(
    {
      error: {
        code: 401,
        message: "The request you have made requires authentication.",
      },
    },
    { status: 401 }
  );

export const startFakeKeystone = (): FakeKeystone => {
  const tokens = new Map<string, typeof FAKE_USER>();
  const receipts = new Map<string, typeof FAKE_USER>();
  const requests: string[] = [];

  const issue = (
    user: typeof FAKE_USER,
    projectId: string | undefined
  ): Response => {
    const project = PROJECTS.find((p) => p.id === projectId);
    if (projectId && !project) {
      return unauthorized();
    }
    const value = `tok-${randomUUID()}`;
    tokens.set(value, user);
    const token = {
      expires_at: new Date(Date.now() + 24 * 3_600_000).toISOString(),
      project: project && {
        domain: { id: project.domain_id },
        id: project.id,
        name: project.name,
      },
      user: { ...user, domain: { id: "d1", name: "nipacloud" } },
    };
    return Response.json(
      { token },
      { headers: { "X-Subject-Token": value }, status: 201 }
    );
  };

  const receiptFor = (user: typeof FAKE_USER): Response => {
    const receipt = `rcpt-${randomUUID()}`;
    receipts.set(receipt, user);
    return Response.json(
      {
        receipt: { methods: ["password"] },
        required_auth_methods: [["password", "totp"]],
      },
      { headers: { "Openstack-Auth-Receipt": receipt }, status: 401 }
    );
  };

  const verifyUser = (
    req: Request,
    identity: Identity,
    projectId?: string
  ): Response => {
    const receipt = req.headers.get("Openstack-Auth-Receipt");
    const fromReceipt = receipt ? receipts.get(receipt) : undefined;
    const name = identity.password?.user.name ?? identity.totp?.user.name ?? "";
    const account = USERS.get(name);
    const user = fromReceipt ?? account?.user;
    const passwordOk =
      fromReceipt !== undefined ||
      identity.password?.user.password === FAKE_PASSWORD;
    if (!(user && passwordOk)) {
      return unauthorized();
    }
    if (!account?.mfa) {
      return issue(user, projectId);
    }
    if (!identity.methods.includes("totp")) {
      return receiptFor(user);
    }
    return identity.totp?.user.passcode === FAKE_PASSCODE
      ? issue(user, projectId)
      : unauthorized();
  };

  const verify = (
    req: Request,
    identity: Identity,
    projectId?: string
  ): Response => {
    if (!identity.methods.includes("token")) {
      return verifyUser(req, identity, projectId);
    }
    const user = tokens.get(identity.token?.id ?? "");
    return user ? issue(user, projectId) : unauthorized();
  };

  const authTokens = async (req: Request): Promise<Response> => {
    if (req.method === "DELETE") {
      const subject = req.headers.get("X-Subject-Token") ?? "";
      return tokens.delete(subject)
        ? new Response(null, { status: 204 })
        : unauthorized();
    }
    const parsed = AuthSchema.safeParse(await req.json());
    if (!parsed.success) {
      return Response.json(
        { error: { message: "bad request" } },
        { status: 400 }
      );
    }
    return verify(
      req,
      parsed.data.auth.identity,
      parsed.data.auth.scope?.project.id
    );
  };

  const server = Bun.serve({
    fetch: (req) => {
      const { pathname } = new URL(req.url);
      requests.push(`${req.method} ${pathname}`);
      if (pathname === "/v3" || pathname === "/v3/") {
        return Response.json({ version: { id: "v3.14", status: "stable" } });
      }
      if (pathname === "/v3/auth/tokens") {
        return authTokens(req);
      }
      if (pathname === "/v3/auth/projects") {
        return tokens.has(req.headers.get("X-Auth-Token") ?? "")
          ? Response.json({ projects: PROJECTS })
          : unauthorized();
      }
      return new Response("not found", { status: 404 });
    },
    port: 0,
  });

  return {
    requests,
    stop: () => server.stop(true),
    url: `http://localhost:${server.port}`,
  };
};
