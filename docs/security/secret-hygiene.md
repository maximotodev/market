# Secret Hygiene

This note is maintainer-facing and safe for public review. Do not include secret values in issues, PRs, CI logs, comments, or reports.

## Current Scope

PR 1 removes local env material from tracked source and adds a tracked-file secret guard. It does not rotate keys, clean git history, or change application behavior.

## Rotation Risk

`.env.dev` was previously tracked and contained an `APP_PRIVATE_KEY` variable. Treat any committed app key as exposed unless maintainers confirm it was disposable test-only material.

Maintainers must decide whether the prior key material requires rotation or retirement. This PR documents the risk but does not perform rotation.

## Reporting Rules

When secret-like material is found, report only:

- file path
- variable or pattern name
- risk

Never report the value.
