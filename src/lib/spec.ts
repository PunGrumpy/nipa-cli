// The help pages and the completion scripts are generated from these specs.

export type FlagValue =
  | { kind: "none" }
  | { kind: "text"; name: string }
  | { kind: "choice"; choices: readonly [string, ...string[]] }
  | { kind: "project" }
  | { kind: "profile" };

export interface FlagSpec {
  long: string;
  short?: string;
  description: string;
  value: FlagValue;
}

export type ArgSpec =
  | { kind: "projects" }
  | { kind: "profiles" }
  | { kind: "shells" }
  /** The rest of the line completes as if typed after `program`. */
  | { kind: "program"; program: string }
  /** The next word is a command, and the rest completes as that command. */
  | { kind: "command" }
  /** The rest of the line completes from `nipa __complete openstack`. */
  | { kind: "openstack" };

export interface Example {
  description: string;
  command: string;
}

export const COMMAND_GROUPS = ["Session", "Run tools", "Setup"] as const;

type CommandGroup = (typeof COMMAND_GROUPS)[number];

export interface CommandSpec {
  name: string;
  summary: string;
  usage?: string;
  description?: string;
  group?: CommandGroup;
  aliases?: readonly string[];
  flags?: readonly FlagSpec[];
  args?: ArgSpec;
  subcommands?: readonly CommandSpec[];
  examples?: readonly Example[];
  hidden?: boolean;
}

export const PROFILE_FLAG: FlagSpec = {
  description: "Use this profile (or set NIPA_PROFILE)",
  long: "profile",
  short: "P",
  value: { kind: "profile" },
};

export const GLOBAL_FLAGS: readonly FlagSpec[] = [
  PROFILE_FLAG,
  {
    description: "Log each HTTP request (or set NIPA_DEBUG=1)",
    long: "debug",
    short: "d",
    value: { kind: "none" },
  },
  {
    description: "Turn off colors (or set NO_COLOR=1)",
    long: "no-color",
    value: { kind: "none" },
  },
  {
    description: "Show help",
    long: "help",
    short: "h",
    value: { kind: "none" },
  },
  {
    description: "Show the version",
    long: "version",
    short: "v",
    value: { kind: "none" },
  },
];

/** Commands whose arguments belong to another program, including --help. */
export const isPassthrough = (spec: CommandSpec): boolean =>
  spec.args?.kind === "program" ||
  spec.args?.kind === "command" ||
  spec.args?.kind === "openstack";

export const visible = <T extends CommandSpec>(specs: readonly T[]): T[] =>
  specs.filter((spec) => !spec.hidden);

export const names = (spec: CommandSpec): string[] => [
  spec.name,
  ...(spec.aliases ?? []),
];

export const flagWords = (flag: FlagSpec): string[] =>
  flag.short ? [`--${flag.long}`, `-${flag.short}`] : [`--${flag.long}`];

export const flagPlaceholder = (value: FlagValue): string => {
  switch (value.kind) {
    case "none": {
      return "";
    }
    case "text": {
      return ` <${value.name}>`;
    }
    case "choice": {
      return ` <${value.choices.join("|")}>`;
    }
    case "project": {
      return " <project>";
    }
    case "profile": {
      return " <name>";
    }
    default: {
      const _exhaustive: never = value;
      return _exhaustive;
    }
  }
};
