# ContextVM final cleanup plan

## Goal

Use `docs/contextvm-happy-path-runbook.md` and `make browser-contextvm` to finish the last cleanup pass, then remove the remaining debug/process clutter from the branch.

This is the last step after the transplant branch and temporary skip issue have already been handled.

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

Move any remaining handover docs from `docs/handovers/` into `docs/handover/` so they are no longer mixed with the feature implementation path.

If the browser validation still depends on the docs, keep them until this step and remove them in the final cleanup commit.

### 4) Keep the PR scope narrow

After the browser validation passes, trim the branch so it contains only:

- the ContextVM pricing feature
- minimal runtime/CI support that is truly required
- no temporary Playwright skips
- no unrelated social/messages/profile/UI cleanup
- no leftover handover docs or Makefile if they are no longer needed for review

## Suggested execution sequence

1. Read the runbook.
2. Run `make browser-contextvm`.
3. Capture any failures in the runbook notes.
4. Remove or revert browser-only debug changes.
5. Re-run the browser happy path.
6. Confirm the branch is ready for a focused review.
7. In the final cleanup commit, remove handover docs and the Makefile only if they are no longer needed.

## Success criteria

This cleanup is done when:

- the browser happy path is proven by the runbook
- the temporary investigation artifacts are gone
- the branch no longer carries unrelated feature work
- the remaining diff is understandable as a ContextVM BTC pricing PR
