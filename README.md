<!-- contentType: Landing · plan: docs/content-plan.md -->

# Run OpenStack tools on Nipa Cloud with one MFA login

nipa is a command-line tool that logs in to Nipa Cloud with your password and a one-time password (OTP) code. It then runs `openstack`, `terraform` or any OpenStack tool with that session, so you type an OTP code once a day, not once per command.

```console
$ nipa login
> Logging in to prod (identity-api.nipa.cloud)
✔ Email me@example.com
✔ Password ********
✔ OTP code 123456
> Success! Logged in as me@example.com, project my-project

$ nipa os server list
$ nipa tf plan
```

Nipa Cloud accounts with multi-factor authentication (MFA) can't use a plain openrc file, and Keystone refuses application credentials while MFA is on. nipa does the MFA login, saves the token and passes it to each command you run through it.

## Install nipa

Download the binary for your platform from the [latest release](https://github.com/PunGrumpy/nipa-cli/releases/latest) and put it on your `PATH`:

```sh
base=https://github.com/PunGrumpy/nipa-cli/releases/latest/download
curl -fsSL -o ~/.local/bin/nipa "$base/nipa-darwin-arm64"
chmod +x ~/.local/bin/nipa
```

That's the binary for macOS on Apple silicon. The other files are `nipa-darwin-x64`, `nipa-linux-x64`, `nipa-linux-arm64` and `nipa-windows-x64.exe`. [Run your first command with nipa](docs/quickstart.md) covers the rest of the setup.

## What nipa does

nipa has commands for 3 jobs:

- **Session**: `login`, `logout`, `whoami` and `switch` to another project without a new OTP code
- **Run tools**: `os` runs `openstack`, `tf` runs `terraform`, `exec` runs any command, and `env` prints the `OS_*` variables for your shell
- **Setup**: `profile` adds another Keystone, such as staging, and `completion` prints tab completion for bash, zsh, fish or PowerShell

Run `nipa --help` for the full list, or read the [CLI reference](docs/cli-reference.md).

## Read the docs

Pick the page for what you want to do:

| Page | Read it when |
| --- | --- |
| [Run your first command with nipa](docs/quickstart.md) | You install nipa and want to see it work |
| [Use nipa with a staging Keystone](docs/profiles.md) | You work against more than one Keystone |
| [CLI reference](docs/cli-reference.md) | You look up a command, option, variable, file or exit code |
| [How nipa logs in with MFA](docs/how-login-works.md) | You want to know what nipa sends to Keystone and where it keeps the token |
| [Fix login and session errors](docs/troubleshooting.md) | A command prints an error you don't recognize |
| [Release nipa](docs/releasing.md) | You maintain nipa and cut a release |

## Contribute to nipa

nipa is a TypeScript program that runs on [Bun](https://bun.sh). Install the dependencies, then run the checks that CI runs:

```sh
bun install
bun test
bun run check
bun run typecheck
```

The tests run against a fake Keystone, so they don't need an account. Commit messages and pull request titles follow [Conventional Commits](https://www.conventionalcommits.org) without a scope, such as `feat: add nipa switch`. Every pull request that changes what users see needs a changeset, which [Release nipa](docs/releasing.md) explains.

## License

You can use and change nipa under the terms of the [MIT License](LICENSE).
