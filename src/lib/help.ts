import pc from "picocolors";

import { COMMAND_GROUPS, flagPlaceholder, GLOBAL_FLAGS, visible } from "./spec";
import type { CommandSpec, Example, FlagSpec } from "./spec";

type Row = readonly [label: string, description: string];

const INDENT = "    ";
const LINE_WIDTH = 80;

const table = (rows: readonly Row[], width: number): string =>
  rows
    .map(
      ([label, description]) =>
        `${INDENT}${label.padEnd(width)}   ${description}`
    )
    .join("\n");

const labelWidth = (rows: readonly Row[]): number =>
  Math.max(0, ...rows.map(([label]) => label.length));

const wrap = (text: string, indent: string): string => {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(" ")) {
    if (line && indent.length + line.length + 1 + word.length > LINE_WIDTH) {
      lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  lines.push(line);
  return lines.map((l) => `${indent}${l}`).join("\n");
};

const flagRow = (flag: FlagSpec): Row => {
  const short = flag.short ? `-${flag.short}, ` : "    ";
  return [
    `${short}--${flag.long}${flagPlaceholder(flag.value)}`,
    flag.description,
  ];
};

const commandRow = (spec: CommandSpec): Row => [
  spec.usage ? `${spec.name} ${spec.usage}` : spec.name,
  spec.summary,
];

const section = (title: string, body: string): string => {
  const heading = pc.dim(`${title}:`);
  return `  ${heading}\n\n${body}\n`;
};

const examples = (list: readonly Example[]): string =>
  list
    .map(
      (e) =>
        `${INDENT}${pc.dim(e.description)}\n${INDENT}${pc.cyan("$")} ${e.command}`
    )
    .join("\n\n");

const globalRows = GLOBAL_FLAGS.map(flagRow);

export const mainHelp = (input: {
  specs: readonly CommandSpec[];
  version: string;
  examples: readonly Example[];
}): string => {
  const shown = visible(input.specs);
  const width = labelWidth([...shown.map(commandRow), ...globalRows]);
  const groups = COMMAND_GROUPS.map((group) => {
    const rows = shown.filter((spec) => spec.group === group).map(commandRow);
    return section(group, table(rows, width));
  });
  const version = pc.dim(`v${input.version}`);
  return [
    "",
    `  ${pc.bold("nipa")} ${version}`,
    "",
    wrap(
      "Log in to Nipa Cloud once, then run openstack and terraform with the session.",
      "  "
    ),
    "",
    `  ${pc.dim("Usage:")} nipa [options] <command>`,
    "",
    ...groups,
    section("Global options", table(globalRows, width)),
    section("Examples", examples(input.examples)),
    `  Run ${pc.bold("nipa <command> --help")} for a command's options.`,
    "",
  ].join("\n");
};

export const commandHelp = (spec: CommandSpec): string => {
  const subcommandRows = visible(spec.subcommands ?? []).map(commandRow);
  const flags = [
    ...(spec.flags ?? []),
    ...(spec.subcommands ?? []).flatMap((s) => s.flags ?? []),
  ];
  const flagRows = flags.map(flagRow);
  const width = labelWidth([...subcommandRows, ...flagRows, ...globalRows]);
  const usage = spec.usage ? ` ${spec.usage}` : "";
  const parts = [
    "",
    `  ${pc.dim("Usage:")} nipa ${spec.name}${usage}`,
    "",
    wrap(spec.description ?? spec.summary, "  "),
    "",
  ];
  if (subcommandRows.length > 0) {
    parts.push(section("Subcommands", table(subcommandRows, width)));
  }
  if (flagRows.length > 0) {
    parts.push(section("Options", table(flagRows, width)));
  }
  parts.push(section("Global options", table(globalRows, width)));
  if (spec.examples?.length) {
    parts.push(section("Examples", examples(spec.examples)));
  }
  return parts.join("\n");
};
