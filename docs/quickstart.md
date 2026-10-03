<!-- contentType: Tutorial · plan: docs/content-plan.md -->

# Run your first command with nipa

In this tutorial you install nipa, log in to Nipa Cloud with a one-time password (OTP) code, and list the servers in your project. It takes about 5 minutes.

## What you need before you start

You need these 3 things:

- A Nipa Cloud account that you can log in to the portal with
- The authenticator app that gives you OTP codes for that account
- The OpenStack client, which `nipa os` runs: `pipx install python-openstackclient`

## 1. Install nipa

Download the binary for your platform from the [latest release](https://github.com/PunGrumpy/nipa-cli/releases/latest). This example is for macOS on Apple silicon:

```sh
base=https://github.com/PunGrumpy/nipa-cli/releases/latest/download
curl -fsSL -o ~/.local/bin/nipa "$base/nipa-darwin-arm64"
chmod +x ~/.local/bin/nipa
nipa --version
```

The last command prints the version. If your shell says `command not found`, add `~/.local/bin` to your `PATH`.

## 2. Log in

Run `nipa login`. It asks for your email and password, then for an OTP code from your authenticator app:

```console
$ nipa login
> Logging in to prod (identity-api.nipa.cloud)
✔ Email me@example.com
✔ Password ********
✔ OTP code 123456
✔ Which project? my-project
> Success! Logged in as me@example.com, project my-project
```

You only see the project question when your account has more than one project. nipa remembers your email and project. The next login fills in your email, so you press Enter, then type your password and a new OTP code.

## 3. Run an OpenStack command

Put `nipa os` in front of any `openstack` command:

```sh
nipa os server list
```

nipa runs `openstack server list` with your session, so the OpenStack client doesn't ask for a password. The session lasts until the token expires, which on Nipa Cloud is 24 hours. Run `nipa whoami` to see how long it has left.

## 4. Turn on tab completion

nipa completes its commands, options and your project names when you press Tab. After `nipa os`, it completes openstack's commands and options too. Add the line for your shell to its startup file:

```sh
echo 'eval "$(nipa completion zsh)"' >> ~/.zshrc
```

For bash, fish and PowerShell, run `nipa completion --help`.

## What to read next

Pick what to read next:

- **Run Terraform**: `nipa tf plan` runs `terraform plan` with the same session
- **Use staging**: [Use nipa with a staging Keystone](profiles.md) adds a second Keystone
- **Look something up**: the [CLI reference](cli-reference.md) lists every command and option
