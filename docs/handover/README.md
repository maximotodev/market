# ContextVM cleanup plan index

Execute these plans in order.

1. [`contextvm-scope-cleanup-design.md`](./contextvm-scope-cleanup-design.md) — define the trim boundary and decide what can stay for transplant
2. [`contextvm-e2e-skip-issue.md`](./contextvm-e2e-skip-issue.md) — draft the issue for the temporary skipped Playwright tests
3. [`contextvm-transplant-plan.md`](./contextvm-transplant-plan.md) — move only the relevant fixes onto the follow-up branch
4. [`contextvm-final-browser-cleanup.md`](./contextvm-final-browser-cleanup.md) — run `make browser-contextvm`, verify the happy path, then do the final cleanup commit

Important:

- Keep the Makefile available until the final browser validation is complete.
- Keep handover/debug docs around until the final cleanup commit if they are still needed for testing or review.
- If `Makefile` or handover docs are removed, do it in the final cleanup step together with any other no-longer-needed debug artifacts.

Related existing context docs that should eventually be migrated here from `docs/handovers/`:

- `browser-contextvm-debug-resolve-plan.md`
- `contextvm-ci-comparison-plan.md`
- `contextvm-ci-failure-comparison.md`
- `contextvm-review-feedback-plan.md`
