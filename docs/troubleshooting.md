<!-- contentType: Troubleshooting · plan: docs/content-plan.md -->

# Fix login and session errors

This page lists the errors nipa prints, what causes each one, and how to fix it. Find the message you see in the headings below. If a request fails in a way this page doesn't cover, run the command again with `--debug` to see each HTTP request.

## "wrong email or password"

Keystone refused the password, or the email doesn't match an account in the profile's user domain. Check the email, then the user domain with `nipa profile ls`. Nipa Cloud accounts are in the `nipacloud` domain.

## "That code didn't work" or "wrong OTP code"

Keystone refused the OTP code. Each code works once and only for about 30s, so wait for the next code from your authenticator app and type that one. nipa asks again up to 3 times without asking for the password again. If every code fails, check that your phone sets its clock automatically, because each code depends on the time.

## "this account's MFA rules don't allow this login method"

Keystone accepted the credentials but the account's MFA rule doesn't list the method you used. You see this when you log in with an application credential on an account with MFA. Use `nipa login` instead, and pass the session to other tools with `nipa exec` or `nipa env`.

## "you aren't logged in to prod" or "your prod session expired"

The profile has no session, or its token expired after the 24 hours a Nipa Cloud token lasts. In a terminal, nipa logs you in before it runs the command.

In a script, nothing can type a password, so nipa stops with this error instead. Run `nipa login` in a terminal, then run the script again.

## "`nipa login` needs a terminal to ask for your password"

You ran `nipa login` where nothing can type the answers, such as in continuous integration (CI) or with stdin redirected. nipa never reads a password from a pipe. Log in from a terminal first.

## "no profile named …"

The name after `-P`, or in `NIPA_PROFILE`, isn't a profile. The error lists the profiles you have. Check `NIPA_PROFILE` with `echo $NIPA_PROFILE` if you didn't pass `-P`.

## "can't reach …"

The request never got an answer. The host name didn't resolve, the server refused the connection, or the Transport Layer Security (TLS) handshake failed. Check the profile's Keystone URL with `nipa profile ls`, then your network connection.

## "… doesn't answer like Keystone v3"

`nipa profile add` sent a request to the URL and the answer wasn't Keystone's version document. Check that the URL is the identity endpoint, usually ending in `/v3`, and not the portal.

## "command not found: openstack"

nipa looked for `openstack` on your `PATH` and in `~/.local/bin` and didn't find it. Install the OpenStack client with `pipx install python-openstackclient`. For `terraform`, install Terraform.

## "…/auth.json: …" or "…/config.json: …"

The file doesn't match the format nipa expects, for example after you edit it by hand. Fix the field the message names, or delete the file. Deleting `auth.json` logs you out of every profile. Deleting `config.json` removes your profiles except `prod`.

## Tab completion does nothing

The completion script isn't loaded in your current shell. Open a new terminal after you add it to your startup file, or load it now with `eval "$(nipa completion bash)"`. In bash, completion after `nipa tf` and `nipa exec` also needs the `bash-completion` package.

## The first Tab after `nipa os` is slow

nipa gets openstack's commands from `openstack complete`, which starts Python and loads every client plugin. nipa saves the list in `~/.cache/nipa/openstack.json` and runs `openstack complete` again only after the `openstack` executable changes.

## `nipa os` doesn't complete a plugin's commands

Installing a plugin, for example with `pipx inject python-openstackclient python-octaviaclient`, doesn't change the `openstack` executable, so nipa keeps the old list. Delete `~/.cache/nipa/openstack.json` and press Tab again.

## An old error appears after an update

Your shell may still have an old `nipa` function or alias that hides the binary. In fish, run `type nipa`. If it says `nipa is a function`, remove it with `functions -e nipa` and delete `~/.config/fish/functions/nipa.fish`.
