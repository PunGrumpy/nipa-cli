import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  chmod,
  mkdtemp,
  readFile,
  rm,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { startFakeKeystone } from "./fake-keystone";
import type { FakeKeystone } from "./fake-keystone";
import {
  ENTRY,
  installNipaShim,
  runProcess,
  seedSession,
  testEnv,
} from "./helpers";

const SHELLS = ["bash", "zsh", "fish", "pwsh"] as const;

let dir: string;
let keystone: FakeKeystone;

const has = (shell: string): boolean => Bun.which(shell) !== null;

const PWSH_TIMEOUT_MS = 30_000;

const shellRun = (cmd: string[]) => runProcess(cmd, testEnv(dir));

const nipa = (...args: string[]) =>
  runProcess(["bun", ENTRY, ...args], testEnv(dir));

/** PowerShell only dot-sources files that end in .ps1. */
const script = (shell: string): string =>
  path.join(dir, `completion.${shell === "pwsh" ? "ps1" : shell}`);

const lines = (text: string): string[] =>
  text.trim().split(/\r?\n/u).filter(Boolean);

const FAKE_OPENSTACK = `#!/bin/sh
[ "$*" = "complete --shell none" ] || exit 1
echo run >> "$HOME/openstack-runs"
cat <<'TABLE'
  cmds='coe security server'
  cmds_coe='cluster-template'
  cmds_coe_cluster_template='create list'
  cmds_coe_cluster_template_create='-h --help --image'
  cmds_coe_cluster_template_list='-h --help'
  cmds_security='group'
  cmds_security_group='list'
  cmds_security_group_list='-h --help --long'
  cmds_server='create list resize resize_confirm show'
  cmds_server_create='-h --help --flavor --image'
  cmds_server_list='-h --help --long'
  cmds_server_resize='-h --help --flavor confirm'
  cmds_server_resize_confirm='-h --help'
  cmds_server_show='-h --help'
TABLE
`;

const fakeOpenstack = () => path.join(dir, "bin", "openstack");

const openstackRuns = async (): Promise<number> => {
  const log = await readFile(path.join(dir, "openstack-runs"), "utf-8");
  return lines(log).length;
};

const openstackComplete = async (...words: string[]) => {
  const { stdout } = await nipa("__complete", "openstack", "--", ...words);
  return lines(stdout);
};

const bashComplete = async (...words: string[]) => {
  const quoted = words.map((w) => `'${w}'`).join(" ");
  const { stdout } = await shellRun([
    "bash",
    "-c",
    `source '${script("bash")}'; COMP_WORDS=(${quoted}); COMP_CWORD=${words.length - 1}; _nipa; printf '%s\\n' "\${COMPREPLY[@]}"`,
  ]);
  return lines(stdout);
};

// Stub compadd and _files, which only work inside a real completion.
const zshComplete = async (...words: string[]) => {
  const quoted = words.map((w) => `'${w}'`).join(" ");
  const stubs = `compdef() { :; }; compadd() { print -rl -- \${(P)2}; }; _files() { print files; }`;
  const { stdout } = await shellRun([
    "zsh",
    "-f",
    "-c",
    `${stubs}; source '${script("zsh")}'; words=(${quoted}); CURRENT=${words.length}; PREFIX='${words.at(-1) ?? ""}'; _nipa`,
  ]);
  return lines(stdout);
};

const fishComplete = async (line: string) => {
  const { stdout } = await shellRun([
    "fish",
    "--no-config",
    "-c",
    `source '${script("fish")}'; complete -C '${line}'`,
  ]);
  return lines(stdout).map((l) => l.split("\t")[0]);
};

const pwshComplete = async (line: string) => {
  const { stdout } = await shellRun([
    "pwsh",
    "-NoProfile",
    "-Command",
    `. '${script("pwsh")}'; (TabExpansion2 -inputScript '${line}' -cursorColumn ${line.length}).CompletionMatches | ForEach-Object CompletionText`,
  ]);
  return lines(stdout);
};

const syntaxOk = async (cmd: string[]) => {
  const { code } = await shellRun(cmd);
  return code === 0;
};

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "nipa-completion-"));
  keystone = startFakeKeystone();
  await installNipaShim(dir);
  await writeFile(fakeOpenstack(), FAKE_OPENSTACK);
  await chmod(fakeOpenstack(), 0o755);
  await seedSession(dir, keystone.url);
  await Promise.all(
    SHELLS.map(async (shell) => {
      const { stdout } = await nipa("completion", shell);
      await writeFile(script(shell), stdout);
    })
  );
});

afterAll(async () => {
  keystone.stop();
  await rm(dir, { force: true, recursive: true });
});

describe("nipa completion", () => {
  test("rejects an unknown shell", async () => {
    const { code, stderr } = await nipa("completion", "tcsh");
    expect(code).toBe(2);
    expect(stderr).toContain("bash, zsh, fish, pwsh");
  });

  test("__complete lists project and profile names", async () => {
    const projects = await nipa("__complete", "projects");
    expect(lines(projects.stdout)).toEqual(["Alpha", "Beta"]);
    const profiles = await nipa("__complete", "profiles");
    expect(lines(profiles.stdout)).toEqual(["prod"]);
  });

  test("__complete openstack walks openstack's commands", async () => {
    expect(await openstackComplete("se")).toEqual(["security", "server"]);
    expect(await openstackComplete("server", "")).toEqual([
      "create",
      "list",
      "resize",
      "show",
    ]);
    expect(await openstackComplete("coe", "cluster-template", "")).toEqual([
      "create",
      "list",
    ]);
    expect(await openstackComplete("server", "list", "")).toEqual([]);
    expect(await openstackComplete("server", "list", "--")).toEqual([
      "--help",
      "--long",
    ]);
    expect(await openstackComplete("server", "list", "-h")).toEqual(["-h"]);
  });

  test("__complete openstack splits a command that has subcommands", async () => {
    expect(await openstackComplete("server", "resize", "")).toEqual([
      "confirm",
    ]);
    expect(await openstackComplete("server", "resize", "--f")).toEqual([
      "--flavor",
    ]);
    const confirm = await openstackComplete("server", "resize", "confirm", "-");
    expect(confirm).toEqual(["-h", "--help"]);
  });

  test("__complete openstack runs openstack again only after it changes", async () => {
    await rm(path.join(dir, "openstack-runs"), { force: true });
    await rm(path.join(dir, ".cache"), { force: true, recursive: true });
    await nipa("__complete", "openstack", "--", "s");
    await nipa("__complete", "openstack", "--", "s");
    expect(await openstackRuns()).toBe(1);
    const later = new Date(Date.now() + 60_000);
    await utimes(fakeOpenstack(), later, later);
    await nipa("__complete", "openstack", "--", "s");
    expect(await openstackRuns()).toBe(2);
  });

  test("__complete openstack prints nothing without openstack", async () => {
    const { code, stdout } = await runProcess(
      [process.execPath, ENTRY, "__complete", "openstack", "--", "s"],
      { ...testEnv(dir), PATH: path.dirname(process.execPath) }
    );
    expect(code).toBe(0);
    expect(stdout).toBe("");
  });

  test("hidden commands stay out of --help", async () => {
    const { stdout } = await nipa("--help");
    expect(stdout).not.toContain("__complete");
    expect(stdout).toContain("completion");
  });
});

describe("bash", () => {
  test("syntax", async () => {
    expect(await syntaxOk(["bash", "-n", script("bash")])).toBe(true);
  });

  test("commands", async () => {
    expect(await bashComplete("nipa", "lo")).toEqual(["login", "logout"]);
  });

  test("flags and flag values", async () => {
    expect(await bashComplete("nipa", "whoami", "--j")).toEqual(["--json"]);
    expect(await bashComplete("nipa", "env", "--shell", "f")).toEqual(["fish"]);
  });

  test("switch lists projects from the session", async () => {
    expect(await bashComplete("nipa", "switch", "")).toEqual(["Alpha", "Beta"]);
  });

  test("global options before the command", async () => {
    expect(await bashComplete("nipa", "-P", "")).toEqual(["prod"]);
    expect(await bashComplete("nipa", "-P", "prod", "sw")).toEqual(["switch"]);
  });

  test("openstack commands after os and openstack", async () => {
    expect(await bashComplete("nipa", "os", "server", "l")).toEqual(["list"]);
    const after = await bashComplete("nipa", "-P", "prod", "openstack", "se");
    expect(after).toEqual(["security", "server"]);
  });

  test("profile subcommands and profile names", async () => {
    const subcommands = await bashComplete("nipa", "profile", "");
    expect(subcommands.toSorted()).toEqual(["add", "ls", "rm", "use"]);
    expect(await bashComplete("nipa", "profile", "use", "")).toEqual(["prod"]);
  });
});

describe("zsh", () => {
  test("syntax", async () => {
    expect(await syntaxOk(["zsh", "-n", script("zsh")])).toBe(true);
  });

  test("registers _nipa for nipa when eval'd", async () => {
    // A stub compdef: a full compinit takes seconds on machines with a large $fpath.
    const { stdout } = await shellRun([
      "zsh",
      "-f",
      "-c",
      `compdef() { print -r -- "$2 -> $1"; }; source '${script("zsh")}'`,
    ]);
    expect(stdout.trim()).toBe("nipa -> _nipa");
  });

  test("openstack commands after os", async () => {
    expect(await zshComplete("nipa", "os", "server", "")).toEqual([
      "create",
      "list",
      "resize",
      "show",
    ]);
    expect(await zshComplete("nipa", "os", "server", "list", "")).toEqual([
      "files",
    ]);
  });
});

describe.if(has("fish"))("fish", () => {
  test("syntax", async () => {
    expect(await syntaxOk(["fish", "-n", script("fish")])).toBe(true);
  });

  test("commands with descriptions", async () => {
    expect(await fishComplete("nipa lo")).toEqual(["login", "logout"]);
  });

  test("switch lists projects from the session", async () => {
    expect(await fishComplete("nipa switch ")).toEqual(["Alpha", "Beta"]);
  });

  test("completion lists shells", async () => {
    expect(await fishComplete("nipa completion p")).toEqual(["pwsh"]);
  });

  test("global options before the command", async () => {
    expect(await fishComplete("nipa -P ")).toEqual(["prod"]);
    expect(await fishComplete("nipa -P prod sw")).toEqual(["switch"]);
  });

  test("openstack commands after os", async () => {
    const subcommands = await fishComplete("nipa os server ");
    expect(subcommands).toEqual(["create", "list", "resize", "show"]);
    const options = await fishComplete("nipa os server list --");
    expect(options).toEqual(["--help", "--long"]);
  });

  test("profile subcommands and profile names", async () => {
    const subcommands = await fishComplete("nipa profile ");
    expect(subcommands.toSorted()).toEqual(["add", "ls", "rm", "use"]);
    expect(await fishComplete("nipa profile use ")).toEqual(["prod"]);
  });
});

describe.if(has("pwsh"))("pwsh", () => {
  test(
    "commands",
    async () => {
      expect(await pwshComplete("nipa lo")).toEqual(["login", "logout"]);
    },
    PWSH_TIMEOUT_MS
  );

  test(
    "flags",
    async () => {
      expect(await pwshComplete("nipa whoami --j")).toEqual(["--json"]);
    },
    PWSH_TIMEOUT_MS
  );

  test(
    "global options before the command",
    async () => {
      expect(await pwshComplete("nipa -P ")).toEqual(["prod"]);
      expect(await pwshComplete("nipa -P prod sw")).toEqual(["switch"]);
    },
    PWSH_TIMEOUT_MS
  );

  test(
    "profile subcommands and profile names",
    async () => {
      const subcommands = await pwshComplete("nipa profile ");
      expect(subcommands.toSorted()).toEqual(["add", "ls", "rm", "use"]);
      expect(await pwshComplete("nipa profile use ")).toEqual(["prod"]);
    },
    PWSH_TIMEOUT_MS
  );

  test(
    "switch lists projects from the session",
    async () => {
      expect(await pwshComplete("nipa switch ")).toEqual(["Alpha", "Beta"]);
    },
    PWSH_TIMEOUT_MS
  );

  test(
    "openstack commands after os",
    async () => {
      const subcommands = await pwshComplete("nipa os server ");
      expect(subcommands).toEqual(["create", "list", "resize", "show"]);
      expect(await pwshComplete("nipa os se")).toEqual(["security", "server"]);
    },
    PWSH_TIMEOUT_MS
  );
});
