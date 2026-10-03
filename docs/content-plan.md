<!-- contentType: Reference -->

# Content plan

This page is the plan for every doc page in this repo. It says what each page is for, who reads it, and which questions are still open.

## Readers and their goals

These docs serve 2 groups of readers:

- Nipa Cloud users whose account uses multi-factor authentication (MFA), and who want to run `openstack` or `terraform` without an openrc file.
- Nipa staff who also work against a staging Keystone, and who need to switch between it and production without logging in again.

After reading the docs, readers should be able to:

1. Install nipa, log in and run an OpenStack command.
2. Add a profile for another Keystone and run commands against it.
3. Explain why nipa asks for an OTP code only on some accounts.
4. Find the cause of a login or session error.
5. Release a new version.

## Each doc page

Each page does one job, based on its content type:

| Page | Content type | Goal |
| --- | --- | --- |
| [README](../README.md) | Landing | Pick the next page to read |
| [Run your first command with nipa](quickstart.md) | Tutorial | Install nipa, log in and list servers |
| [Use nipa with a staging Keystone](profiles.md) | How-to | Add a profile and switch to it |
| [CLI reference](cli-reference.md) | Reference | Look up commands, options, variables, files and exit codes |
| [How nipa logs in with MFA](how-login-works.md) | Conceptual | Explain receipts, scopes and where the token goes |
| [Fix login and session errors](troubleshooting.md) | Troubleshooting | Find the cause of an error message |
| [Release nipa](releasing.md) | How-to | Release a new version and its binaries |

## Open questions

Confirm these before you rely on the matching docs:

- The tests check the Keystone receipt flow, password first and then the OTP code with the receipt, against a fake Keystone. Confirm it against Nipa Cloud production with a real login.
- The staging Keystone URL, user domain and region for Nipa staff aren't written down yet. [Use nipa with a staging Keystone](profiles.md) uses `https://keystone.example.com/v3` until they are.
- Does the staging Keystone use the same MFA rule as production?
