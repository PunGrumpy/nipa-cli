<!-- contentType: Conceptual · plan: docs/content-plan.md -->

# How nipa logs in with MFA

This page explains what nipa sends to Keystone when you log in and where it keeps the token afterward. It also explains why nipa asks for an OTP code only on some accounts.

## Keystone answers a password with a receipt

Keystone is the OpenStack identity service. A Nipa Cloud account with multi-factor authentication (MFA) has the rule `password + totp`, where TOTP is the time-based one-time password from your authenticator app. Keystone gives a token only to a login that satisfies the rule.

nipa sends your password first, in a `POST /v3/auth/tokens` request. On an account without MFA, that request returns a token and the login ends there. On an account with MFA, Keystone returns `401 Unauthorized` with an auth receipt in the `Openstack-Auth-Receipt` header. The receipt proves the password was right and lists the methods that are still missing.

nipa then asks for your OTP code and sends it in a second request, with the receipt in the same header. Keystone checks the code and returns the token. If the code is wrong, nipa asks for the next code and sends it with the same receipt, up to 3 times. You type your password only once.

## Why application credentials don't work

An application credential logs in with the `application_credential` method alone. When the account's MFA rule doesn't list that method, Keystone answers with a receipt that has no methods left to try. nipa prints "this account's MFA rules don't allow this login method" for that case. The `nipa login` flow above avoids it, because it uses the methods the rule asks for.

## A token works in one project

OpenStack services accept a token only in the project it names, which Keystone calls the token's scope. When nipa knows your project, from `--project` or from your last login, it adds the scope to the login requests. Otherwise it gets an unscoped token, lists your projects and exchanges the token for a scoped one.

`nipa switch` makes the same exchange with the token method. Keystone accepts it because the original token already satisfied the MFA rule, so switching projects needs no password or OTP code.

## Where the token goes

nipa saves the token in `auth.json`, next to `config.json`, in `~/.config/nipa/`. It writes both files with mode `0600` in a `0700` directory. The token is a bearer token, so anyone who reads `auth.json` can act as you until it expires.

When you run `nipa os`, `nipa tf` or `nipa exec`, nipa starts the command with these variables:

- **`OS_TOKEN`**: the token, which Terraform's OpenStack provider reads directly
- **`OS_AUTH_TYPE`**: `v3token`, which tells the OpenStack client and SDK to log in with `OS_TOKEN`
- **`OS_AUTH_URL`**, **`OS_REGION_NAME`**: from the profile
- **`OS_PROJECT_ID`**, **`OS_PROJECT_NAME`**, **`OS_PROJECT_DOMAIN_ID`**: from the token's project

nipa first removes every other `OS_*` variable from the environment. A stale `OS_PASSWORD` or `OS_CLOUD` from an old openrc would otherwise override the token.

`nipa logout` sends `DELETE /v3/auth/tokens` to revoke the token, then deletes it from `auth.json`. Keystone also expires it on its own after 24 hours on Nipa Cloud.
