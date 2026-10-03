<!-- contentType: How-to · plan: docs/content-plan.md -->

# Release nipa

This page shows how a change becomes a release, from the changeset in a pull request to the binaries on GitHub. You don't run any release command by hand.

## Add a changeset to your pull request

Every pull request that changes what users see needs a changeset, and the continuous integration (CI) checks fail without one. Run this and answer the questions:

```sh
bun changeset
```

Pick `patch` for a fix, `minor` for a new command or option, or `major` for a change that breaks scripts. Then write one sentence about the change from the user's side, naming the command in backticks:

```md
---
"nipa-cli": minor
---

Add `nipa profile` to log in to more than one Keystone, such as staging.
```

A pull request that only changes tests, CI or docs can add an empty changeset with `bun changeset --empty`.

## Merge the version pull request

When changesets reach `main`, the Release workflow opens a pull request titled "chore: version packages", and updates it with each new changeset. Merging it does 3 things:

1. Bumps the version in `package.json` and adds the changesets to `CHANGELOG.md`
2. Tags the commit `v<version>`
3. Builds the binaries for macOS, Linux and Windows, and attaches them and a `SHA256SUMS` file to a GitHub release, with that version's `CHANGELOG.md` section as the notes

Workflows don't run on the version pull request, because GitHub doesn't start workflows for pull requests that a workflow opens. The changes it releases already passed CI on `main`, and its own commit only edits `package.json` and `CHANGELOG.md`.

## Build the binaries locally

To check a build before a release, run:

```sh
bun run build:release
```

It writes the binaries and `SHA256SUMS` to `dist/`. `bun run build` builds only the binary for your machine, as `dist/nipa`.
