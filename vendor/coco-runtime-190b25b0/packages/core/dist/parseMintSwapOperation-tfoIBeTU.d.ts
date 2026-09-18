import { On as MeltQuoteRef, kn as MintQuoteRef } from "./index-CbuugzL4.js";
import { Amount } from "@cashu/cashu-ts";

//#region operations/mintSwap/MintSwapOperation.d.ts
interface SourceDebitBounds {
  minimum: Amount;
  maximum: Amount;
  reserved: Amount;
}
/** Summaries derived from canonical Melt input, keep, change, and fee records. */
interface SourceSettlementEvidence {
  reserved: Amount;
  returned: Amount;
  finalDebit: Amount;
  totalFee: Amount;
  sourcePaidObservedAt: number;
}
/** Completion requires canonical quote accounting and locally verified, stored proofs. */
interface DestinationCompletionEvidence {
  quoteAmountIssued: Amount;
  storedProofAmount: Amount;
  proofsVerifiedAt: number;
}
type MintSwapRetryError = ({
  category: 'waiting';
  code: 'child_pending' | 'source_pending' | 'destination_pending';
} | {
  category: 'transient';
  code: 'remote_unavailable' | 'local_unavailable';
} | {
  category: 'ambiguous';
  code: 'source_outcome_unknown' | 'destination_outcome_unknown';
}) & {
  at: number;
};
/** Consecutive unsuccessful attempts in the current state; reset on state entry. */
interface MintSwapRetryState {
  attemptCount: number;
  lastAttemptAt: number | null;
  nextAttemptAt: number | null;
  lastError: MintSwapRetryError | null;
}
interface ValueNeutralExitEvidence {
  sourcePayment: 'not_authorized' | 'confirmed_unpaid';
  sourceProofs: 'not_reserved' | 'released';
  verifiedAt: number;
}
interface MintSwapFailure {
  code: 'preparation_rejected' | 'source_payment_rejected' | 'source_debit_cap_exceeded';
}
/** Closed vocabulary: diagnostics cannot carry remote messages or protocol secrets. */
interface MintSwapAttention {
  reason: 'contradictory_evidence' | 'missing_recovery_material';
  invariant: 'child_identity' | 'quote_identity' | 'payment_request' | 'source_debit' | 'source_settlement' | 'destination_completion' | 'recovery_material';
  evidence: {
    code: 'child_missing' | 'child_conflict' | 'quote_missing' | 'quote_conflict' | 'invoice_mismatch' | 'debit_bounds_mismatch' | 'settlement_mismatch' | 'proof_total_mismatch' | 'key_missing' | 'outputs_missing' | 'proofs_missing';
    leg: 'source' | 'destination';
    observedAt: number;
  };
}
interface MintSwapBase {
  schemaVersion: 1;
  id: string;
  /** Persistence assigns this metadata; commands never choose a revision. */
  readonly revision: number;
  sourceMintUrl: string;
  destinationMintUrl: string;
  unit: 'sat';
  destinationAmount: Amount;
  sourceDebitCap?: Amount;
  sourceQuote: MeltQuoteRef<'bolt11'>;
  destinationQuote: MintQuoteRef<'bolt11'>;
  sourceOperationId: string;
  destinationOperationId: string;
  /** SHA-256 of the exact BOLT11 invoice, encoded as lowercase hexadecimal. */
  paymentRequestHash: string;
  /** All parent timestamps are monotonic Unix milliseconds. */
  createdAt: number;
  updatedAt: number;
  stateEnteredAt: number;
  retry: MintSwapRetryState;
  /** Write once before payment; retained as historical intent after payment. */
  cancellationRequestedAt?: number;
}
interface PreparedFacts {
  sourceDebitBounds: SourceDebitBounds;
}
interface SourcePendingFacts extends PreparedFacts {
  sourceStartedAt: number;
}
interface FundedFacts extends SourcePendingFacts {
  sourceSettlement: SourceSettlementEvidence;
}
interface DestinationPendingFacts extends FundedFacts {
  destinationStartedAt: number;
}
interface CompletedFacts extends DestinationPendingFacts {
  destinationCompletion: DestinationCompletionEvidence;
  completedAt: number;
}
type NoProgressExcept<K extends keyof CompletedFacts = never> = { [P in Exclude<keyof CompletedFacts, K>]?: never };
/** Only established progress facts, never an embedded operation or recursive checkpoint. */
type LastSafeCheckpoint = {
  stateEnteredAt: number;
} & (({
  state: 'preparing';
} & NoProgressExcept) | ({
  state: 'prepared';
} & PreparedFacts & NoProgressExcept<keyof PreparedFacts>) | ({
  state: 'source_pending';
} & SourcePendingFacts & NoProgressExcept<keyof SourcePendingFacts>) | ({
  state: 'destination_funded';
} & FundedFacts & NoProgressExcept<keyof FundedFacts>) | ({
  state: 'destination_pending';
} & DestinationPendingFacts & NoProgressExcept<keyof DestinationPendingFacts>));
type ValueNeutralCheckpoint = Extract<LastSafeCheckpoint, {
  state: 'preparing' | 'prepared' | 'source_pending';
}>;
interface StopFacts {
  lastSafe: LastSafeCheckpoint;
  valueNeutral: ValueNeutralExitEvidence;
  cancelledAt: number;
  failure: MintSwapFailure;
  failedAt: number;
  attention: MintSwapAttention;
  attentionAt: number;
}
type NoStopExcept<K extends keyof StopFacts = never> = { [P in Exclude<keyof StopFacts, K>]?: never };
interface PreparingMintSwapOperation extends MintSwapBase, NoProgressExcept, NoStopExcept {
  state: 'preparing';
}
interface PreparedMintSwapOperation extends MintSwapBase, PreparedFacts, NoProgressExcept<keyof PreparedFacts>, NoStopExcept {
  state: 'prepared';
}
interface SourcePendingMintSwapOperation extends MintSwapBase, SourcePendingFacts, NoProgressExcept<keyof SourcePendingFacts>, NoStopExcept {
  state: 'source_pending';
}
interface DestinationFundedMintSwapOperation extends MintSwapBase, FundedFacts, NoProgressExcept<keyof FundedFacts>, NoStopExcept {
  state: 'destination_funded';
}
interface DestinationPendingMintSwapOperation extends MintSwapBase, DestinationPendingFacts, NoProgressExcept<keyof DestinationPendingFacts>, NoStopExcept {
  state: 'destination_pending';
}
interface CompletedMintSwapOperation extends MintSwapBase, CompletedFacts, NoStopExcept {
  state: 'completed';
}
interface CancelledMintSwapOperation extends MintSwapBase, NoProgressExcept, NoStopExcept<'lastSafe' | 'valueNeutral' | 'cancelledAt'> {
  state: 'cancelled';
  cancellationRequestedAt: number;
  lastSafe: ValueNeutralCheckpoint;
  valueNeutral: ValueNeutralExitEvidence;
  cancelledAt: number;
}
interface FailedMintSwapOperation extends MintSwapBase, NoProgressExcept, NoStopExcept<'lastSafe' | 'valueNeutral' | 'failure' | 'failedAt'> {
  state: 'failed';
  lastSafe: ValueNeutralCheckpoint;
  valueNeutral: ValueNeutralExitEvidence;
  failure: MintSwapFailure;
  failedAt: number;
}
interface AttentionMintSwapOperation extends MintSwapBase, NoProgressExcept, NoStopExcept<'lastSafe' | 'attention' | 'attentionAt'> {
  state: 'needs_attention';
  lastSafe: LastSafeCheckpoint;
  attention: MintSwapAttention;
  attentionAt: number;
}
type MintSwapOperation = PreparingMintSwapOperation | PreparedMintSwapOperation | SourcePendingMintSwapOperation | DestinationFundedMintSwapOperation | DestinationPendingMintSwapOperation | CompletedMintSwapOperation | CancelledMintSwapOperation | FailedMintSwapOperation | AttentionMintSwapOperation;
type MintSwapOperationState = MintSwapOperation['state'];
//#endregion
//#region operations/mintSwap/parseMintSwapOperation.d.ts
/**
 * Hydrate V1 persisted data into a validated, independent parent snapshot.
 * Validates only parent-local facts; the coordinator must verify canonical child/quote/proof records.
 * Unknown fields are rejected, including child recovery material and unbounded diagnostics.
 */
declare function parseMintSwapOperation(value: unknown): MintSwapOperation;
//#endregion
export { PreparingMintSwapOperation as _, DestinationCompletionEvidence as a, SourceSettlementEvidence as b, FailedMintSwapOperation as c, MintSwapFailure as d, MintSwapOperation as f, PreparedMintSwapOperation as g, MintSwapRetryState as h, CompletedMintSwapOperation as i, LastSafeCheckpoint as l, MintSwapRetryError as m, AttentionMintSwapOperation as n, DestinationFundedMintSwapOperation as o, MintSwapOperationState as p, CancelledMintSwapOperation as r, DestinationPendingMintSwapOperation as s, parseMintSwapOperation as t, MintSwapAttention as u, SourceDebitBounds as v, ValueNeutralExitEvidence as x, SourcePendingMintSwapOperation as y };