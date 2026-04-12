# ContextVM reviewer feedback follow-up handover

This is a handoff for a future agent. Your job is to **finish the remaining reviewer feedback on the ContextVM currency PR** after the scope has been trimmed.

Use this only after the branch has been reduced to the actual pricing feature. Do **not** mix the work below with the out-of-scope cleanup pass.

## Branch / PR context

- Branch: `feature/get-currency-context-vm`
- Base branch in the PR thread: `get-currency-context-vm`
- Latest green commit at the time of writing: `e1067dc36a0a690d3b9b95966e694ff6b450a8ce`
- Review thread: GitHub PR `#735` (“Get currency context vm”)

## What the review already asked for

The review comments and follow-up discussion asked for the following directions:

1. Rename the server key/env var from `CURRENCY_SERVER_KEY` to `CVM_SERVER_KEY`.
2. Use `ctxcn` / generated client artifacts instead of a browser-problematic SDK path.
3. Check the browser-safe client artifact into the repo.
4. Generalize test scripts rather than hardcoding a small set of currency-only files.
5. Add deploy support so the ContextVM server is started alongside the app.
6. Make the ContextVM server only announce publicly in production.
7. Keep the currency feature configurable and environment-aware.

## What appears to already be done

Before making further changes, confirm these are still in place:

- `.env.example` and `.env.local.example` use `CVM_SERVER_KEY`
- `ctxcn.config.json` exists and points at the checked-in client artifact
- `src/lib/ctxcn-client.ts` exists as the browser-safe client
- `package.json` uses generalized test scripts instead of hardcoded currency-only lists
- `deploy-simple/deploy.sh` starts the app and ContextVM server via PM2
- `contextvm/server.ts` only announces publicly in production
- `src/queries/external.tsx` tries ContextVM first and falls back to Yadio
- `src/lib/constants.ts` provides the CVM pubkey / relay config

If any of those are missing, restore them first.

## Remaining feedback that still needs a decision or cleanup

### 1) Client naming is still not fully settled

The review thread suggested cleaner naming, but the agreed target for this branch is:

- file: `src/lib/ctxcn-client.ts`
- class: `PlebianCurrencyClient`

Your job is to keep that naming consistent across imports, tests, config, and docs.

If a future broader ContextVM client is introduced, that can be revisited later, but this PR should stay on `PlebianCurrencyClient`.

### 2) The legacy wrapper should be removed

A "compatibility wrapper" is a thin old-import-path module that is kept around temporarily so older code keeps working while the real implementation is moved to the checked-in client.

In this branch, there is no wrapper file left in `src/lib/`, so the remaining cleanup was to remove stale references such as:

- `legacyWrapper` in `ctxcn.config.json`
- any docs that still describe a wrapper as if it exists

The checked-in client is the source of truth now, so the docs should say that the wrapper is gone.

### 3) Test script generalization should stay generalized

The reviewer explicitly asked not to hardcode a narrow list of tests in package scripts.

Verify that `package.json` still uses generalized commands like:

- `test:unit` over all relevant unit tests
- `test:integration` over all integration tests

Do not regress to a hardcoded currency-only file list.

### 4) Deployment naming / environment wiring should remain consistent

Check for consistency across:

- `.env.example`
- `.env.local.example`
- `deploy-simple/env/*.example`
- `deploy-simple/deploy.sh`
- `.github/workflows/deploy*.yml`
- `.github/workflows/release.yml`
- `src/index.tsx`
- `src/lib/constants.ts`
- `contextvm/server.ts`

The goal is to avoid a mismatch like:

- server key env var name drift
- inconsistent relay selection by environment
- production-only public relay announcements accidentally leaking into non-production

### 5) Keep the generated client checked in

One review comment explicitly asked to check in the generated client artifact.

Do **not** replace the browser-safe client with an SDK path that depends on browser-unfriendly behavior.

If anything in the tree still imports the old wrapper path when it should import the checked-in client, update those imports.

## Files that are likely relevant for this pass

- `src/lib/ctxcn-client.ts`
- `src/queries/external.tsx`
- `src/lib/constants.ts`
- `contextvm/server.ts`
- `ctxcn.config.json`
- `package.json`
- `.env.example`
- `.env.local.example`
- `deploy-simple/deploy.sh`
- `.github/workflows/ci-unit.yml`
- `.github/workflows/deploy.yml`
- `.github/workflows/release.yml`
- `.github/workflows/deploy-relay.yml`
- any docs under `docs/contextvm-*.md`

## What not to do in this pass

- Do not reintroduce unrelated social/comments/reactions/zaps work.
- Do not expand the deploy system again.
- Do not touch the old E2E suite migration unless it directly blocks the currency PR.
- Do not re-add the temporary CI test skips to this branch unless absolutely necessary.

## Suggested workflow for the next agent

1. Confirm the branch is already trimmed to currency scope.
2. Diff the branch against `get-currency-context-vm` and inspect only the remaining currency-related files.
3. Make only the minimal changes needed to satisfy the reviewer feedback.
4. Run the narrowest relevant tests first, then the broader unit/integration checks.
5. If the check-in client or naming is still disputed, call that out explicitly in the report.

## Useful commands

```bash
git diff --name-only get-currency-context-vm..HEAD
git diff --stat get-currency-context-vm..HEAD
git log --oneline --decorate --max-count=30
```

To inspect current client and config references:

```bash
rg -n "CVM_SERVER_KEY|ctxcn|PlebianCurrencyClient|ctxcn-client|legacyWrapper|dev:contextvm-server|test:unit|test:integration" \
  package.json ctxcn.config.json .env.example .env.local.example src contextvm deploy-simple .github/workflows
```

## Validation expectations

At minimum, confirm that these pass after your changes:

- `bun run test:unit`
- `bun run test:integration`
- the relevant ContextVM/browser tests or a targeted e2e smoke if needed

If CI fails, report whether the failure is:

- a naming/config issue
- a client transport issue
- a deployment wiring issue
- or an unrelated pre-existing flake

## Report format

When you finish, report back with:

### Remaining reviewer items addressed

- item-by-item status

### Files changed

- concise list

### Validation

- tests run and results

### Open questions

- anything still ambiguous about naming, client generation, or deployment wiring

## Bottom line

Treat this as the **final polish pass** for the currency PR after trimming scope. Keep it narrow, keep it consistent, and do not pull in unrelated work.

## Paste-ready GitHub comment

You can paste the following into the GitHub PR thread to summarize what was completed from the previous review on [PR #735](https://github.com/PlebeianApp/market/pull/735):

> This pull request replaces [PR #735](https://github.com/PlebeianApp/market/pull/735).
>
> Completed items from that review:
>
> - Renamed the server key/env var to `CVM_SERVER_KEY`.
> - Switched the app to the checked-in browser-safe ContextVM client (`src/lib/ctxcn-client.ts`).
> - Kept the generated client checked into the repo so the browser path does not depend on a browser-unfriendly SDK wrapper.
> - Generalized `test:unit` and `test:integration` so they are no longer hardcoded to a narrow currency-only file list.
> - Added deploy support so the ContextVM server starts alongside the app.
> - Restricted public relay announcements to production only.
> - Kept the currency feature configurable and environment-aware.
> - Removed the temporary compatibility wrapper reference from `ctxcn.config.json` and documented the checked-in client as the source of truth.
>
> In short: the ContextVM currency work from PR #735 has been carried forward here with the review feedback applied and the branch trimmed to the final pricing-focused scope.

## Paste-ready GitHub comment for the Yadio fallback test

You can paste the following into the GitHub PR thread to explain how to verify the fallback path once the ContextVM server is turned off:

> I verified the browser happy path with ContextVM enabled. To test the fallback behavior, stop the ContextVM server and refresh the product page.
>
> Suggested steps:
>
> 1. Start the browser validation flow with `make browser-contextvm`.
> 2. Confirm the page logs `ContextVM BTC fetch succeeded` while the server is running.
> 3. Stop the ContextVM server process only, leaving the app and relay running.
> 4. Refresh `/products`.
> 5. Confirm the console shows `Falling back to Yadio BTC rates` and that fiat pricing still renders.
>
> Expected result:
>
> - The browser should no longer receive a ContextVM response.
> - The app should fall back to Yadio automatically.
> - Pricing should continue to render, proving the non-ContextVM path still works.
