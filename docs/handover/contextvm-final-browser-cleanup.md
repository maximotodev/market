# ContextVM final cleanup plan

## Goal

Use `docs/contextvm-happy-path-runbook.md` and `make browser-contextvm` to finish the last cleanup pass, then remove the remaining debug/process clutter from the branch.

## Inputs

Primary source of truth:

- `docs/contextvm-happy-path-runbook.md`

Operational tool:

- `make browser-contextvm`

## Cleanup targets

### 1) Verify the happy path

Run the browser happy path exactly as described in the runbook and record:

- relay start and readiness
- ContextVM server start and readiness
- BTC price fetch success
- cache hit on second fetch
- frontend pricing display
- Yadio fallback when the ContextVM server is stopped

### 2) Remove leftover browser/debug clutter

Clean up any temporary files or code paths that were only needed to debug the browser path and are no longer part of the feature.

### 3) Move handover docs out of the feature path

Move the handover docs into `docs/handover/` so they are no longer mixed with the feature implementation path.

### 4) Keep the PR scope narrow

After the browser validation passes, trim the branch so it contains only:

- the ContextVM pricing feature
- minimal runtime/CI support that is truly required
- no temporary Playwright skips
- no unrelated social/messages/profile/UI cleanup

## Suggested execution sequence

1. Read the runbook.
2. Run `make browser-contextvm`.
3. Capture any failures in the runbook notes.
4. Remove or revert browser-only debug changes.
5. Move handover docs to the target folder.
6. Re-run the browser happy path.
7. Confirm the branch is ready for a focused review.

## Success criteria

This cleanup is done when:

- the browser happy path is proven by the runbook
- the temporary investigation artifacts are gone
- the branch no longer carries unrelated feature work
- the remaining diff is understandable as a ContextVM BTC pricing PR
