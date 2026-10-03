import { SHELLS } from "../lib/env";
import type { CommandSpec, Example } from "../lib/spec";
import { complete, completion } from "./completion";
import { exec } from "./exec";
import { login } from "./login";
import type { Globals } from "./login";
import { profile } from "./profile";
import { env, logout, switchProject, whoami } from "./session";

export interface Command extends CommandSpec {
  run: (input: { args: string[]; globals: Globals }) => Promise<number>;
}

const JSON_FLAG = {
  description: "Print JSON",
  long: "json",
  value: { kind: "none" },
} as const;

const profileSubcommands: CommandSpec[] = [
  {
    flags: [JSON_FLAG],
    name: "ls",
    summary: "List your profiles and who is logged in to each",
    usage: "[--json]",
  },
  {
    flags: [
      {
        description: "Keystone URL, ending in /v3",
        long: "auth-url",
        value: { kind: "text", name: "url" },
      },
      {
        description: "User domain (default: nipacloud)",
        long: "user-domain",
        value: { kind: "text", name: "domain" },
      },
      {
        description: "Region (default: NCP-TH)",
        long: "region",
        value: { kind: "text", name: "region" },
      },
      {
        description: "Make it the current profile",
        long: "use",
        value: { kind: "none" },
      },
    ],
    name: "add",
    summary: "Add a profile, asking for missing values",
    usage: "[name] [options]",
  },
  {
    args: { kind: "profiles" },
    name: "use",
    summary: "Make a profile the current one",
    usage: "[name]",
  },
  {
    args: { kind: "profiles" },
    flags: [
      {
        description: "Remove it without asking",
        long: "yes",
        short: "y",
        value: { kind: "none" },
      },
    ],
    name: "rm",
    summary: "Remove a profile and log out of it",
    usage: "<name>",
  },
];

export const createCommands = (): Command[] => {
  const commands: Command[] = [
    {
      description:
        "Asks for your email and password, then for an OTP code when your account uses MFA. nipa saves a token for the current profile, scoped to a project, and reuses it until it expires.",
      examples: [
        { command: "nipa login", description: "Log in to the current profile" },
        {
          command: "nipa -P staging login",
          description: "Log in to the staging profile",
        },
      ],
      flags: [
        {
          description: "Log in as this user instead of the last one",
          long: "username",
          short: "u",
          value: { kind: "text", name: "email" },
        },
        {
          description: "Use this project instead of the last one",
          long: "project",
          short: "p",
          value: { kind: "project" },
        },
      ],
      group: "Session",
      name: "login",
      run: login,
      summary: "Log in with your password and an OTP code",
      usage: "[options]",
    },
    {
      description:
        "Revokes the current profile's token and deletes its session. nipa keeps your email and last project for the next login.",
      group: "Session",
      name: "logout",
      run: logout,
      summary: "Revoke the token and forget the session",
    },
    {
      description:
        "Prints your user, profile, project and when the session expires. When the output goes to a pipe, nipa prints only your user name.",
      flags: [JSON_FLAG],
      group: "Session",
      name: "whoami",
      run: whoami,
      summary: "Show who you're logged in as",
      usage: "[--json]",
    },
    {
      args: { kind: "projects" },
      description:
        "Scopes the session to another project, by name or ID, without a password or OTP code. Without a project, nipa lists your projects to pick from.",
      group: "Session",
      name: "switch",
      run: switchProject,
      summary: "Use another project",
      usage: "[project]",
    },
    {
      aliases: ["openstack"],
      args: { kind: "openstack" },
      description:
        "Runs `openstack <args...>` with the session. It's the same as `nipa exec openstack <args...>`.",
      examples: [
        {
          command: "nipa os server list",
          description: "List the servers in your project",
        },
      ],
      group: "Run tools",
      name: "os",
      run: ({ args, globals }) =>
        exec({ args: ["openstack", ...args], globals }),
      summary: "Run openstack with the session",
      usage: "<args...>",
    },
    {
      aliases: ["terraform"],
      args: { kind: "program", program: "terraform" },
      description:
        "Runs `terraform <args...>` with the session. It's the same as `nipa exec terraform <args...>`.",
      examples: [
        {
          command: "nipa -P staging tf plan",
          description: "Plan against the staging profile",
        },
      ],
      group: "Run tools",
      name: "tf",
      run: ({ args, globals }) =>
        exec({ args: ["terraform", ...args], globals }),
      summary: "Run terraform with the session",
      usage: "<args...>",
    },
    {
      args: { kind: "command" },
      description:
        "Runs a command with the session's OS_* variables. nipa removes any OS_* variable already in your shell first, so a stale OS_PASSWORD from an old openrc can't override the token. nipa exits with the command's exit code.",
      examples: [
        {
          command: "nipa exec ansible-playbook site.yml",
          description: "Run an Ansible playbook",
        },
      ],
      group: "Run tools",
      name: "exec",
      run: exec,
      summary: "Run any command with the session",
      usage: "<command> [args...]",
    },
    {
      description:
        'Prints the session\'s OS_* variables as shell commands. Load them with `eval "$(nipa env)"` in bash or zsh, or with `nipa env | source` in fish.',
      flags: [
        {
          description: "Shell syntax to print (default: from $SHELL)",
          long: "shell",
          value: { choices: SHELLS, kind: "choice" },
        },
      ],
      group: "Run tools",
      name: "env",
      run: env,
      summary: "Print the OS_* variables for your shell",
      usage: "[options]",
    },
    {
      description:
        "A profile is a Keystone URL, user domain and region with its own session. nipa starts with prod, which is Nipa Cloud production. Add a profile for staging or any other Keystone, then use it with `nipa profile use <name>` or `-P <name>`.",
      examples: [
        {
          command:
            "nipa profile add staging --auth-url https://keystone.example.com/v3",
          description: "Add a staging profile",
        },
        {
          command: "nipa profile use staging",
          description: "Make staging the current profile",
        },
      ],
      group: "Setup",
      name: "profile",
      run: profile,
      subcommands: profileSubcommands,
      summary: "Manage Keystone profiles, such as staging",
      usage: "[ls|add|use|rm]",
    },
    {
      args: { kind: "shells" },
      description:
        "Prints the tab completion script for bash, zsh, fish or PowerShell. Load it from your shell's startup file.",
      examples: [
        {
          command: "echo 'eval \"$(nipa completion zsh)\"' >> ~/.zshrc",
          description: "zsh",
        },
        {
          command:
            "nipa completion fish > ~/.config/fish/completions/nipa.fish",
          description: "fish",
        },
      ],
      group: "Setup",
      name: "completion",
      run: ({ args }) => completion({ args, specs: commands }),
      summary: "Print the tab completion script for your shell",
      usage: "<shell>",
    },
    {
      hidden: true,
      name: "__complete",
      run: complete,
      summary: "Print values for the completion scripts",
      usage: "<projects|profiles|openstack -- <words...>>",
    },
  ];
  return commands;
};

export const MAIN_EXAMPLES: readonly Example[] = [
  { command: "nipa login", description: "Log in and pick a project" },
  {
    command: "nipa os server list",
    description: "Run openstack with the session",
  },
  {
    command: "nipa -P staging tf plan",
    description: "Run terraform against the staging profile",
  },
];
