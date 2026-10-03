import {
  flagWords,
  GLOBAL_FLAGS,
  isPassthrough,
  names,
  PROFILE_FLAG,
  visible,
} from "./spec";
import type { ArgSpec, CommandSpec, FlagSpec, FlagValue } from "./spec";

export const COMPLETION_SHELLS = ["bash", "zsh", "fish", "pwsh"] as const;

type CompletionShell = (typeof COMPLETION_SHELLS)[number];

export const isCompletionShell = (value: string): value is CompletionShell =>
  COMPLETION_SHELLS.some((shell) => shell === value);

type DynamicKind = "projects" | "profiles";

const dynamic = (kind: DynamicKind): string => `nipa __complete ${kind}`;

const PROFILE_WORDS = flagWords(PROFILE_FLAG);

const passthroughNames = (specs: readonly CommandSpec[]): string[] =>
  specs.filter(isPassthrough).flatMap(names);

const allFlags = (spec: CommandSpec): FlagSpec[] => [
  ...(spec.flags ?? []),
  ...GLOBAL_FLAGS,
];

const bashValue = (value: FlagValue): string | undefined => {
  switch (value.kind) {
    case "none": {
      return undefined;
    }
    case "text": {
      return "return";
    }
    case "choice": {
      return `_nipa_reply ${value.choices.join(" ")}; return`;
    }
    case "project": {
      return `_nipa_reply "$(${dynamic("projects")} 2>/dev/null)"; return`;
    }
    case "profile": {
      return `_nipa_reply "$(${dynamic("profiles")} 2>/dev/null)"; return`;
    }
    default: {
      const _exhaustive: never = value;
      return _exhaustive;
    }
  }
};

const bashArgs = (args: ArgSpec): string => {
  switch (args.kind) {
    case "projects":
    case "profiles": {
      return `_nipa_reply "$(${dynamic(args.kind)} 2>/dev/null)"`;
    }
    case "shells": {
      return `_nipa_reply ${COMPLETION_SHELLS.join(" ")}`;
    }
    case "program": {
      return `COMP_WORDS[i]=${args.program}; _nipa_offset "$i"`;
    }
    case "command": {
      return '_nipa_offset "$((i + 1))"';
    }
    case "openstack": {
      return `_nipa_reply "$(nipa __complete openstack -- "\${COMP_WORDS[@]:i+1:COMP_CWORD-i}" 2>/dev/null)"`;
    }
    default: {
      const _exhaustive: never = args;
      return _exhaustive;
    }
  }
};

const bashArm = (spec: CommandSpec, depth: number): string => {
  const pad = "  ".repeat(depth * 2 + 2);
  const lines: string[] = [];
  if (spec.subcommands?.length) {
    const subs = visible(spec.subcommands);
    lines.push(
      `if [[ $COMP_CWORD -eq $((i + 1)) ]]; then _nipa_reply ${subs.map((s) => s.name).join(" ")}; return; fi`,
      `case \${COMP_WORDS[i + 1]} in`,
      ...subs.map((sub) => bashArm(sub, depth + 1)),
      "esac"
    );
  } else if (isPassthrough(spec)) {
    lines.push(spec.args ? bashArgs(spec.args) : ":");
  } else {
    const flags = allFlags(spec);
    const valued = flags.flatMap((flag) => {
      const reply = bashValue(flag.value);
      return reply === undefined
        ? []
        : [`  ${flagWords(flag).join("|")}) ${reply} ;;`];
    });
    if (valued.length > 0) {
      lines.push('case "$prev" in', ...valued, "esac");
    }
    const words = flags.flatMap(flagWords).join(" ");
    lines.push(`if [[ $cur == -* ]]; then _nipa_reply ${words}; return; fi`);
    if (spec.args) {
      lines.push(bashArgs(spec.args));
    }
  }
  const body = lines.map((line) => `${pad}  ${line}`).join("\n");
  return `${pad}${names(spec).join("|")})\n${body}\n${pad}  ;;`;
};

const bash = (specs: readonly CommandSpec[]): string => {
  const shown = visible(specs);
  const commands = shown.map((c) => c.name).join(" ");
  const globals = GLOBAL_FLAGS.flatMap(flagWords).join(" ");
  return `# nipa completion for bash
# Load it from ~/.bashrc:  eval "$(nipa completion bash)"

# One word per line, so project names with spaces stay whole.
_nipa_reply() {
  local IFS=$'\\n'
  COMPREPLY=($(compgen -W "$*" -- "$cur"))
}

# _command_offset comes from the bash-completion package.
_nipa_offset() {
  if declare -F _command_offset >/dev/null; then
    _command_offset "$1"
  else
    COMPREPLY=($(compgen -f -- "$cur"))
  fi
}

_nipa() {
  local cur=\${COMP_WORDS[COMP_CWORD]} prev=\${COMP_WORDS[COMP_CWORD-1]}
  COMPREPLY=()
  local i=1 command=""
  while [[ $i -lt $COMP_CWORD ]]; do
    case \${COMP_WORDS[i]} in
      ${PROFILE_WORDS.join("|")}) ((i += 2)) ;;
      -*) ((i += 1)) ;;
      *) command=\${COMP_WORDS[i]}; break ;;
    esac
  done
  if [[ -z $command ]]; then
    case $prev in
      ${PROFILE_WORDS.join("|")}) _nipa_reply "$(${dynamic("profiles")} 2>/dev/null)"; return ;;
    esac
    if [[ $cur == -* ]]; then _nipa_reply ${globals}; else _nipa_reply ${commands}; fi
    return
  fi
  case $command in
${shown.map((spec) => bashArm(spec, 0)).join("\n")}
  esac
}
complete -o default -F _nipa nipa
`;
};

const zshQuote = (text: string): string =>
  text.replaceAll("'", "'\\''").replaceAll(":", "\\:");

const zshValue = (flag: FlagSpec): string => {
  const { value } = flag;
  switch (value.kind) {
    case "none": {
      return "";
    }
    case "text": {
      return `:${value.name}: `;
    }
    case "choice": {
      return `:${flag.long}:(${value.choices.join(" ")})`;
    }
    case "project": {
      return ":project:{_nipa_dynamic projects project}";
    }
    case "profile": {
      return ":profile:{_nipa_dynamic profiles profile}";
    }
    default: {
      const _exhaustive: never = value;
      return _exhaustive;
    }
  }
};

const zshFlag = (flag: FlagSpec): string => {
  const words = flagWords(flag);
  const exclusive = words.length > 1 ? `(${words.join(" ")})` : "";
  const spelled = words.length > 1 ? `{${words.join(",")}}` : words[0];
  return `'${exclusive}'${spelled}'[${zshQuote(flag.description)}]${zshValue(flag)}'`;
};

const zshArg = (args: ArgSpec): string => {
  switch (args.kind) {
    case "projects": {
      return "'1:project:{_nipa_dynamic projects project}'";
    }
    case "profiles": {
      return "'1:profile:{_nipa_dynamic profiles profile}'";
    }
    case "shells": {
      return `'1:shell:(${COMPLETION_SHELLS.join(" ")})'`;
    }
    case "program":
    case "command":
    case "openstack": {
      return "";
    }
    default: {
      const _exhaustive: never = args;
      return _exhaustive;
    }
  }
};

/** On entry, words[1] is this command's name. */
const zshBody = (spec: CommandSpec, pad: string): string => {
  if (spec.subcommands?.length) {
    const subs = visible(spec.subcommands);
    const described = subs
      .map((s) => `'${s.name}:${zshQuote(s.summary)}'`)
      .join(" ");
    const arms = subs
      .map((sub) => {
        const body = zshBody(sub, `${pad}    `);
        return `${pad}    ${names(sub).join("|")})\n${body}\n${pad}      ;;`;
      })
      .join("\n");
    return [
      `${pad}  if (( CURRENT == 2 )); then`,
      `${pad}    local -a subcommands; subcommands=(${described})`,
      `${pad}    _describe -t subcommands '${spec.name} subcommand' subcommands; return`,
      `${pad}  fi`,
      `${pad}  shift words; (( CURRENT-- ))`,
      `${pad}  case $words[1] in`,
      arms,
      `${pad}  esac`,
    ].join("\n");
  }
  switch (spec.args?.kind) {
    case "program": {
      return `${pad}  words[1]=${spec.args.program}; _normal`;
    }
    case "command": {
      return `${pad}  shift words; (( CURRENT-- )); _normal`;
    }
    case "openstack": {
      return `${pad}  _nipa_openstack`;
    }
    default: {
      const specs = [
        ...allFlags(spec).map(zshFlag),
        spec.args ? zshArg(spec.args) : "",
      ];
      return `${pad}  _arguments -s ${specs.filter(Boolean).join(" ")}`;
    }
  }
};

const zsh = (specs: readonly CommandSpec[]): string => {
  const shown = visible(specs);
  const commands = shown
    .map((c) => `    '${c.name}:${zshQuote(c.summary)}'`)
    .join("\n");
  const globals = GLOBAL_FLAGS.flatMap((flag) =>
    flagWords(flag).map((word) => `    '${word}:${zshQuote(flag.description)}'`)
  ).join("\n");
  const arms = shown
    .map(
      (spec) =>
        `    ${names(spec).join("|")})\n${zshBody(spec, "    ")}\n      ;;`
    )
    .join("\n");
  return `#compdef nipa
# nipa completion for zsh
# Load it from ~/.zshrc, after compinit:  eval "$(nipa completion zsh)"
# Or save it as _nipa in a directory on your $fpath.

_nipa_dynamic() {
  local -a values
  values=(\${(f)"$(nipa __complete $1 2>/dev/null)"})
  _describe -t $1 $2 values
}

_nipa_openstack() {
  local -a values
  values=(\${(f)"$(nipa __complete openstack -- "\${(@)words[2,CURRENT-1]}" "$PREFIX" 2>/dev/null)"})
  if (( $#values )); then compadd -a values; else _files; fi
}

_nipa() {
  local i=2 command=""
  while (( i < CURRENT )); do
    case $words[i] in
      ${PROFILE_WORDS.join("|")}) (( i += 2 )) ;;
      -*) (( i += 1 )) ;;
      *) command=$words[i]; break ;;
    esac
  done
  if [[ -z $command ]]; then
    if [[ $words[CURRENT-1] == (${PROFILE_WORDS.join("|")}) ]]; then
      _nipa_dynamic profiles profile
    elif [[ $PREFIX == -* ]]; then
      local -a globals; globals=(
${globals}
      )
      _describe -t options 'global option' globals
    else
      local -a commands; commands=(
${commands}
      )
      _describe -t commands 'nipa command' commands
    fi
    return
  fi
  # Drop nipa and any global options, so words[1] is the command.
  shift $(( i - 1 )) words; (( CURRENT -= i - 1 ))
  case $command in
${arms}
  esac
}

if [[ $zsh_eval_context[-1] == loadautofunc ]]; then
  _nipa "$@"
else
  compdef _nipa nipa
fi
`;
};

const fishQuote = (text: string): string =>
  `'${text.replaceAll("\\", "\\\\").replaceAll("'", "\\'")}'`;

const fishDynamic = (kind: DynamicKind): string =>
  `'(${dynamic(kind)} 2>/dev/null)'`;

const fishValue = (value: FlagValue): string => {
  switch (value.kind) {
    case "none": {
      return "";
    }
    case "text": {
      return " --exclusive";
    }
    case "choice": {
      return ` --exclusive -a ${fishQuote(value.choices.join(" "))}`;
    }
    case "project": {
      return ` --exclusive -a ${fishDynamic("projects")}`;
    }
    case "profile": {
      return ` --exclusive -a ${fishDynamic("profiles")}`;
    }
    default: {
      const _exhaustive: never = value;
      return _exhaustive;
    }
  }
};

const fishArgs = (args: ArgSpec): string => {
  switch (args.kind) {
    case "projects":
    case "profiles": {
      return fishDynamic(args.kind);
    }
    case "shells": {
      return fishQuote(COMPLETION_SHELLS.join(" "));
    }
    case "program": {
      return `'(__nipa_complete_as ${args.program})'`;
    }
    case "command": {
      return "'(__nipa_complete_as)'";
    }
    case "openstack": {
      return "'(__nipa_openstack)'";
    }
    default: {
      const _exhaustive: never = args;
      return _exhaustive;
    }
  }
};

const fishFlag = (flag: FlagSpec, condition: string): string => {
  const short = flag.short ? ` -s ${flag.short}` : "";
  return `complete -c nipa -n ${fishQuote(condition)}${short} -l ${flag.long}${fishValue(flag.value)} -d ${fishQuote(flag.description)}`;
};

const fishLines = (spec: CommandSpec, parent?: CommandSpec): string[] => {
  const using = `__nipa_using ${(parent ? names(parent) : names(spec)).join(" ")}`;
  const condition = parent
    ? `${using}; and __fish_seen_subcommand_from ${names(spec).join(" ")}`
    : using;
  if (spec.subcommands?.length) {
    const subs = visible(spec.subcommands);
    const none = `${condition}; and not __fish_seen_subcommand_from ${subs.flatMap(names).join(" ")}`;
    return [
      ...subs.map(
        (sub) =>
          `complete -c nipa -n ${fishQuote(none)} -a ${sub.name} -d ${fishQuote(sub.summary)}`
      ),
      ...subs.flatMap((sub) => fishLines(sub, spec)),
    ];
  }
  const flags = (spec.flags ?? []).map((flag) => fishFlag(flag, condition));
  const args = spec.args
    ? [`complete -c nipa -n ${fishQuote(condition)} -a ${fishArgs(spec.args)}`]
    : [];
  return [...flags, ...args];
};

const fish = (specs: readonly CommandSpec[]): string => {
  const shown = visible(specs);
  const notPassthrough = `not __nipa_using ${passthroughNames(specs).join(" ")}`;
  const top = shown.map(
    (c) =>
      `complete -c nipa -n __nipa_needs_command -a ${c.name} -d ${fishQuote(c.summary)}`
  );
  return `# nipa completion for fish
# Save it:  nipa completion fish > ~/.config/fish/completions/nipa.fish

function __nipa_command_index
    set -l tokens (commandline -opc)
    set -l i 2
    while test $i -le (count $tokens)
        switch $tokens[$i]
            case ${PROFILE_WORDS.join(" ")}
                set i (math $i + 2)
            case '-*'
                set i (math $i + 1)
            case '*'
                echo $i
                return 0
        end
    end
    return 1
end

function __nipa_needs_command
    not __nipa_command_index >/dev/null
end

function __nipa_using
    set -l i (__nipa_command_index); or return 1
    set -l tokens (commandline -opc)
    contains -- $tokens[$i] $argv
end

function __nipa_complete_as
    set -l i (__nipa_command_index); or return
    set -l tokens (commandline -opc)
    set -l line $argv $tokens[(math $i + 1)..-1] (commandline -ct)
    complete -C "$line"
end

function __nipa_openstack
    set -l i (__nipa_command_index); or return
    set -l tokens (commandline -opc)
    set -l values (nipa __complete openstack -- $tokens[(math $i + 1)..-1] (commandline -ct) 2>/dev/null)
    if set -q values[1]
        printf '%s\\n' $values
    else
        __fish_complete_path (commandline -ct)
    end
end

complete -c nipa -f
${GLOBAL_FLAGS.map((flag) => fishFlag(flag, notPassthrough)).join("\n")}
${top.join("\n")}
${shown.flatMap((spec) => fishLines(spec)).join("\n")}
`;
};

const pwshQuote = (text: string): string => `'${text.replaceAll("'", "''")}'`;

const pwshList = (words: readonly string[]): string =>
  `@(${words.map(pwshQuote).join(", ")})`;

const pwshValue = (value: FlagValue): string | undefined => {
  switch (value.kind) {
    case "none":
    case "text": {
      return undefined;
    }
    case "choice": {
      return pwshList(value.choices);
    }
    case "project": {
      return "(Dynamic projects)";
    }
    case "profile": {
      return "(Dynamic profiles)";
    }
    default: {
      const _exhaustive: never = value;
      return _exhaustive;
    }
  }
};

/** PowerShell can't hand over to another program's completer. */
const pwshArgs = (args: ArgSpec): string | undefined => {
  switch (args.kind) {
    case "projects":
    case "profiles": {
      return `(Dynamic ${args.kind})`;
    }
    case "shells": {
      return pwshList(COMPLETION_SHELLS);
    }
    case "openstack": {
      return "(Openstack ($c + 1))";
    }
    case "program":
    case "command": {
      return undefined;
    }
    default: {
      const _exhaustive: never = args;
      return _exhaustive;
    }
  }
};

/** `$c` is the position of this spec's word. */
const pwshBody = (spec: CommandSpec, pad: string): string => {
  if (spec.subcommands?.length) {
    const subs = visible(spec.subcommands);
    const tips = subs
      .map((s) => `${pwshQuote(s.name)} = ${pwshQuote(s.summary)}`)
      .join("; ");
    const arms = subs
      .map((sub) => {
        const body = pwshBody(sub, `${pad}    `);
        return `${pad}    { $_ -in ${pwshList(names(sub))} } {\n${pad}      $c += 1\n${body}\n${pad}    }`;
      })
      .join("\n");
    return [
      `${pad}  if ($index -eq $c + 1) { return Complete ${pwshList(subs.map((s) => s.name))} @{ ${tips} } }`,
      `${pad}  switch ($words[$c + 1]) {`,
      arms,
      `${pad}  }`,
    ].join("\n");
  }
  if (isPassthrough(spec)) {
    const values = spec.args && pwshArgs(spec.args);
    return values ? `${pad}  return Complete ${values}` : `${pad}  return`;
  }
  const flags = allFlags(spec);
  const lines = flags.flatMap((flag) => {
    const values = pwshValue(flag.value);
    return values === undefined
      ? []
      : [
          `if ($prev -in ${pwshList(flagWords(flag))}) { return Complete ${values} }`,
        ];
  });
  lines.push(
    `if ($wordToComplete -like '-*') { return Complete ${pwshList(flags.flatMap(flagWords))} }`
  );
  const positional = spec.args && pwshArgs(spec.args);
  if (positional) {
    lines.push(`Complete ${positional}`);
  }
  return lines.map((line) => `${pad}  ${line}`).join("\n");
};

const pwsh = (specs: readonly CommandSpec[]): string => {
  const shown = visible(specs);
  const commands = shown
    .map((c) => `    ${pwshQuote(c.name)} = ${pwshQuote(c.summary)}`)
    .join("\n");
  const arms = shown
    .map(
      (spec) =>
        `    { $_ -in ${pwshList(names(spec))} } {\n${pwshBody(spec, "    ")}\n    }`
    )
    .join("\n");
  return `# nipa completion for PowerShell
# Load it from your $PROFILE:  nipa completion pwsh | Out-String | Invoke-Expression
Register-ArgumentCompleter -Native -CommandName nipa -ScriptBlock {
  param($wordToComplete, $commandAst, $cursorPosition)
  $commands = [ordered]@{
${commands}
  }
  function Complete([string[]]$values, [hashtable]$tips = @{}) {
    $values | Where-Object { $_ -like "$wordToComplete*" } | ForEach-Object {
      $tip = if ($tips[$_]) { $tips[$_] } else { $_ }
      [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterValue', $tip)
    }
  }
  function Dynamic([string]$kind) { @(nipa __complete $kind 2>$null) }
  function Openstack([int]$start) {
    $typed = @($words | Select-Object -Skip $start -First ($index - $start))
    @(nipa __complete openstack -- @typed $wordToComplete 2>$null)
  }
  $words = @($commandAst.CommandElements | ForEach-Object { $_.ToString() })
  # The word being completed is either the last element or a new, empty one.
  $index = if ($wordToComplete) { $words.Count - 1 } else { $words.Count }
  $prev = if ($index -ge 1) { $words[$index - 1] } else { '' }
  $c = 1
  $command = $null
  while ($c -lt $index) {
    if ($words[$c] -in ${pwshList(PROFILE_WORDS)}) { $c += 2 }
    elseif ($words[$c] -like '-*') { $c += 1 }
    else { $command = $words[$c]; break }
  }
  if (-not $command) {
    if ($prev -in ${pwshList(PROFILE_WORDS)}) { return Complete (Dynamic profiles) }
    if ($wordToComplete -like '-*') { return Complete ${pwshList(GLOBAL_FLAGS.flatMap(flagWords))} }
    return Complete ([string[]]$commands.Keys) $commands
  }
  switch ($command) {
${arms}
  }
}
`;
};

export const completionScript = (
  shell: CompletionShell,
  specs: readonly CommandSpec[]
): string => {
  switch (shell) {
    case "bash": {
      return bash(specs);
    }
    case "zsh": {
      return zsh(specs);
    }
    case "fish": {
      return fish(specs);
    }
    case "pwsh": {
      return pwsh(specs);
    }
    default: {
      const _exhaustive: never = shell;
      return _exhaustive;
    }
  }
};
