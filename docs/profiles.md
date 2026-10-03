<!-- contentType: How-to · plan: docs/content-plan.md -->

# Use nipa with a staging Keystone

This page shows how to add a profile for a second Keystone, such as a staging cloud, and run commands against it. You stay logged in to production the whole time.

A profile is a Keystone URL, a user domain and a region, with its own session. nipa starts with one profile, `prod`, which is Nipa Cloud production.

## Add the profile

Run `nipa profile add` and answer the questions. nipa checks that the URL answers like Keystone v3 before it saves the profile:

```console
$ nipa profile add staging
✔ Keystone URL https://keystone.example.com/v3
✔ User domain nipacloud
✔ Region NCP-TH
✔ Use staging now? Yes
> Success! Added profile staging (Keystone v3.14) [231ms]
> Now using staging. Run `nipa login` to log in to it.
```

Replace `https://keystone.example.com/v3` with your Keystone's URL. In a script, pass every value as a flag instead:

```sh
nipa profile add staging --auth-url https://keystone.example.com/v3 --use
```

`--user-domain` and `--region` default to `nipacloud` and `NCP-TH`.

## Log in and run commands

Log in once per profile. The `staging` session doesn't replace the `prod` one:

```sh
nipa -P staging login
nipa -P staging os server list
nipa -P staging tf plan
```

`-P` picks the profile for one command. Put it before `os`, `tf` and `exec`, because the words after those commands go to the program they run. When a command runs outside `prod`, nipa prints `> Using profile staging` first, so a staging plan can't pass for a production one.

## Switch the current profile

Make `staging` the profile that commands use without `-P`:

```sh
nipa profile use staging
```

To pick a profile for one terminal only, set `NIPA_PROFILE`:

```sh
export NIPA_PROFILE=staging
```

nipa picks the profile in this order: `-P`, then `NIPA_PROFILE`, then the current profile.

## See and remove profiles

`nipa profile ls` shows each profile and the account its session uses. The current profile has a check mark:

```console
$ nipa profile ls
> 2 profiles
  name     keystone                 region  logged in as
✔ prod     identity-api.nipa.cloud  NCP-TH  me@example.com (my-project)
  staging  keystone.example.com     NCP-TH  -
```

`nipa profile rm staging` logs out of the profile and deletes it. You can't remove `prod`.
