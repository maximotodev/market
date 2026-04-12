# ContextVM cleanup design

## Purpose

This document defines the cleanup boundary for `feature/get-currency-context-vm` so the branch can be trimmed back to a reviewable ContextVM BTC pricing PR.

This is the planning document you read before the transplant and the temporary skip issue, not the final cleanup step.

## Non-goals

- Do not rework unrelated social/comments/messages/zaps features.
- Do not continue NIP05 / vanity / profile expansion work in this branch.
- Do not keep temporary Playwright skips as a permanent part of the feature branch.
- Do not mix browser-debug documentation with feature code.

## Keep for sure

### Core ContextVM / BTC pricing implementation

Keep these files as the stable feature core:

- `contextvm/server.ts`
- `contextvm/schemas.ts`
- `contextvm/tools/price-sources.ts`
- `contextvm/tools/rates-cache.ts`
- `contextvm/__tests__/currency-server.test.ts`
- `contextvm/tools/__tests__/price-sources.test.ts`
- `contextvm/tools/__tests__/rates-cache.test.ts`
- `contextvm/tools/__tests__/schemas.test.ts`
- `src/lib/ctxcn-client.ts`
- `src/queries/external.tsx`
- `src/lib/constants.ts`
- `src/lib/__tests__/contextvm-client.test.ts`
- `src/lib/__tests__/contextvm-client.integration.test.ts`
- `src/queries/__tests__/external.test.ts`
- `scripts/fetch-btc-price.ts`
- `ctxcn.config.json`
- `.env.example`
- `.env.local.example`
- `bun.lock`
- `package.json` changes only for the currency feature

### Support files that may stay if they are strictly needed

Keep these only if they are necessary for the pricing feature to run locally, in CI, or in deployment:

- `.github/workflows/ci-unit.yml`
- `.github/workflows/e2e.yml`
- `.github/workflows/deploy.yml`
- `.github/workflows/release.yml`
- `deploy-simple/deploy.sh`
- `deploy-simple/README.md`
- `deploy-simple/env/.env.development.example`
- `deploy-simple/env/.env.production.example`
- `deploy-simple/env/.env.staging.example`
- `Makefile` — keep this until the very end so `make browser-contextvm` stays available for validation and reviewer testing
- `src/index.tsx`
- `src/queries/config.tsx`
- `src/lib/stores/config.ts`
- `.gitignore`

If any of those are only there for debugging, split them out.

## Move handover docs out of the feature branch

All handover docs should eventually live under `docs/handover/` instead of being mixed into feature work.

For the current cleanup, keep the handover docs available until the transplant and browser validation are done. If they are still useful for the final review pass, remove them in the final cleanup commit together with the Makefile only if the Makefile is no longer needed.

Plan to migrate the current handover material:

- `docs/handovers/browser-contextvm-debug-resolve-plan.md`
- `docs/handovers/contextvm-ci-comparison-plan.md`
- `docs/handovers/contextvm-ci-failure-comparison.md`
- `docs/handovers/contextvm-review-feedback-plan.md`

Keep the content, but move the files so the feature branch does not accumulate process notes in the main feature path.

## Remove or split out

### Temporary CI workaround files

Remove or move these into a follow-up branch, because they are temporary skips tied to the failed E2E investigation:

- `e2e-new/tests/checkout.spec.ts`
- `e2e-new/tests/marketplace.spec.ts`
- `e2e-new/tests/order-lifecycle.spec.ts`
- `e2e-new/tests/order-messaging.spec.ts`
- `e2e-new/tests/payments.spec.ts`
- `e2e-new/tests/product-page.spec.ts`
- `e2e-new/tests/shipping-special.spec.ts`
- `e2e-new/test-config.ts`

If the transplant branch needs a minimal subset of these files to keep the comparison investigation reproducible, keep only the smallest possible slice and document why.

### Social / messages / profile cleanup

Split out or revert these if they are not strictly required for the currency feature:

- `src/components/messages/ConversationView.tsx`
- `src/components/messages/MessageInput.tsx`
- `src/queries/messages.tsx`
- `src/routes/_dashboard-layout/dashboard/sales/messages/$pubkey.tsx`
- `src/components/pages/ProfilePage.tsx`
- `src/components/Comments.tsx`
- `src/components/social/*`
- `src/queries/comments.tsx`
- `src/queries/reactions.tsx`
- `src/queries/zaps.tsx`
- `src/lib/zapPurchase.ts`
- `src/server/ZapPurchaseManager.ts`

### Any additional non-currency feature clusters

If a change does not directly support BTC pricing or the ContextVM server/client path, move it out of this branch and into a dedicated follow-up branch.

## Definition of success

The branch is clean enough for review when:

1. The currency implementation is intact.
2. The branch does not contain temporary test skips unless they are explicitly part of the transplant branch and clearly documented.
3. The handover docs are no longer mixed into the feature path, or are only present because the browser validation still needs them.
4. The remaining diffs are explainable as pricing feature support.

## Recommended execution order

1. Create the documentation issue for the temporary skips.
2. Transplant the relevant fixes onto the follow-up branch.
3. Run `make browser-contextvm` and verify the happy path.
4. Finish the remaining cleanup.
5. Remove the handover docs and `Makefile` only in the final cleanup commit if they are no longer needed.
