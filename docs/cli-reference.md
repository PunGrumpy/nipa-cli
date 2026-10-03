<!-- contentType: Reference · plan: docs/content-plan.md -->

# CLI reference

This page lists the commands, options, environment variables, files, exit codes and JSON output of `nipa`. It matches the code in `src/` and the output of `nipa <command> --help`.

## Commands

nipa has 10 commands. Without a command, it prints help.

| Command | What it does |
| --- | --- |
| `nipa login [options]` | Asks for your email and password, then for a one-time password (OTP) code when your account uses multi-factor authentication (MFA). Saves a token scoped to a project |
| `nipa logout` | Revokes the current profile's token and deletes its session |
| `nipa whoami [--json]` | Shows your user, profile, project and when the session expires |
| `nipa switch [project]` | Scopes the session to another project by name or ID, without a password or OTP code |
| `nipa os <args...>` | Runs `openstack <args...>` with the session. `nipa openstack` is the same command |
| `nipa tf <args...>` | Runs `terraform <args...>` with the session. `nipa terraform` is the same command |
| `nipa exec <command> [args...]` | Runs any command with the session |
| `nipa env [--shell bash\|zsh\|fish]` | Prints the session's `OS_*` variables as shell commands |
| `nipa profile [ls\|add\|use\|rm]` | Lists, adds, picks or removes profiles |
| `nipa completion <shell>` | Prints the tab completion script for `bash`, `zsh`, `fish` or `pwsh` |

`nipa help <command>` and `nipa <command> --help` print the help for one command. A mistyped command name gets a suggestion, such as "Did you mean `nipa login`?".

## Command options

These options belong to one command:

| Option | Command | What it does |
| --- | --- | --- |
| `-u, --username <email>` | `login` | Logs in as this user instead of the last one |
| `-p, --project <project>` | `login` | Scopes the token to this project, by name or ID, instead of the last one |
| `--json` | `whoami`, `profile ls` | Prints JSON on stdout |
| `--shell <bash\|zsh\|fish>` | `env` | Picks the shell syntax. The default comes from `$SHELL` |
| `--auth-url <url>` | `profile add` | The Keystone URL, ending in `/v3` |
| `--user-domain <domain>` | `profile add` | The user domain. The default is `nipacloud` |
| `--region <region>` | `profile add` | The region. The default is `NCP-TH` |
| `--use` | `profile add` | Makes the new profile the current one |
| `-y, --yes` | `profile rm` | Removes the profile without asking |

## Global options

Global options work with every command. Put them before `os`, `tf` and `exec`, because nipa passes every word after those commands to the program they run, `--help` included.

| Option | Variable | What it does |
| --- | --- | --- |
| `-P, --profile <name>` | `NIPA_PROFILE` | Uses this profile instead of the current one |
| `-d, --debug` | `NIPA_DEBUG=1` | Logs each HTTP request: method, URL, status and time. Never headers or bodies |
| `--no-color` | `NO_COLOR=1` | Turns off colors |
| `-h, --help` |  | Prints help |
| `-v, --version` |  | Prints the version |

nipa picks the profile in this order: `--profile`, then `NIPA_PROFILE`, then `currentProfile` in `config.json`.

## Other environment variables

These variables change where nipa keeps files and when it checks for updates:

| Variable | What it does |
| --- | --- |
| `NIPA_CONFIG_DIR` | The directory for `config.json` and `auth.json`. The default is `$XDG_CONFIG_HOME/nipa`, then `~/.config/nipa` |
| `XDG_CACHE_HOME` | The parent of `nipa/update.json` and `nipa/openstack.json`. The default is `~/.cache` |
| `NIPA_NO_UPDATE_CHECK` | Turns off the update check when set to any value |
| `CI` | Turns off the update check when set to any value |

## Files

nipa keeps these files. It writes `config.json` and `auth.json` with mode `0600` in a `0700` directory:

| File | Contents |
| --- | --- |
| `config.json` | `currentProfile`, and `profiles` with each profile's `authUrl`, `userDomain`, `region`, last `username` and last `project` |
| `auth.json` | `sessions` with each profile's token, expiry time, user and project |
| `~/.cache/nipa/update.json` | The latest version on GitHub and when nipa checked |
| `~/.cache/nipa/openstack.json` | openstack's commands and options, for tab completion after `nipa os` |

nipa 0.1 kept one profile's fields and one session at the top level of these files. nipa reads that format as the `prod` profile and writes the new format the next time it saves.

`prod` is always there. Its defaults are `https://identity-api.nipa.cloud/v3`, user domain `nipacloud` and region `NCP-TH`.

## Exit codes

nipa exits with these codes:

| Code  | Meaning                                                         |
| ----- | --------------------------------------------------------------- |
| `0`   | The command worked                                              |
| `1`   | An error, such as a wrong password or an expired session        |
| `2`   | A usage error: an unknown command or option, or a missing value |
| `127` | `nipa exec` couldn't find the command                           |
| `130` | You pressed Ctrl+C at a prompt                                  |

`nipa os`, `nipa tf` and `nipa exec` exit with the code of the program they ran. When a signal stops that program, the code is 128 plus the signal number.

## JSON output

`nipa whoami --json` prints this object on stdout:

```json
{
  "authUrl": "https://identity-api.nipa.cloud/v3",
  "expiresAt": "2030-01-01T00:00:00.000000Z",
  "loggedIn": true,
  "profile": "prod",
  "project": { "domainId": "1234…", "id": "5678…", "name": "my-project" },
  "region": "NCP-TH",
  "user": { "id": "9012…", "name": "me@example.com" }
}
```

Without a session, it prints `{"loggedIn":false,"profile":"prod"}` and exits with code `1`.

`nipa profile ls --json` prints an array with one object per profile. Each object has `name`, `current`, `loggedIn`, `authUrl`, `userDomain` and `region`. It also has `username` and `project` from the last login, and `user` while the session is active.

## Update check

On a terminal, nipa checks the [GitHub releases](https://github.com/PunGrumpy/nipa-cli/releases) for a newer version at most once every 24 hours, after the command finishes. It waits at most 1.5 seconds for the answer. When a newer version exists, nipa prints a box with the version and a link to its release notes.
